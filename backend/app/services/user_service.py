# จัดการผู้ใช้: ตรวจ/จัดรูปข้อมูล (ชื่อ อีเมล เบอร์ เลขบัตร) เพิ่ม แก้ ลบ และค้นหาผู้ใช้

import re

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.db.models import User, UserIdentity
from app.db.session import SessionLocal

# บทบาทที่ใช้ได้: แอดมิน ล่าม (อัดคลิป) ผู้ใช้ทั่วไป
ROLES = ("admin", "contributor", "user")
# รูปแบบอีเมลแบบหยาบ (มี @ และโดเมนมีจุด)
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
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


# บทบาทที่เก็บข้อมูลบัตรคนพิการ (เลขบัตร + รูปบัตร): ผู้ใช้ทั่วไปเท่านั้น ล่าม/แอดมินไม่ต้องใช้
CARD_ROLES = {"user"}


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


# ตรวจและทำความสะอาดอีเมล (ว่าง = None)
def clean_email(value: str | None) -> str | None:
    text = (value or "").strip().lower()
    if not text:
        return None
    if len(text) > 120 or not EMAIL_RE.match(text):
        raise InvalidField("รูปแบบอีเมลไม่ถูกต้อง")
    return text


# ผู้ใช้ที่ผูกบัญชี Google/LINE แล้ว (ไว้บอกว่าเข้าสู่ระบบได้ไหม)
def _with_identity(db, user_ids: list[str] | None = None) -> set[str]:
    q = select(UserIdentity.user_id).distinct()
    if user_ids is not None:
        q = q.where(UserIdentity.user_id.in_(user_ids))
    return set(db.scalars(q).all())


# แปลงแถวในตาราง users เป็น dict สำหรับหน้าแอดมิน (แอดมินเห็นข้อมูลบัตรเต็ม)
#   has_identity = ผูกบัญชี Google/LINE แล้ว
def _to_dict(user: User, has_identity: bool = False) -> dict:
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
        # เข้าสู่ระบบได้ = มีรหัสผ่าน หรือผูกบัญชี Google/LINE แล้ว
        #   (ล่ามที่แอดมินเพิ่มเองยังเข้าไม่ได้ ใส่อีเมลไว้ได้ แล้วล็อกอินด้วย Google อีเมลนั้นจะเข้าบัญชีนี้เลย)
        "can_login": bool(user.password_hash) or has_identity,
        "created_at": user.created_at.isoformat(timespec="seconds"),
        "last_login_at": user.last_login_at.isoformat(timespec="seconds") if user.last_login_at else None,
    }


# ดึงผู้ใช้ทั้งหมด
def list_users() -> list[dict]:
    with SessionLocal() as db:
        users = db.scalars(select(User).order_by(User.created_at)).all()
        linked = _with_identity(db)
        return [_to_dict(u, u.id in linked) for u in users]


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
    if changes.get("role") is not None:
        user.role = changes["role"]
    if "disability_card_number" in changes:
        number = clean_card_number(changes["disability_card_number"])
        if number and user.role not in CARD_ROLES:
            raise InvalidField("บทบาทนี้ไม่เก็บข้อมูลบัตรคนพิการ (เฉพาะผู้ใช้ทั่วไป)")
        user.disability_card_number = number
    if changes.get("active") is not None:
        user.active = changes["active"]


# แก้ไขผู้ใช้ (แอดมิน) คืน None ถ้าไม่พบ; รูปแบบผิด = InvalidField
#   อีเมล: แก้ได้เฉพาะคนที่ยังไม่มีบัญชีเข้าสู่ระบบ (บัญชีที่ล็อกอินได้ใช้อีเมลเป็นตัวตน เปลี่ยนไม่ได้)
def update_user(user_id: str, changes: dict) -> dict | None:
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user is None:
            return None
        linked = user_id in _with_identity(db, [user_id])
        if "email" in changes:
            email = clean_email(changes["email"])
            if email != user.email:
                if user.password_hash or linked:
                    raise InvalidField("บัญชีนี้เข้าสู่ระบบด้วยอีเมลเดิมอยู่ เปลี่ยนอีเมลไม่ได้")
                user.email = email
        apply_changes(user, changes)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise InvalidField("อีเมลนี้มีผู้ใช้คนอื่นใช้แล้ว")
        return _to_dict(user, linked)


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
