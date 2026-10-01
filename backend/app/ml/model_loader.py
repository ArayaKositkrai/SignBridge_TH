import json
from pathlib import Path

from app.core.config import MODEL_CONFIG_PATH, MODELS_DIR

# โค้ดโหลดโมเดลเดิมของคุณ...


# คืนพาธไฟล์โมเดลเวอร์ชันที่ใช้งานอยู่ (หรือ draft ถ้าขอ)
def get_active_model_path(version: str = "active") -> Path:
    with open(MODEL_CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)
    name = config.get("draft_version") if version == "draft" else None
    return MODELS_DIR / (name or config["active_version"])

# ฟังก์ชันโหลดโมเดลให้ใช้ get_active_model_path() เสมอเมื่อมีการเรียกใช้งานแปลภาษา
