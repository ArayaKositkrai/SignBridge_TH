# ตัวเชื่อมต่อ database (engine + SessionLocal) และคลาสแม่ Base ของทุกตาราง

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import DATABASE_URL, pooled_database_url


# คลาสแม่ของทุกตาราง
class Base(DeclarativeBase):
    pass


if not DATABASE_URL:
    raise RuntimeError("ยังไม่ได้ตั้งค่า DATABASE_URL (ดูไฟล์ .env ที่รากโปรเจกต์)")

# ตัวเชื่อมต่อ database
#   pool_pre_ping: เช็กการเชื่อมต่อก่อนใช้ / pool_recycle: เปิดใหม่ทุก 5 นาที / pool_timeout: รอช่องว่างไม่เกิน 10 วินาที
#   prepare_threshold=None: ปิด prepared statement ฝั่งเซิร์ฟเวอร์ (Supabase pooler แบบ transaction ไม่รองรับ)
#   connect_timeout + keepalives: กันค้างตลอดไปเมื่อสายตาย (เช่นเครื่องเปลี่ยน Wi-Fi) — เดิมค้างทั้ง backend จนเว็บไม่ตอบ
engine = create_engine(
    pooled_database_url(DATABASE_URL),
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=5,
    pool_recycle=300,
    pool_timeout=10,
    connect_args={
        "prepare_threshold": None,
        "connect_timeout": 10,
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 3,
    },
)

# ใช้สร้าง session ต่อหนึ่งงาน: with SessionLocal() as db: ...
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


# เช็กว่าต่อ database ได้หรือไม่
def ping() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
