import json
import re
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import HTTPException

from app.core.config import RAW_DATA_DIR, VOCAB_PATH

# อักขระที่ห้ามใช้ในคำศัพท์ (กันการหลุดออกนอกโฟลเดอร์ และชื่อไฟล์ที่ Windows ไม่รับ)
FORBIDDEN_WORD_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
# รูปแบบรหัสคลิป เช่น 20261001-143000-a1b2c3
SAMPLE_ID_RE = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{6}$")
# นามสกุลวิดีโอที่รับ
VIDEO_EXTS = {".mp4", ".webm", ".mov", ".mkv"}


# ตรวจและทำความสะอาดคำศัพท์ ไม่ให้ใช้เป็นพาธหลุดออกนอกโฟลเดอร์ข้อมูล
def clean_word(word: str) -> str:
    word = word.strip()
    if not 1 <= len(word) <= 50:
        raise HTTPException(status_code=400, detail="คำศัพท์ต้องยาว 1-50 ตัวอักษร")
    if FORBIDDEN_WORD_CHARS.search(word) or word.startswith(".") or word.endswith("."):
        raise HTTPException(status_code=400, detail="คำศัพท์มีอักขระที่ไม่อนุญาต")
    return word


# คืนโฟลเดอร์ของคำศัพท์ (ยืนยันว่าอยู่ใต้ RAW_DATA_DIR จริง)
def word_dir(word: str) -> Path:
    path = (RAW_DATA_DIR / clean_word(word)).resolve()
    if path.parent != RAW_DATA_DIR.resolve():
        raise HTTPException(status_code=400, detail="คำศัพท์ไม่ถูกต้อง")
    return path


# สร้างรหัสคลิปใหม่จากเวลา + สุ่ม (ไม่ซ้ำแม้ลบไฟล์หรือบันทึกพร้อมกัน)
def new_sample_id() -> str:
    return f"{datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}"


# ตรวจรหัสคลิปที่รับจาก URL
def check_sample_id(sample_id: str) -> str:
    if not SAMPLE_ID_RE.match(sample_id):
        raise HTTPException(status_code=400, detail="รหัสคลิปไม่ถูกต้อง")
    return sample_id


# สัดส่วนเฟรมที่เจอจุดของส่วนนั้น (เหมือนคอลัมน์ *_present_rate ในชุดข้อมูล TSL)
def _present_rate(frames: list[dict], key: str) -> float:
    if not frames:
        return 0.0
    return round(sum(1 for f in frames if f.get(key)) / len(frames), 4)


# เขียนไฟล์ข้อมูลคลิป: .meta.json (ข้อมูลสรุป + สถิติ) และ .landmarks.json (เฟรม)
def write_sample(folder: Path, meta: dict, frames: list[dict] | None) -> dict:
    sid = meta["id"]
    frames = frames or []
    if frames:
        with open(folder / f"{sid}.landmarks.json", "w", encoding="utf-8") as f:
            json.dump(frames, f, separators=(",", ":"))
    meta["frame_count"] = len(frames)
    meta["pose_present_rate"] = _present_rate(frames, "pose")
    meta["lh_present_rate"] = _present_rate(frames, "leftHand")
    meta["rh_present_rate"] = _present_rate(frames, "rightHand")
    with open(folder / f"{sid}.meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    return meta


# เติมสถิติที่ขาดในคลิปรุ่นเก่า (สัดส่วนมือ ความยาว) จากไฟล์ landmarks แล้วบันทึกกลับ ทำครั้งเดียวต่อคลิป
def _backfill(meta_file: Path, meta: dict) -> dict:
    if "lh_present_rate" in meta:
        return meta
    lm_file = meta_file.with_name(meta_file.name.replace(".meta.json", ".landmarks.json"))
    frames: list[dict] = []
    if lm_file.is_file():
        try:
            frames = json.loads(lm_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            frames = []
    meta["pose_present_rate"] = _present_rate(frames, "pose")
    meta["lh_present_rate"] = _present_rate(frames, "leftHand")
    meta["rh_present_rate"] = _present_rate(frames, "rightHand")
    if not meta.get("duration_ms") and frames and isinstance(frames[-1].get("t"), (int, float)):
        meta["duration_ms"] = round(frames[-1]["t"])
    try:
        meta_file.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass
    return meta


# อ่านข้อมูลสรุปของทุกคลิปในโฟลเดอร์คำศัพท์ (เรียงจากเก่าไปใหม่)
def list_samples(folder: Path) -> list[dict]:
    if not folder.is_dir():
        return []
    samples = []
    for meta_file in folder.glob("*.meta.json"):
        try:
            with open(meta_file, "r", encoding="utf-8") as f:
                samples.append(_backfill(meta_file, json.load(f)))
        except (OSError, ValueError):
            continue
    return sorted(samples, key=lambda s: (s.get("created_at", ""), s.get("id", "")))


# สรุปสถิติของคำหนึ่งคำ: จำนวนคลิป เฟรม ความยาวรวม ผู้แสดง และความครบของมือ
def word_stats(word: str, samples: list[dict]) -> dict:
    n = len(samples)
    hand_rates = [max(s.get("lh_present_rate", 0), s.get("rh_present_rate", 0)) for s in samples]
    return {
        "word": word,
        "samples": n,
        "frames": sum(s.get("frame_count", 0) for s in samples),
        "duration_ms": round(sum(s.get("duration_ms") or 0 for s in samples)),
        "signers": sorted({s["signer"] for s in samples if s.get("signer")}),
        "without_landmarks": sum(1 for s in samples if not s.get("frame_count")),
        "hand_rate": round(sum(hand_rates) / n, 4) if n else 0.0,
        "updated_at": max((s.get("created_at", "") for s in samples), default=None),
    }


# รวมสถิติของทุกคำในชุดข้อมูล (ข้ามโฟลเดอร์ที่ไม่มีคลิปแล้ว)
def all_word_stats() -> list[dict]:
    if not RAW_DATA_DIR.is_dir():
        return []
    stats = []
    for d in sorted(RAW_DATA_DIR.iterdir()):
        if d.is_dir():
            samples = list_samples(d)
            if samples:
                stats.append(word_stats(d.name, samples))
    return stats


# คลังคำที่โหลดไว้ (จำเวลาแก้ไขไฟล์ เพื่อโหลดใหม่เมื่อไฟล์เปลี่ยน)
_vocab_cache: dict = {"mtime": None, "items": []}


# อ่านคลังคำศัพท์จาก vocabulary.json (ไม่มีไฟล์ = รายการว่าง)
def load_vocab() -> list[dict]:
    try:
        mtime = VOCAB_PATH.stat().st_mtime
    except OSError:
        return []
    if _vocab_cache["mtime"] != mtime:
        try:
            _vocab_cache["items"] = json.loads(VOCAB_PATH.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _vocab_cache["items"] = []
        _vocab_cache["mtime"] = mtime
    return _vocab_cache["items"]


# รวมคลังคำกับสถิติคลิปที่อัดจริง (คำที่อัดแต่ไม่อยู่ในคลังก็แสดงด้วย)
def vocabulary_items() -> list[dict]:
    stats = {w["word"]: w for w in all_word_stats()}
    items = []
    seen = set()
    for v in load_vocab():
        items.append({**v, "data": stats.get(v["word"])})
        seen.add(v["word"])
    for word, st in stats.items():
        if word not in seen:
            items.append(
                {
                    "word": word,
                    "category": None,
                    "priority": None,
                    "assigned": None,
                    "note": None,
                    "to_record": False,
                    "external": {},
                    "data": st,
                }
            )
    return items


# ดึงคลิปทั้งหมดของทุกคำ (ใช้ทำแดชบอร์ด)
def all_samples() -> list[dict]:
    if not RAW_DATA_DIR.is_dir():
        return []
    out: list[dict] = []
    for d in RAW_DATA_DIR.iterdir():
        if d.is_dir():
            out.extend(list_samples(d))
    return out
