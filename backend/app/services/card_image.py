import secrets

from fastapi import HTTPException, Response
from sqlalchemy import select

from app.db.models import User
from app.db.session import SessionLocal
from app.services import storage
from app.services.user_service import CARD_IMAGE_PATH

# รูปบัตรคนพิการ: เก็บใน Storage แบบ private ส่งให้ดูผ่าน backend เท่านั้น (เจ้าของ + แอดมิน) ไม่ใช้ลิงก์สาธารณะ
# ขนาดรูปสูงสุด
MAX_BYTES = 5 * 1024 * 1024
# ชนิดรูปที่รับ: ตรวจจากไบต์แรกของไฟล์ (ไม่เชื่อนามสกุล/ชนิดที่เบราว์เซอร์บอก) → (นามสกุล, content-type)
SIGNATURES = (
    (b"\xff\xd8\xff", ("jpg", "image/jpeg")),
    (b"\x89PNG\r\n\x1a\n", ("png", "image/png")),
)
CONTENT_TYPES = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


# หาชนิดรูปจากไบต์แรก คืน (นามสกุล, content-type) หรือ None ถ้าไม่ใช่ jpg/png/webp
def detect(data: bytes) -> tuple[str, str] | None:
    for magic, kind in SIGNATURES:
        if data.startswith(magic):
            return kind
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ("webp", "image/webp")
    return None


# บันทึกรูปบัตรของผู้ใช้ (แทนรูปเดิม) แล้วเก็บ path ลงตาราง users
def save(user_id: str, data: bytes) -> None:
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="รูปใหญ่เกิน 5 MB")
    kind = detect(data)
    if kind is None:
        raise HTTPException(status_code=415, detail="รองรับเฉพาะรูป JPG, PNG หรือ WEBP")
    ext, content_type = kind
    path = CARD_IMAGE_PATH.format(user_id=user_id, token=secrets.token_hex(6), ext=ext)
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user is None:
            raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้")
        old = user.disability_card_image
        storage.upload(path, data, content_type)
        user.disability_card_image = path
        db.commit()
    # ลบรูปเดิมทิ้ง ไม่ให้ค้างใน Storage
    if old and old != path:
        storage.remove([old])


# ลบรูปบัตรของผู้ใช้ (ทั้งใน Storage และในตาราง)
def delete(user_id: str) -> None:
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user is None or not user.disability_card_image:
            return
        path = user.disability_card_image
        user.disability_card_image = None
        db.commit()
    storage.remove([path])


# ส่งรูปบัตรของผู้ใช้ให้หน้าเว็บ (ห้ามเก็บ cache เพราะเป็นข้อมูลส่วนตัว)
def response(user_id: str) -> Response:
    with SessionLocal() as db:
        path = db.scalar(select(User.disability_card_image).where(User.id == user_id))
    data = storage.download(path) if path else None
    if data is None:
        raise HTTPException(status_code=404, detail="ยังไม่มีรูปบัตร")
    ext = path.rsplit(".", 1)[-1]
    return Response(
        data,
        media_type=CONTENT_TYPES.get(ext, "application/octet-stream"),
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )
