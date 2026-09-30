import os
import json
import time
from pathlib import Path

CONFIG_PATH = Path("../configs/model_config.json")
MODELS_PATH = Path("../models")

def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def save_config(data):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

def main():
    print("--- เริ่มกระบวนการฝึกสอนโมเดล (Training)... ---")
    time.sleep(3) # จำลองเวลาในการเทรนโมเดล
    
    # 1. ตั้งชื่อโมเดลเวอร์ชัน Draft ใหม่
    draft_model_name = f"model_v{int(time.time())}_draft.h5"
    
    # สร้างไฟล์โมเดลเปล่าๆ ไว้จำลอง (ในระบบจริงจะเป็นไฟล์น้ำหนักโมเดล H5/PT)
    MODELS_PATH.mkdir(parents=True, exist_ok=True)
    model_file = MODELS_PATH / draft_model_name
    with open(model_file, "w") as f:
        f.write("mock model weights")

    # 2. อัปเดตค่าลงใน model_config.json
    config = load_config()
    config["draft_version"] = draft_model_name
    save_config(config)
    
    print(f"--- เทรนโมเดลเสร็จสิ้น! สร้างเวอร์ชัน {draft_model_name} เรียบร้อย ---")

if __name__ == "__main__":
    main()