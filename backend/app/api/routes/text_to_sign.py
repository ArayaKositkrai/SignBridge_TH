# API ข้อความ → ภาษามือ: ตัดคำแล้วคืนท่าทางของแต่ละคำให้อวตารเล่น

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.nlp.tokenizer import analyze
from app.services.retrieval_service import find_clips, list_sign_words

# กลุ่ม route ของฟีเจอร์ข้อความ -> ภาษามือ
router = APIRouter(prefix="/api", tags=["text-to-sign"])


# ข้อมูลที่รับ: ข้อความที่ต้องการแปล (1-200 ตัวอักษร)
class TextToSignRequest(BaseModel):
    text: str = Field(min_length=1, max_length=200)


# แปลข้อความเป็นรายการคำและท่าทางภาษามือ
#   แก้คำพิมพ์ผิด/คำเรียกอื่นให้ (fixes) บอกคำที่ยังไม่มีท่า (no_sign) และส่วนที่อ่านไม่ออกพร้อมคำแนะนำ (unknown)
@router.post("/text-to-sign")
def text_to_sign(req: TextToSignRequest):
    result = analyze(req.text)
    return {**result, "clips": find_clips(result["tokens"])}


# รายการคำที่อวตารทำท่าได้ (จากฐานข้อมูล) ไว้ให้ผู้ใช้กดเลือก
@router.get("/text-to-sign/words")
def sign_words():
    return {"words": list_sign_words()}
