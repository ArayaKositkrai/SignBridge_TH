# API ปุ่มฉุกเฉิน/AAC ที่ผู้ใช้เพิ่มเอง (/api/emergency-phrases): ดู เพิ่ม แก้ ลบ

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator

from app.api.deps import current_user, require_login
from app.services import emergency_service

# กลุ่ม route ของปุ่มฉุกเฉินที่ผู้ใช้เพิ่มเอง (ปุ่มแยกตามผู้ใช้ ต้องล็อกอินถึงจะเพิ่ม/แก้/ลบได้)
router = APIRouter(prefix="/api/emergency-phrases", tags=["emergency"])


# ข้อมูลที่รับตอนเพิ่ม/แก้วลี: ชื่อบนปุ่ม (บังคับ) ข้อความที่จะพูด (ไม่ใส่ = พูดตามชื่อปุ่ม) และไอคอน
class PhraseIn(BaseModel):
    label: str = Field(min_length=1, max_length=30)
    speak: str = Field(default="", max_length=200)
    icon: str = emergency_service.DEFAULT_ICON

    # ชื่อปุ่มห้ามว่างหรือมีแต่ช่องว่าง
    @field_validator("label")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v

    # ตัดช่องว่างหัวท้ายของข้อความที่พูด
    @field_validator("speak")
    @classmethod
    def strip_speak(cls, v: str) -> str:
        return v.strip()

    # รับเฉพาะไอคอนที่อยู่ในรายการ
    @field_validator("icon")
    @classmethod
    def known_icon(cls, v: str) -> str:
        if v not in emergency_service.ALLOWED_ICONS:
            raise ValueError("unknown icon")
        return v


# ดึงปุ่มของผู้ใช้ที่ล็อกอินอยู่ (ยังไม่ล็อกอิน = ไม่มีปุ่มที่เพิ่มเอง)
@router.get("")
def list_phrases(user: dict | None = Depends(current_user)):
    return {"phrases": emergency_service.list_phrases(user["id"]) if user else []}


# เพิ่มปุ่มข้อความฉุกเฉิน
@router.post("", status_code=201)
def add_phrase(body: PhraseIn, user: dict = Depends(require_login)):
    try:
        return emergency_service.add_phrase(user["id"], body.label, body.speak, body.icon)
    except emergency_service.LimitReached:
        raise HTTPException(status_code=409, detail="phrase limit reached")


# แก้ไขปุ่มข้อความฉุกเฉิน (ชื่อ ข้อความ ไอคอน)
@router.patch("/{phrase_id}")
def update_phrase(phrase_id: str, body: PhraseIn, user: dict = Depends(require_login)):
    item = emergency_service.update_phrase(user["id"], phrase_id, body.label, body.speak, body.icon)
    if item is None:
        raise HTTPException(status_code=404, detail="phrase not found")
    return item


# ลบปุ่มข้อความฉุกเฉิน
@router.delete("/{phrase_id}", status_code=204)
def delete_phrase(phrase_id: str, user: dict = Depends(require_login)):
    if not emergency_service.delete_phrase(user["id"], phrase_id):
        raise HTTPException(status_code=404, detail="phrase not found")
    return Response(status_code=204)
