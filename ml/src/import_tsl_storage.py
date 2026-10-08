"""สร้าง tsl_skeleton.npz จากข้อมูลที่โน้ตบุ๊กอัปไว้ใน Supabase Storage (โฟลเดอร์ v1/) แทนการต้องมีไฟล์ parquet/zip ในเครื่อง

ใช้ (ที่รากโปรเจกต์ ต้องมี .env ที่มี SUPABASE_SERVICE_ROLE_KEY และ pip install pyarrow):
    python ml/src/import_tsl_storage.py                 # ดาวน์โหลด v1/ -> สร้าง ml/data/processed/tsl_skeleton.npz
    python ml/src/import_tsl_storage.py --upload        # ทำข้างบน แล้วอัปขึ้น Storage โฟลเดอร์ datasets/tsl_skeleton/
                                                        # (แบ่งเป็นไฟล์ย่อยไม่เกิน ~40 MB เพราะแผนฟรีรับไฟล์ละไม่เกิน 50 MB)
                                                        # เพื่อให้ train.py ของทุกคนดึงเองเมื่อไม่มีไฟล์ในเครื่อง
    python ml/src/import_tsl_storage.py --version v2    # ใช้ข้อมูลเวอร์ชันอื่น

อ่านจาก Storage:  {version}/manifest.json            รายการไฟล์ + SHA-256 (ใช้ตรวจว่าโหลดมาครบและไม่เสีย)
                  {version}/frames/*.parquet         พิกัดทุกเฟรม (เหมือน tsl_merged_frames.parquet แต่แบ่งไฟล์ย่อย)
                  {version}/labels/web_clips.csv     ป้ายชื่อคำ/ผู้แสดง/ชุดข้อมูลต่อคลิป (โน้ตบุ๊กส่วน 6.2 สร้างให้)
ผลลัพธ์รูปแบบเดียวกับ import_tsl.py ทุกประการ (points/offsets/label/signer/source/sample_id/aspect)
ไม่แตะฐานข้อมูล และไม่ลบหรือแก้อะไรใน Storage (--upload เขียนทับเฉพาะ datasets/tsl_skeleton.npz)
"""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path

import httpx
import numpy as np

import db
from import_tsl import ASPECT, BODY_COLS, HAND_COLS, OUT_PATH

CACHE = Path(__file__).resolve().parents[1] / "data" / "raw"
REMOTE_DIR = "datasets/tsl_skeleton"   # index.json + part000.npz, part001.npz, ...
PART_MB = 40                            # ขนาดสูงสุดต่อไฟล์ย่อย (แผนฟรีจำกัด 50 MB)
NEED_COLS = ["clip_id", "sample_id", "source", "signer_id", "label"]


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ดาวน์โหลดไฟล์จาก Storage แล้วตรวจ SHA-256 กับ manifest (ถ้ามี) ก่อนใช้
def fetch(path: str, expected: str | None = None) -> bytes:
    try:
        data = db.download(path)
    except httpx.HTTPStatusError as e:
        raise SystemExit(f"โหลด {path} ไม่ได้ ({e.response.status_code}) — ตรวจว่าโน้ตบุ๊กส่วน 6 อัปครบแล้ว และชื่อ bucket/เวอร์ชันถูกต้อง")
    if expected and _sha256(data) != expected:
        raise SystemExit(f"ไฟล์ {path} ไม่ตรงกับ SHA-256 ใน manifest (ไฟล์เสียหรืออัปไม่ครบ) — อัปโหลดจากโน้ตบุ๊กใหม่")
    return data


# อ่านตารางป้ายชื่อ: sample_id -> {label, signer, source}
def read_labels(raw: bytes) -> dict[str, dict]:
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    if not rows or any(c not in rows[0] for c in NEED_COLS):
        raise SystemExit(f"labels/web_clips.csv ต้องมีคอลัมน์ {NEED_COLS} — รันโน้ตบุ๊กฉบับล่าสุดส่วน 6.2 แล้วอัปใหม่")
    return {r["sample_id"]: {"label": r["label"].strip(), "signer": r["signer_id"], "source": r["source"],
                             "aspect": _aspect(r.get("aspect"), r["source"])} for r in rows}


# สัดส่วนภาพ (กว้าง/สูง) ต่อคลิป: ใช้ค่าจริงถ้ามีในตาราง (ชุดที่สกัดเอง เช่น THSL) ไม่งั้นใช้ค่าประมาณตามชุดข้อมูล
def _aspect(value, source: str) -> float:
    try:
        a = float(value)
    except (TypeError, ValueError):
        a = float("nan")
    return a if 0.2 < a < 5 else ASPECT.get(source, 1.0)


# แปลงตาราง parquet หนึ่งไฟล์เป็นคลิป (ทำเหมือน import_tsl.build) คืน list ของ (sample_id, points(T,48,2))
def clips_from_table(table) -> list[tuple[str, np.ndarray]]:
    sid = np.asarray(table["sample_id"].to_pylist())
    frame = table["frame"].to_numpy()
    coords = np.stack([table[c].to_numpy(zero_copy_only=False).astype(np.float32) for c in BODY_COLS + HAND_COLS], axis=1)
    points = coords.reshape(len(coords), 48, 2)
    order = np.lexsort((frame, sid))
    sid, points = sid[order], points[order]
    names, starts = np.unique(sid, return_index=True)
    offsets = np.append(starts, len(sid))
    return [(str(n), points[offsets[i]:offsets[i + 1]]) for i, n in enumerate(names)]


def build(version: str) -> dict:
    import pyarrow.parquet as pq

    manifest = json.loads(fetch(f"{version}/manifest.json"))
    files = {f["path"]: f for f in manifest["files"]}
    lab_path = f"{version}/labels/web_clips.csv"
    if lab_path not in files:
        raise SystemExit(f"manifest ไม่มี {lab_path} — ข้อมูลชุดนี้ถูกอัปด้วยโน้ตบุ๊กฉบับเก่า รันโน้ตบุ๊กฉบับล่าสุดส่วน 6 แล้วอัปใหม่")
    labels = read_labels(fetch(lab_path, files[lab_path]["sha256"]))
    shards = sorted(p for p in files if p.startswith(f"{version}/frames/") and p.endswith(".parquet"))
    if not shards:
        raise SystemExit(f"ไม่พบไฟล์ frames/*.parquet ใน {version}/")
    CACHE.mkdir(parents=True, exist_ok=True)
    out = {"points": [], "len": [], "label": [], "signer": [], "source": [], "sample_id": [], "aspect": []}
    for p in shards:
        data = fetch(p, files[p]["sha256"])
        local = CACHE / f"{version}_{Path(p).name}"
        local.write_bytes(data)
        cols = ["sample_id", "frame", *BODY_COLS, *HAND_COLS]
        for sid, clip in clips_from_table(pq.read_table(local, columns=cols)):
            m = labels.get(sid)
            if m is None or not len(clip):
                continue  # ไม่มีป้ายชื่อ = ข้าม (ตรงกับ import_tsl ที่ข้ามคลิปที่ไม่มีใน meta)
            out["points"].append(clip); out["len"].append(len(clip))
            out["label"].append(m["label"]); out["signer"].append(m["signer"]); out["source"].append(m["source"])
            out["sample_id"].append(sid); out["aspect"].append(m["aspect"])
        print(f"  โหลด {p}  ({len(out['label'])} คลิปสะสม)")
    if not out["label"]:
        raise SystemExit("ไม่มีคลิปที่ตรงกับป้ายชื่อเลย — ตรวจคอลัมน์ sample_id ในโน้ตบุ๊กกับ frames")
    return {
        "points": np.concatenate(out["points"]).astype(np.float32),
        "offsets": np.concatenate([[0], np.cumsum(out["len"])]).astype(np.int64),
        "label": np.asarray(out["label"]), "signer": np.asarray(out["signer"]), "source": np.asarray(out["source"]),
        "sample_id": np.asarray(out["sample_id"]), "aspect": np.asarray(out["aspect"], dtype=np.float32),
    }


# แบ่งข้อมูลเป็น n ส่วนตามจำนวนคลิป (ตัดที่ขอบคลิป) แต่ละส่วนเป็น dict รูปแบบเดียวกับต้นฉบับ
def split_parts(data: dict, n: int) -> list[dict]:
    clips = len(data["label"]); off = data["offsets"]; out = []
    for idx in np.array_split(np.arange(clips), n):
        if not len(idx):
            continue
        a, b = idx[0], idx[-1] + 1
        part = {k: data[k][a:b] for k in ("label", "signer", "source", "sample_id", "aspect")}
        part["points"] = data["points"][off[a]:off[b]]
        part["offsets"] = (off[a:b + 1] - off[a]).astype(np.int64)
        out.append(part)
    return out


def _npz_bytes(part: dict) -> bytes:
    buf = io.BytesIO(); np.savez_compressed(buf, **part); return buf.getvalue()


def _put(path: str, content: bytes, ctype: str) -> None:
    res = httpx.post(
        f"{db.SUPABASE_URL}/storage/v1/object/{db.BUCKET}/{path}",
        headers={"Authorization": f"Bearer {db.SERVICE_KEY}", "apikey": db.SERVICE_KEY,
                 "Content-Type": ctype, "x-upsert": "true"},
        content=content, timeout=300,
    )
    if res.status_code not in (200, 201):
        raise SystemExit(f"อัป {path} ไม่สำเร็จ ({res.status_code}): {res.text[:200]}")


# อัปขึ้น Storage เป็นไฟล์ย่อยหลายไฟล์ + index.json (ไม่แตะไฟล์อื่น เขียนทับเฉพาะในโฟลเดอร์ datasets/tsl_skeleton/)
def upload(data: dict) -> None:
    limit = PART_MB * 1_000_000
    n = max(1, int(np.ceil(len(_npz_bytes(data)) / (limit * 0.8))))
    while True:
        blobs = [_npz_bytes(p) for p in split_parts(data, n)]
        if max(len(b) for b in blobs) <= limit or n >= len(data["label"]):
            break
        n *= 2
    if max(len(b) for b in blobs) > 50_000_000:
        raise SystemExit("แบ่งไฟล์ให้เล็กกว่า 50 MB ไม่ได้")
    names = [f"part{i:03d}.npz" for i in range(len(blobs))]
    for name, blob in zip(names, blobs):
        _put(f"{REMOTE_DIR}/{name}", blob, "application/octet-stream")
        print(f"  อัป {REMOTE_DIR}/{name}  ({len(blob) / 1e6:.1f} MB)")
    index = {"parts": names, "sha256": [_sha256(b) for b in blobs], "clips": int(len(data["label"]))}
    _put(f"{REMOTE_DIR}/index.json", json.dumps(index).encode(), "application/json")  # อัปท้ายสุด: มีไฟล์นี้ = อัปครบ
    print(f"อัปโหลดแล้ว: {db.BUCKET}/{REMOTE_DIR}/ ({len(blobs)} ไฟล์ย่อย)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", default="v1")
    ap.add_argument("--upload", action="store_true", help="อัป tsl_skeleton.npz ขึ้น Storage ด้วย")
    args = ap.parse_args()
    data = build(args.version)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(OUT_PATH, **data)
    print(f"นำเข้า {len(data['label'])} คลิป ({len(set(data['label']))} คำ, {len(data['points'])} เฟรม) -> {OUT_PATH}")
    if args.upload:
        upload(data)


if __name__ == "__main__":
    main()
