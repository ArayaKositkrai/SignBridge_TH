from sqlalchemy import func, select

from app.db.models import User
from app.db.session import SessionLocal

# บทบาทที่ใช้ได้: แอดมิน ล่าม (อัดคลิป) ผู้ใช้ทั่วไป
ROLES = ("admin", "contributor", "user")


# error เมื่อชื่อผู้ใช้ซ้ำ
class DuplicateName(Exception):
    pass


# แปลงแถวในตารางเป็น dict รูปแบบเดิมที่ API ส่งออกไป
def _to_dict(user: User) -> dict:
    return {
        "id": user.id,
        # หน้าแอดมินใช้ช่อง name ช่องเดียว ส่วนตาราง users แยกชื่อ/นามสกุล
        "name": " ".join(filter(None, [user.first_name, user.last_name])),
        "email": user.email,
        "role": user.role,
        "active": user.active,
        "created_at": user.created_at.isoformat(timespec="seconds"),
    }


# ดึงผู้ใช้ทั้งหมด
def list_users() -> list[dict]:
    with SessionLocal() as db:
        users = db.scalars(select(User).order_by(User.created_at)).all()
        return [_to_dict(u) for u in users]


# เพิ่มผู้ใช้ใหม่ (ชื่อห้ามซ้ำ ไม่สนตัวพิมพ์เล็กใหญ่)
def add_user(name: str, role: str) -> dict:
    with SessionLocal() as db:
        if db.scalar(select(User.id).where(func.lower(User.first_name) == name.lower())):
            raise DuplicateName
        user = User(first_name=name, role=role, active=True)
        db.add(user)
        db.commit()
        db.refresh(user)
        return _to_dict(user)


# แก้ไขบทบาทหรือสถานะใช้งานของผู้ใช้ คืน None ถ้าไม่พบ
def update_user(user_id: str, changes: dict) -> dict | None:
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user is None:
            return None
        for key, value in changes.items():
            if value is not None:
                setattr(user, key, value)
        db.commit()
        return _to_dict(user)


# ลบผู้ใช้ คืน False ถ้าไม่พบ
def delete_user(user_id: str) -> bool:
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user is None:
            return False
        db.delete(user)
        db.commit()
        return True
