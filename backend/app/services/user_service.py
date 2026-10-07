import re

from sqlalchemy import func, select

from app.db.models import User
from app.db.session import SessionLocal

# บทบาทที่ใช้ได้: แอดมิน ล่าม (อัดคลิป) ผู้ใช้ทั่วไป
ROLES = ("admin", "contributor", "user")
# เบอร์โทรไทย: 9-10 หลัก ขึ้นต้นด้วย 0 (บ้าน 02xxxxxxx / มือถือ 08xxxxxxxx)
PHONE_RE = re.compile(r"^0\d{8,9}$")
# ไฟล์รูปบัตรคนพิการของผู้ใช้แต่ละคนใน Storage (ชื่อไฟล์ใหม่ทุกครั้งที่อัป เพราะ Storage cache ไฟล์ชื่อเดิมไว้สักพัก
#   ถ้าใช้ชื่อเดิม เปลี่ยนรูปแล้วอาจยังเห็นรูปเก่า)
CARD_IMAGE_PATH = "users/{user_id}/disability_card_{token}.{ext}"


# error เมื่อชื่อผู้ใช้ซ้ำ
class DuplicateName(Exception):
    pass


# error เมื่อข้อมูลที่ส่งมาไม่ถูกรูปแบบ (ข้อความอ่านได้สำหรับแสดงบนหน้าเว็บ)
class InvalidField(ValueError):
    pass


# จัดรูปเบอร์โทร: ตัดขีด/ช่องว่าง ว่าง = ไม่ระบุ รูปแบบผิด = InvalidField
def clean_phone(value: str | None) -> str | None:
    digits = re.sub(r"[\s\-()]", "", value or "")
    if not digits:
        return None
    if not PHONE_RE.match(digits):
        raise InvalidField("เบอร์โทรต้องเป็นตัวเลข 9-10 หลัก ขึ้นต้นด้วย 0")
    return digits


# จัดรูปเลขบัตรคนพิการ (= เลขบัตรประชาชน 13 หลัก) และตรวจหลักสุดท้าย ว่าง = ไม่ระบุ
def clean_card_number(value: str | None) -> str | None:
    digits = re.sub(r"[\s\-]", "", value or "")
    if not digits:
        return None
    if not re.fullmatch(r"\d{13}", digits):
        raise InvalidField("เลขบัตรต้องเป็นตัวเลข 13 หลัก")
    check = (11 - sum(int(d) * (13 - i) for i, d in enumerate(digits[:12])) % 11) % 10
    if check != int(digits[12]):
        raise InvalidField("เลขบัตรไม่ถูกต้อง (หลักสุดท้ายไม่ตรง) กรุณาตรวจอีกครั้ง")
    return digits


# จัดรูปชื่อ/นามสกุล: ตัดช่องว่าง ห้ามว่าง (ถ้า required) และยาวไม่เกิน 50 ตัวอักษร
def clean_name(value: str | None, required: bool) -> str | None:
    text = (value or "").strip()
    if not text:
        if required:
            raise InvalidField("กรุณากรอกชื่อ")
        return None
    if len(text) > 50:
        raise InvalidField("ชื่อ/นามสกุลยาวได้ไม่เกิน 50 ตัวอักษร")
    return text


# ปิดเลขบัตรบางหลัก เหลือ 3 หลักท้าย เช่น x-xxxx-xxxxx-12-3 (ใช้ตอนแสดงในที่ที่ไม่จำเป็นต้องเห็นเต็ม)
def mask_card(number: str | None) -> str | None:
    if not number:
        return None
    return f"x-xxxx-xxxxx-{number[10:12]}-{number[12]}"


# รูปแบบเลขบัตรสำหรับแสดงเต็ม เช่น 1-2345-67890-12-3
def format_card(number: str | None) -> str | None:
    if not number:
        return None
    return f"{number[0]}-{number[1:5]}-{number[5:10]}-{number[10:12]}-{number[12]}"


# แปลงแถวในตาราง users เป็น dict สำหรับหน้าแอดมิน (แอดมินเห็นข้อมูลบัตรเต็ม)
def _to_dict(user: User) -> dict:
    return {
        "id": user.id,
        # ช่อง name ไว้แสดงผล ส่วนแก้ไขใช้ first_name/last_name
        "name": " ".join(filter(None, [user.first_name, user.last_name])),
        "first_name": user.first_name,
        "last_name": user.last_name,
        "email": user.email,
        "role": user.role,
        "active": user.active,
        "phone": user.phone,
        "disability_card_number": format_card(user.disability_card_number),
        "has_card_image": bool(user.disability_card_image),
        # ไม่มีอีเมล = เพิ่มจากหน้าแอดมินเป็นชื่อผู้แสดงอย่างเดียว ล็อกอินไม่ได้
        "can_login": bool(user.email),
        "created_at": user.created_at.isoformat(timespec="seconds"),
        "last_login_at": user.last_login_at.isoformat(timespec="seconds") if user.last_login_at else None,
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


# ใส่ค่าที่แก้ไขลงแถวผู้ใช้ (เฉพาะช่องที่ส่งมา) พร้อมตรวจรูปแบบ — ใช้ร่วมกันทั้งหน้าแอดมินและหน้าโปรไฟล์
def apply_changes(user: User, changes: dict) -> None:
    if "first_name" in changes:
        user.first_name = clean_name(changes["first_name"], required=True)
    if "last_name" in changes:
        user.last_name = clean_name(changes["last_name"], required=False)
    if "phone" in changes:
        user.phone = clean_phone(changes["phone"])
    if "disability_card_number" in changes:
        user.disability_card_number = clean_card_number(changes["disability_card_number"])
    if changes.get("role") is not None:
        user.role = changes["role"]
    if changes.get("active") is not None:
        user.active = changes["active"]


# แก้ไขผู้ใช้ (แอดมิน) คืน None ถ้าไม่พบ; รูปแบบผิด = InvalidField
def update_user(user_id: str, changes: dict) -> dict | None:
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user is None:
            return None
        apply_changes(user, changes)
        db.commit()
        return _to_dict(user)


# path รูปบัตรคนพิการของผู้ใช้ใน Storage (None = ยังไม่ได้อัป) คืน (พบผู้ใช้ไหม, path)
def card_image_path(user_id: str) -> tuple[bool, str | None]:
    with SessionLocal() as db:
        user = db.get(User, user_id)
        return (user is not None, user.disability_card_image if user else None)


# ลบผู้ใช้ คืน path รูปบัตรที่ต้องลบใน Storage ต่อ (None = ไม่พบผู้ใช้, "" = ไม่มีรูป)
def delete_user(user_id: str) -> str | None:
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user is None:
            return None
        image = user.disability_card_image or ""
        db.delete(user)
        db.commit()
        return image


# จำนวนแอดมินที่ยังใช้งานอยู่ (กันลบ/ลดสิทธิ์แอดมินคนสุดท้าย)
def active_admin_count() -> int:
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(User).where(User.role == "admin", User.active.is_(True))) or 0
