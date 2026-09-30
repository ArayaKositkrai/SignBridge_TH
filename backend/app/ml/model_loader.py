import json
from pathlib import Path

# โค้ดโหลดโมเดลเดิมของคุณ...

def get_active_model_path():
    config_path = Path("../../ml/configs/model_config.json")
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)
    # คืนค่าพาธของโมเดลตัวปัจจุบัน
    return Path(f"../../ml/models/{config['active_version']}")

# ฟังก์ชันโหลดโมเดลให้ใช้ get_active_model_path() เสมอเมื่อมีการเรียกใช้งานแปลภาษา