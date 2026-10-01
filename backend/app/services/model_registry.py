import json
import re
from pathlib import Path

from app.core.config import MODEL_CONFIG_PATH, MODELS_DIR

# รูปแบบชื่อไฟล์โมเดลที่มีเลขเวอร์ชัน เช่น model_signBridge_v0.0.2.npz
VERSION_RE = re.compile(r"_v(\d+\.\d+\.\d+)\.[a-z0-9]+$", re.IGNORECASE)


# อ่านไฟล์ตั้งค่าเวอร์ชันโมเดล (ไฟล์เสีย/ไม่มี = ค่าว่าง)
def load_config() -> dict:
    try:
        return json.loads(MODEL_CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


# ชื่อเวอร์ชันสั้นจากชื่อไฟล์ เช่น v0.0.2 (ไม่มีเลขเวอร์ชันคืนชื่อไฟล์เดิม)
def version_label(file: str | None) -> str | None:
    if not file:
        return None
    m = VERSION_RE.search(file)
    return f"v{m.group(1)}" if m else file


# อ่านข้อมูลประกอบของโมเดล (ไฟล์ .json ข้างไฟล์โมเดล) ไม่มีคืน dict ว่าง
def model_info(file: str | None) -> dict:
    if not file:
        return {}
    sidecar = (MODELS_DIR / Path(file).name).with_suffix(".json")
    try:
        return json.loads(sidecar.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


# สรุปโมเดลที่ใช้งานและ draft: เวอร์ชัน คำที่รู้จัก ความแม่นยำรวม และความแม่นยำรายคำ (ทดสอบกับคนใหม่)
def model_summary() -> dict:
    config = load_config()
    out = {}
    for key, file, words_key in (
        ("active", config.get("active_version"), "words"),
        ("draft", config.get("draft_version"), "draft_words"),
    ):
        info = model_info(file)
        out[key] = {
            "file": file,
            "label": version_label(file),
            "words": config.get(words_key, []) if file else [],
            "val_accuracy": info.get("val_accuracy"),
            "val_top3": info.get("val_top3"),
            "per_word": info.get("val_per_word", {}),
            "trained_at": info.get("trained_at"),
        }
    return out


# สถานะของคำหนึ่งคำในโมเดลที่ใช้งานและ draft (อยู่ในโมเดลไหม และทายคำนี้ถูกกี่ %)
def word_model_status(word: str, summary: dict) -> dict:
    status = {}
    for key in ("active", "draft"):
        m = summary[key]
        status[key] = {"included": word in m["words"], "accuracy": m["per_word"].get(word)}
    return status
