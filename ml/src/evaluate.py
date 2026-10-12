"""วัดผลโมเดลด้วยชุดทดสอบปัจจุบัน (Run Test) — ทุกเวอร์ชันวัดด้วยชุดเดียวกัน จึงเทียบกันได้ตรง ๆ

ใช้ (ในโฟลเดอร์ ml/src):
    python evaluate.py --all                         # ทุกเวอร์ชันที่ใช้กับโค้ดปัจจุบันได้
    python evaluate.py model_signBridge_v0.0.8.npz   # เฉพาะไฟล์ที่ระบุ

ชุดทดสอบเลือกแบบเดียวกับ train.py (TSL สุ่ม 20%, คลิปที่อัดผ่านระบบตามคนที่ตั้งเป็นทดสอบ) ใช้แค่คลิปในชุดทดสอบ ไม่ได้เทรนอะไร
คำในชุดทดสอบที่โมเดลเวอร์ชันนั้นไม่รู้จัก ไม่นับ (บอกจำนวนไว้ใน excluded_clips)
ผลเก็บใน models.metrics.test (ตัวชี้วัดชุดเดียวกับตอนเทรน ดู metrics.py) แสดงในหน้าแอดมิน → โมเดล
ไฟล์โมเดลที่ไม่มีในเครื่องจะดาวน์โหลดจาก Storage (models/)
"""
import argparse
import io
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402
import features as F  # noqa: E402
import metrics as M  # noqa: E402
import train as T  # noqa: E402  (ใช้ตัวโหลดข้อมูลและการแบ่งชุดทดสอบตัวเดียวกับตอนเทรน)


def log(msg: str) -> None:
    print(msg, flush=True)


# โหลดไฟล์โมเดล (ในเครื่อง หรือดาวน์โหลดจาก Storage) คืน dict ของ array หรือ None ถ้าหาไม่เจอ
def load_model(file: str) -> dict | None:
    path = T.MODELS_PATH / file
    try:
        raw = path.read_bytes() if path.is_file() else db.download(db.model_storage_path(file))
    except Exception:  # noqa: BLE001
        log(f"  {file}: หาไฟล์ไม่เจอทั้งในเครื่องและใน Storage (ให้คนที่เทรนรัน python -m app.scripts.upload_models) ข้าม")
        return None
    with np.load(io.BytesIO(raw), allow_pickle=False) as d:
        return {k: d[k] for k in d.files}


# โมเดลเทรนด้วยคลิปที่เห็นใบหน้าไหม (เหมือน SignModel._trained_with_face ใน backend)
def uses_face(weights: dict) -> bool:
    face_seen = F.N_POINTS * 4 + 2 + F.N_FACE_FEAT
    std = weights.get("std")
    return std is not None and std.shape[-1] > face_seen and float(std[face_seen]) > 1e-3


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*", help="ชื่อไฟล์โมเดล (ไม่ใส่ = ใช้ --all)")
    ap.add_argument("--all", action="store_true", help="วัดทุกเวอร์ชันที่ลงทะเบียนไว้")
    args = ap.parse_args()

    conn = db.connect()
    db.ensure_model_columns(conn)
    cfg = db.train_settings()
    words = db.train_words(conn)
    rows = conn.execute("SELECT file, version, metrics FROM models ORDER BY trained_at").fetchall()
    registered = {f: v for f, v, _ in rows}
    validation = {f: (m or {}).get("validation") or {} for f, _, m in rows}
    files = args.files or (list(registered) if args.all else [])
    if not files:
        raise SystemExit("ระบุไฟล์โมเดล หรือใส่ --all")

    log("--- Run Test: วัดผลด้วยชุดทดสอบปัจจุบัน ---")
    clips = T.load_tsl(words, cfg.get("include_null_class", True)) + T.load_recorded(conn, cfg.get("min_recorded_clips", 5))
    labels_raw = [c[2] for c in clips]
    signers = [c[3] for c in clips]
    sources = [c[4] for c in clips]
    clip_test = [c[6] for c in clips]
    is_val, val_signers, _ = T.split_test(conn, signers, sources, clip_test, labels_raw)
    test = [c for c, v in zip(clips, is_val) if v]
    if not test:
        raise SystemExit("ชุดทดสอบว่าง (ยังไม่มีผู้แสดงให้กันไว้ทดสอบ)")
    set_id = T.test_set_id(val_signers, len(test))
    log(f"ชุดทดสอบ: {len(test)} คลิป จากผู้แสดง {len(val_signers)} คน (รหัส {set_id})")

    # แปลงเป็น feature ครั้งเดียว 2 แบบ (มี/ไม่มีใบหน้า) ใช้กับทุกเวอร์ชัน
    feats = {flag: [F.clip_features(c[0], c[1], c[5] if flag else None) for c in test] for flag in (False, True)}

    for file in files:
        weights = load_model(file)
        if weights is None:
            continue
        if int(weights.get("feature_version", -1)) != F.FEATURE_VERSION:
            log(f"  {registered.get(file, file)}: รูปแบบข้อมูลเก่า ข้าม")
            continue
        labels = [str(x) for x in weights.pop("labels")]
        weights.pop("feature_version", None)
        weights.pop("threshold", None)
        idx = {l: i for i, l in enumerate(labels)}
        face = uses_face(weights)
        probs, y, excluded = [], [], 0
        for c, f in zip(test, feats[face]):
            if f is None or c[2] not in idx:
                excluded += 1
                continue
            probs.append(F.predict_proba(weights, f))
            y.append(idx[c[2]])
        if not probs:
            log(f"  {registered.get(file, file)}: ไม่มีคลิปในชุดทดสอบที่โมเดลนี้รู้จัก")
            continue
        result = M.compute(np.stack(probs), np.array(y), labels)
        # โมเดลเคยเห็นชุดทดสอบนี้ตอนเทรนไหม: เชื่อผลได้เฉพาะโมเดลที่เทรนรอบสุดท้ายโดยกันชุดทดสอบเดียวกันนี้ออก
        val = validation.get(file, {})
        seen = not (val.get("final_excludes_test") and val.get("test_set_id") == set_id)
        result.update(test_set_id=set_id, excluded_clips=excluded, seen_test=seen,
                      evaluated_at=datetime.now().astimezone().isoformat(timespec="seconds"))
        conn.execute(
            "UPDATE models SET metrics = jsonb_set(COALESCE(metrics, '{}'::jsonb), '{test}', %s) WHERE file = %s",
            (Jsonb(result), file),
        )
        log(f"  {registered.get(file, file)}: ถูก {result['accuracy']:.1%} · F1 {result['f1']:.1%} · {result['clips']} คลิป"
            + (f" (ไม่นับ {excluded} คลิปที่ไม่รู้จัก)" if excluded else "")
            + (" ⚠ โมเดลนี้เคยเห็นชุดทดสอบตอนเทรน ผลสูงเกินจริง" if seen else ""))
    conn.close()
    log("--- Run Test เสร็จ ---")


if __name__ == "__main__":
    main()
