from sqlalchemy import func, select

from app.db.models import EmergencyPhrase
from app.db.session import SessionLocal

# จำนวนปุ่มที่เพิ่มเองได้สูงสุด (ต่อคน)
MAX_PHRASES = 30
# ไอคอนที่เลือกใช้กับปุ่มได้ (ต้องตรงกับ frontend/src/config/aacIcons.ts)
ALLOWED_ICONS = {
    "star", "food", "water", "toilet", "pain", "confused", "alert", "hand", "users", "volume",
    "check", "close", "pill", "doctor", "hospital", "home", "phone", "bed", "cold", "hot",
    "happy", "sad", "car", "money", "clock", "heart",
}
# ไอคอนเริ่มต้นของปุ่มที่ไม่ได้เลือก
DEFAULT_ICON = "star"


# error เมื่อเพิ่มปุ่มครบจำนวนสูงสุดแล้ว
class LimitReached(Exception):
    pass


# แปลงแถวในตารางเป็น dict รูปแบบเดิมที่ API ส่งออกไป
def _to_dict(p: EmergencyPhrase) -> dict:
    return {"id": p.id, "label": p.label, "speak": p.speak or p.label, "icon": p.icon}


# หาปุ่มของผู้ใช้คนนี้ (ปุ่มของคนอื่นถือว่าไม่พบ)
def _get_own(db, phrase_id: str, user_id: str) -> EmergencyPhrase | None:
    return db.scalar(
        select(EmergencyPhrase).where(EmergencyPhrase.id == phrase_id, EmergencyPhrase.user_id == user_id)
    )


# ดึงปุ่มที่ผู้ใช้คนนี้เพิ่มไว้ เรียงตามลำดับที่เพิ่ม
def list_phrases(user_id: str) -> list[dict]:
    with SessionLocal() as db:
        rows = db.scalars(
            select(EmergencyPhrase)
            .where(EmergencyPhrase.user_id == user_id)
            .order_by(EmergencyPhrase.sort_order, EmergencyPhrase.created_at)
        ).all()
        return [_to_dict(p) for p in rows]


# เพิ่มปุ่มใหม่ให้ผู้ใช้ (ไม่ใส่ข้อความที่พูด = พูดตามชื่อปุ่ม)
def add_phrase(user_id: str, label: str, speak: str, icon: str = DEFAULT_ICON) -> dict:
    with SessionLocal() as db:
        count, last = db.execute(
            select(func.count(), func.max(EmergencyPhrase.sort_order)).where(EmergencyPhrase.user_id == user_id)
        ).one()
        if count >= MAX_PHRASES:
            raise LimitReached
        phrase = EmergencyPhrase(
            user_id=user_id, label=label, speak=speak, icon=icon, sort_order=(last or 0) + 1
        )
        db.add(phrase)
        db.commit()
        return _to_dict(phrase)


# แก้ไขชื่อปุ่ม ข้อความที่พูด และไอคอน คืน None ถ้าไม่พบ (หรือเป็นปุ่มของคนอื่น)
def update_phrase(user_id: str, phrase_id: str, label: str, speak: str, icon: str) -> dict | None:
    with SessionLocal() as db:
        phrase = _get_own(db, phrase_id, user_id)
        if phrase is None:
            return None
        phrase.label, phrase.speak, phrase.icon = label, speak, icon
        db.commit()
        return _to_dict(phrase)


# ลบปุ่ม คืน False ถ้าไม่พบ (หรือเป็นปุ่มของคนอื่น)
def delete_phrase(user_id: str, phrase_id: str) -> bool:
    with SessionLocal() as db:
        phrase = _get_own(db, phrase_id, user_id)
        if phrase is None:
            return False
        db.delete(phrase)
        db.commit()
        return True
