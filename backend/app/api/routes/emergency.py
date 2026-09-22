from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field, field_validator

from app.services import emergency_service

# กลุ่ม route ของวลีฉุกเฉินที่ผู้ใช้เพิ่มเอง
router = APIRouter(prefix="/api/emergency-phrases", tags=["emergency"])


# ข้อมูลที่รับตอนเพิ่มวลี: ชื่อบนปุ่ม และข้อความที่จะพูด
class PhraseIn(BaseModel):
    label: str = Field(min_length=1, max_length=30)
    speak: str = Field(min_length=1, max_length=200)

    # ไม่รับข้อความที่ว่างหรือมีแต่ช่องว่าง
    @field_validator("label", "speak")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v


# ดึงปุ่มข้อความฉุกเฉินที่เพิ่มไว้ทั้งหมด
@router.get("")
def list_phrases():
    return {"phrases": emergency_service.list_phrases()}


# เพิ่มปุ่มข้อความฉุกเฉิน
@router.post("", status_code=201)
def add_phrase(body: PhraseIn):
    try:
        return emergency_service.add_phrase(body.label, body.speak)
    except emergency_service.LimitReached:
        raise HTTPException(status_code=409, detail="phrase limit reached")


# ลบปุ่มข้อความฉุกเฉิน
@router.delete("/{phrase_id}", status_code=204)
def delete_phrase(phrase_id: str):
    if not emergency_service.delete_phrase(phrase_id):
        raise HTTPException(status_code=404, detail="phrase not found")
    return Response(status_code=204)
