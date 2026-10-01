import json
from pathlib import Path

from app.core.config import MODEL_CONFIG_PATH, MODELS_DIR


# คืนพาธไฟล์โมเดลเวอร์ชันที่ใช้งานอยู่ (หรือ draft ถ้าขอ) คืน None ถ้ายังไม่ได้ตั้ง
def get_active_model_path(version: str = "active") -> Path | None:
    try:
        with open(MODEL_CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
    except (OSError, ValueError):
        return None
    name = config.get("draft_version") if version == "draft" else None
    name = name or config.get("active_version")
    return MODELS_DIR / name if name else None
