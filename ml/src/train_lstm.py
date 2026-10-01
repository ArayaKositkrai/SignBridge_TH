import json
import os
import re
import time
from datetime import datetime
from pathlib import Path

# โฟลเดอร์ ml (อ้างจากตำแหน่งไฟล์นี้ ไม่ขึ้นกับโฟลเดอร์ที่สั่งรัน)
ML_DIR = Path(__file__).resolve().parents[1]
# ไฟล์ตั้งค่าเวอร์ชันโมเดล
CONFIG_PATH = ML_DIR / "configs" / "model_config.json"
# โฟลเดอร์เก็บไฟล์โมเดล
MODELS_PATH = ML_DIR / "models"
# โฟลเดอร์ข้อมูลดิบที่ contributor อัดไว้ (แยกโฟลเดอร์ตามคำ)
RAW_PATH = ML_DIR / "data" / "raw"
# ชื่อไฟล์โมเดลแบบมีเลขเวอร์ชัน เช่น model_signBridge_v0.0.1.h5
MODEL_NAME = "model_signBridge_v{}.{}.{}.h5"
# รูปแบบสำหรับอ่านเลขเวอร์ชันจากชื่อไฟล์
VERSION_RE = re.compile(r"^model_signBridge_v(\d+)\.(\d+)\.(\d+)\.h5$")


# อ่านไฟล์ตั้งค่าเวอร์ชันโมเดล
def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


# เขียนไฟล์ตั้งค่าแบบปลอดภัย (เขียนไฟล์ชั่วคราวแล้วแทนที่)
def save_config(data):
    tmp = CONFIG_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
    os.replace(tmp, CONFIG_PATH)


# นับจำนวนคลิปของแต่ละคำในโฟลเดอร์ข้อมูลดิบ
def count_samples():
    if not RAW_PATH.is_dir():
        return {}
    counts = {d.name: len(list(d.glob("*.meta.json"))) for d in RAW_PATH.iterdir() if d.is_dir()}
    return {w: n for w, n in sorted(counts.items()) if n > 0}


# หาเลขเวอร์ชันถัดไป: ยังไม่มี = 0.0.0, มีแล้ว = เลขท้ายของเวอร์ชันล่าสุด + 1
def next_version() -> tuple[int, int, int]:
    found = [
        tuple(int(x) for x in m.groups())
        for p in MODELS_PATH.glob("*.h5")
        if (m := VERSION_RE.match(p.name))
    ]
    if not found:
        return (0, 0, 0)
    major, minor, patch = max(found)
    return (major, minor, patch + 1)


# เทรนโมเดล (ตอนนี้เป็นการจำลอง) แล้วตั้งเป็นเวอร์ชัน draft
def main():
    print("--- เริ่มกระบวนการฝึกสอนโมเดล (Training)... ---", flush=True)
    counts = count_samples()
    if not counts:
        raise SystemExit("ไม่พบคลิปใน ml/data/raw")
    for word, n in counts.items():
        print(f"  {word}: {n} คลิป", flush=True)

    time.sleep(3)  # จำลองเวลาในการเทรนโมเดล

    # 1. ตั้งชื่อโมเดลเวอร์ชันถัดไป เช่น model_signBridge_v0.0.1.h5
    MODELS_PATH.mkdir(parents=True, exist_ok=True)
    version = next_version()
    draft_model_name = MODEL_NAME.format(*version)

    # สร้างไฟล์โมเดลเปล่าๆ ไว้จำลอง (ในระบบจริงจะเป็นไฟล์น้ำหนักโมเดล H5/PT)
    with open(MODELS_PATH / draft_model_name, "w") as f:
        f.write("mock model weights")

    # เขียนข้อมูลประกอบเวอร์ชัน (คำ จำนวนคลิป เวลาเทรน) ไว้ข้างไฟล์โมเดล
    info = {
        "version": "v{}.{}.{}".format(*version),
        "file": draft_model_name,
        "trained_at": datetime.now().isoformat(timespec="seconds"),
        "words": counts,
        "samples": sum(counts.values()),
    }
    (MODELS_PATH / draft_model_name).with_suffix(".json").write_text(
        json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 2. อัปเดตค่าลงใน model_config.json (รวมรายการคำที่โมเดลนี้รู้จัก)
    config = load_config()
    config["draft_version"] = draft_model_name
    config["draft_words"] = list(counts)
    save_config(config)

    print(f"--- เทรนโมเดลเสร็จสิ้น! สร้างเวอร์ชัน {draft_model_name} เรียบร้อย ---", flush=True)


if __name__ == "__main__":
    main()
