"""เชื่อม database (Supabase) และ Storage สำหรับสคริปต์ใน ml/src

อ่านค่าจาก .env ที่รากโปรเจกต์ (หรือ env ของเครื่อง เช่นตอนรันใน Colab):
    DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY, (SUPABASE_URL, STORAGE_BUCKET ไม่ใส่ก็ได้)
ต้องลง: pip install "psycopg[binary]" httpx numpy
"""
import io
import json
import os
import re
from pathlib import Path

import httpx
import numpy as np
import psycopg

ROOT = Path(__file__).resolve().parents[2]
# ตั้งค่าการเทรน (include_null_class, min_recorded_clips) — รายการคำย้ายไปอยู่ที่ words.in_train_set แล้ว
TRAIN_SETTINGS_PATH = ROOT / "ml" / "configs" / "train_words.json"


# โหลด .env ที่รากโปรเจกต์ (ไม่ทับค่าที่ตั้งไว้แล้ว)
def _load_env() -> None:
    env = ROOT / ".env"
    if not env.is_file():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


_load_env()
DATABASE_URL = os.getenv("DATABASE_URL", "")
_ref = re.search(r"//postgres\.([a-z0-9]+)[:@]", DATABASE_URL)
SUPABASE_URL = (os.getenv("SUPABASE_URL") or (f"https://{_ref.group(1)}.supabase.co" if _ref else "")).rstrip("/")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
BUCKET = os.getenv("STORAGE_BUCKET", "signbridge-datasets")


# เปิดการเชื่อมต่อ database (psycopg ไม่รับ +psycopg ในชื่อ driver)
# autocommit: คำสั่งเดี่ยวบันทึกทันที ส่วนงานหลายคำสั่งให้ครอบด้วย `with conn.transaction():`
#   (ถ้าไม่เปิด autocommit, conn.transaction() จะเป็นแค่ savepoint และหายไปตอนปิดการเชื่อมต่อ)
def connect() -> psycopg.Connection:
    if not DATABASE_URL:
        raise SystemExit("ยังไม่ได้ตั้งค่า DATABASE_URL (ดู .env ที่รากโปรเจกต์)")
    return psycopg.connect(DATABASE_URL.replace("postgresql+psycopg://", "postgresql://", 1), autocommit=True)


# ตั้งค่าการเทรน
def train_settings() -> dict:
    try:
        return json.loads(TRAIN_SETTINGS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


# คำที่เลือกไว้เทรน
def train_words(conn) -> set[str]:
    return {r[0] for r in conn.execute("SELECT word FROM words WHERE in_train_set")}


# ดาวน์โหลดไฟล์จาก Storage
def download(path: str) -> bytes:
    if not (SUPABASE_URL and SERVICE_KEY):
        raise SystemExit("ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY (ดู .env ที่รากโปรเจกต์)")
    res = httpx.get(
        f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}",
        headers={"Authorization": f"Bearer {SERVICE_KEY}", "apikey": SERVICE_KEY},
        timeout=60,
    )
    res.raise_for_status()
    return res.content


# คลิปที่ล่ามอัด (ไม่นับคลิปที่ถูกปฏิเสธ) พร้อม skeleton จาก Storage
#   คืน dict: word, signer, id, points (T,48,2), t_ms (T,), aspect, fps
#             face (T,47,2) และ face_idx (47,) ถ้าไฟล์เป็นรูปแบบเวอร์ชัน 2 ขึ้นไป (ไม่มี = None)
#             z (T,48) ความลึกของแต่ละจุด ถ้าคลิปบันทึกไว้ (ไม่มี = None)
#   คลิปที่ดาวน์โหลด/อ่านไม่ได้ (ไฟล์หาย/เสีย) ข้ามไป แล้วแจ้งผ่าน on_skip(รหัสคลิป, เหตุผล) แทนการล้มทั้งรอบ
def recorded_samples(conn, min_clips: int = 1, on_skip=None) -> list[dict]:
    rows = conn.execute(
        """
        SELECT w.word, c.name, s.id, s.file_path, s.fps
        FROM samples s
        JOIN words w ON w.id = s.word_id
        LEFT JOIN contributors c ON c.id = s.contributor_id
        WHERE s.status <> 'rejected' AND s.source IN ('record', 'upload')
        ORDER BY w.word, s.created_at
        """
    ).fetchall()
    # ยังไม่ได้ตั้งค่า Storage: ดาวน์โหลดคลิปไม่ได้เลย ข้ามทั้งหมด (เทรนต่อด้วยชุด TSL ได้)
    if not (SUPABASE_URL and SERVICE_KEY):
        if on_skip and rows:
            on_skip(f"ทั้งหมด {len(rows)} คลิป", "ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY ใน .env")
        return []
    per_word: dict[str, int] = {}
    for word, *_ in rows:
        per_word[word] = per_word.get(word, 0) + 1
    out = []
    for word, signer, sid, path, fps in rows:
        if per_word[word] < min_clips:
            continue
        try:
            with np.load(io.BytesIO(download(path)), allow_pickle=False) as d:
                out.append({"word": word, "signer": signer, "id": sid, "points": d["points"],
                            "t_ms": d["t_ms"], "aspect": float(d["aspect"]), "fps": fps,
                            "z": d["z"] if "z" in d.files else None,
                            "face": d["face"] if "face" in d.files else None,
                            "face_idx": d["face_idx"] if "face_idx" in d.files else None})
        except (httpx.HTTPError, OSError, ValueError, KeyError) as e:
            if on_skip:
                on_skip(sid, str(e) or type(e).__name__)
    return out


# คอลัมน์ความคืบหน้าการเทรนในตาราง training_runs (เหมือน backend/sql/002_training_runs_progress.sql)
def ensure_training_columns(conn) -> None:
    conn.execute(
        """
        ALTER TABLE training_runs
            ADD COLUMN IF NOT EXISTS log text,
            ADD COLUMN IF NOT EXISTS progress jsonb,
            ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
            ADD COLUMN IF NOT EXISTS host text,
            ADD COLUMN IF NOT EXISTS error text
        """
    )


# หา id ของคำ (สร้างใหม่ถ้ายังไม่มี)
def word_id(conn, word: str) -> int:
    row = conn.execute(
        "INSERT INTO words (word) VALUES (%s) ON CONFLICT (word) DO UPDATE SET word = EXCLUDED.word RETURNING id",
        (word,),
    ).fetchone()
    return row[0]
