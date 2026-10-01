import os
from pathlib import Path

# โฟลเดอร์ ml ของโปรเจกต์ (ตั้งผ่าน env ML_DIR ได้ เช่นตอนรันใน Docker)
ML_DIR = Path(os.getenv("ML_DIR", Path(__file__).resolve().parents[3] / "ml")).resolve()

# ไฟล์ตั้งค่าเวอร์ชันโมเดล (active / draft)
MODEL_CONFIG_PATH = ML_DIR / "configs" / "model_config.json"
# คลังคำศัพท์ของระบบ (สร้างด้วย ml/src/build_vocabulary.py)
VOCAB_PATH = ML_DIR / "configs" / "vocabulary.json"
# โฟลเดอร์เก็บข้อมูลดิบ แยกโฟลเดอร์ย่อยตามคำศัพท์
RAW_DATA_DIR = ML_DIR / "data" / "raw"
# โฟลเดอร์เก็บไฟล์โมเดลที่เทรนแล้ว
MODELS_DIR = ML_DIR / "models"
# สคริปต์เทรนโมเดล
TRAIN_SCRIPT = ML_DIR / "src" / "train_lstm.py"
