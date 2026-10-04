from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import DATABASE_URL


# คลาสแม่ของทุกตาราง
class Base(DeclarativeBase):
    pass


if not DATABASE_URL:
    raise RuntimeError("ยังไม่ได้ตั้งค่า DATABASE_URL (ดูไฟล์ .env ที่รากโปรเจกต์)")

# ตัวเชื่อมต่อ database (pool_pre_ping กันการเชื่อมต่อค้างที่ถูกตัดไปแล้ว)
engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=5, max_overflow=5)

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
