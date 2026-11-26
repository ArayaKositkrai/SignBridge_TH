# API โปรไฟล์ (/api/profile): ดู/แก้ข้อมูลตัวเอง รูปบัตรคนพิการ รหัสผ่าน บัญชีที่เชื่อม และลบบัญชี

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import SESSION_COOKIE, require_login
from app.core.rate_limit import limit_auth
from app.db.models import User, UserIdentity
from app.db.session import SessionLocal
from app.services import auth_service, card_image, storage, user_service
from app.services.user_service import InvalidField

# หน้าโปรไฟล์ของผู้ใช้ที่ล็อกอินอยู่: ดู/แก้ข้อมูลตัวเอง รูปบัตรคนพิการ รหัสผ่าน บัญชีที่เชื่อม และลบบัญชี
router = APIRouter(prefix="/api/profile", tags=["profile"])

# ข้อความที่ต้องพิมพ์ยืนยันก่อนลบบัญชี
DELETE_CONFIRM = "ลบบัญชี"


# ข้อมูลที่แก้ได้ (ส่งเฉพาะช่องที่เปลี่ยน; ส่งค่าว่าง = ลบค่านั้น ยกเว้นชื่อ)
class ProfilePatch(BaseModel):
    first_name: str | None = Field(default=None, max_length=50)
    last_name: str | None = Field(default=None, max_length=50)
    phone: str | None = Field(default=None, max_length=20)
    disability_card_number: str | None = Field(default=None, max_length=20)


# เปลี่ยน/ตั้งรหัสผ่าน (บัญชีที่มีรหัสเดิมต้องใส่รหัสเดิม)
class PasswordIn(BaseModel):
    current_password: str | None = Field(default=None, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)
    # บัญชีที่ยังไม่มีอีเมล (เช่นสมัครด้วย LINE) ใส่อีเมลที่จะใช้ล็อกอินมาด้วย
    email: str | None = Field(default=None, max_length=254)


# ยืนยันการลบบัญชี: พิมพ์ข้อความยืนยัน + รหัสผ่าน (ถ้าบัญชีมีรหัสผ่าน)
class DeleteIn(BaseModel):
    confirm: str = Field(max_length=20)
    password: str | None = Field(default=None, max_length=128)


# ข้อมูลโปรไฟล์ของตัวเองแบบเต็ม (เลขบัตรเต็มเพราะเป็นเจ้าของ)
def _profile(user_id: str) -> dict:
    with SessionLocal() as db:
        user = db.get(User, user_id)
        providers = db.scalars(select(UserIdentity.provider).where(UserIdentity.user_id == user_id)).all()
        return {
            **auth_service.public_user(user, list(providers)),
            "disability_card_number": user_service.format_card(user.disability_card_number),
            "created_at": user.created_at.isoformat(timespec="seconds"),
        }


# เช็กรหัสผ่านของตัวเอง (บัญชีที่ไม่มีรหัสผ่าน เช่นล็อกอินด้วย Google อย่างเดียว ผ่านเสมอ)
def _check_password(user_id: str, password: str | None) -> None:
    with SessionLocal() as db:
        stored = db.scalar(select(User.password_hash).where(User.id == user_id))
    if stored and not auth_service.verify_password(password or "", stored):
        raise HTTPException(status_code=403, detail="รหัสผ่านไม่ถูกต้อง")


# ดูโปรไฟล์ของตัวเอง
@router.get("")
def get_profile(me: dict = Depends(require_login)):
    return _profile(me["id"])


# แก้ข้อมูลส่วนตัว (ชื่อ นามสกุล เบอร์โทร เลขบัตรคนพิการ)
@router.patch("")
def update_profile(body: ProfilePatch, me: dict = Depends(require_login)):
    changes = body.model_dump(exclude_unset=True)
    with SessionLocal() as db:
        user = db.get(User, me["id"])
        try:
            user_service.apply_changes(user, changes)
        except InvalidField as e:
            raise HTTPException(status_code=422, detail=str(e))
        db.commit()
    return _profile(me["id"])


# อัปโหลดรูปบัตรคนพิการ (แทนรูปเดิม)
@router.put("/card-image")
async def upload_card_image(file: UploadFile = File(...), me: dict = Depends(require_login)):
    data = await file.read(card_image.MAX_BYTES + 1)
    card_image.save(me["id"], data)
    return _profile(me["id"])


# ดูรูปบัตรของตัวเอง
@router.get("/card-image")
def get_card_image(me: dict = Depends(require_login)):
    return card_image.response(me["id"])


# ลบรูปบัตรของตัวเอง
@router.delete("/card-image")
def delete_card_image(me: dict = Depends(require_login)):
    card_image.delete(me["id"])
    return _profile(me["id"])


# เปลี่ยนรหัสผ่าน (จำกัดจำนวนครั้งเหมือนการล็อกอิน กันเดารหัสเดิม)
@router.post("/password", dependencies=[Depends(limit_auth)])
def change_password(body: PasswordIn, me: dict = Depends(require_login)):
    _check_password(me["id"], body.current_password)
    with SessionLocal() as db:
        user = db.get(User, me["id"])
        if not user.email:
            try:
                email = user_service.clean_email(body.email)
            except InvalidField as e:
                raise HTTPException(status_code=422, detail=str(e))
            if not email:
                raise HTTPException(status_code=400, detail="กรุณาใส่อีเมลที่จะใช้เข้าสู่ระบบ")
            user.email = email
        user.password_hash = auth_service.hash_password(body.new_password)
        try:
            db.commit()
        except IntegrityError:
            raise HTTPException(status_code=409, detail="อีเมลนี้ถูกใช้สมัครแล้ว")
    return {"message": "เปลี่ยนรหัสผ่านแล้ว"}


# เลิกเชื่อมบัญชี Google/LINE (ต้องเหลือวิธีล็อกอินอื่นอย่างน้อย 1 วิธี ไม่งั้นจะเข้าบัญชีไม่ได้อีก)
@router.delete("/identities/{provider}")
def unlink_identity(provider: str, me: dict = Depends(require_login)):
    with SessionLocal() as db:
        user = db.get(User, me["id"])
        providers = set(db.scalars(select(UserIdentity.provider).where(UserIdentity.user_id == user.id)).all())
        if provider not in providers:
            raise HTTPException(status_code=404, detail="ยังไม่ได้เชื่อมบัญชีนี้")
        if not user.password_hash and len(providers) == 1:
            raise HTTPException(status_code=400, detail="ตั้งรหัสผ่านหรือเชื่อมบัญชีอื่นก่อน ไม่งั้นจะเข้าสู่ระบบไม่ได้อีก")
        db.execute(delete(UserIdentity).where(UserIdentity.user_id == user.id, UserIdentity.provider == provider))
        db.commit()
    return _profile(me["id"])


# ลบบัญชีของตัวเองพร้อมข้อมูลส่วนตัว (รูปบัตรใน Storage, บัญชีที่เชื่อม) แล้วออกจากระบบ
#   คลิปที่เคยอัดยังอยู่ (ไม่ผูกกับผู้ใช้แล้ว) เพราะเป็นข้อมูลของโครงการ
@router.delete("")
def delete_account(body: DeleteIn, me: dict = Depends(require_login)):
    if body.confirm.strip() != DELETE_CONFIRM:
        raise HTTPException(status_code=400, detail=f'กรุณาพิมพ์ "{DELETE_CONFIRM}" เพื่อยืนยัน')
    _check_password(me["id"], body.password)
    if me["role"] == "admin" and user_service.active_admin_count() <= 1:
        raise HTTPException(status_code=400, detail="คุณเป็นแอดมินคนสุดท้าย ตั้งแอดมินคนอื่นก่อนจึงจะลบบัญชีได้")
    image = user_service.delete_user(me["id"])
    if image:
        try:
            storage.remove([image])
        except HTTPException:
            pass  # ลบบัญชีแล้ว รูปที่ลบไม่สำเร็จไม่ควรทำให้ทั้งคำขอล้ม
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response
