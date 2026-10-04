import os
from pathlib import Path

from dotenv import load_dotenv

# โหลดค่าจากไฟล์ .env ที่รากโปรเจกต์ (ตอนรัน uvicorn เองนอก Docker)
# ไม่ทับค่าที่ตั้งไว้ใน env อยู่แล้ว
load_dotenv(Path(__file__).resolve().parents[3] / ".env")

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
TRAIN_SCRIPT = ML_DIR / "src" / "train.py"
# โมดูลแปลง skeleton เป็น feature (ใช้ร่วมกับตอนเทรน)
FEATURES_PATH = ML_DIR / "src" / "features.py"

# URL ของ database (อ่านจาก env DATABASE_URL ซึ่ง docker-compose โหลดมาจากไฟล์ .env)
# รูปแบบ: postgresql+psycopg://user:password@host:port/dbname
DATABASE_URL = os.getenv("DATABASE_URL", "")

# ---------- ระบบล็อกอิน ----------
# กุญแจลับสำหรับเซ็น session (ต้องตั้งเอง ห้ามใช้ค่าเดียวกับเครื่องอื่น)
AUTH_SECRET = os.getenv("AUTH_SECRET", "")
# อายุ session (วัน)
SESSION_DAYS = int(os.getenv("SESSION_DAYS", "7"))
# อีเมลที่สมัคร/ล็อกอินแล้วได้เป็นแอดมินทันที คั่นด้วยจุลภาค (ใช้ตั้งแอดมินคนแรก)
ADMIN_EMAILS = {e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()}
# ส่ง cookie เฉพาะ https (ตั้งเป็น 1 ตอนขึ้นเซิร์ฟเวอร์จริง)
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "0") == "1"
# ที่อยู่ backend ที่เบราว์เซอร์เข้าถึงได้ ใช้สร้าง redirect URI ของ Google/LINE
PUBLIC_API_URL = os.getenv("PUBLIC_API_URL", "http://localhost:8000").rstrip("/")
# ค่าจาก Google Cloud Console (OAuth client แบบ Web application)
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
# ค่าจาก LINE Developers Console (LINE Login channel)
LINE_CHANNEL_ID = os.getenv("LINE_CHANNEL_ID", "")
LINE_CHANNEL_SECRET = os.getenv("LINE_CHANNEL_SECRET", "")
