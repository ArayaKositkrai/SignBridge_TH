from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.nlp.tokenizer import tokenize
from app.services.retrieval_service import find_clips

# กลุ่ม route ของฟีเจอร์ข้อความ -> ภาษามือ
router = APIRouter(prefix="/api", tags=["text-to-sign"])


# ข้อมูลที่รับ: ข้อความที่ต้องการแปล (1-200 ตัวอักษร)
class TextToSignRequest(BaseModel):
    text: str = Field(min_length=1, max_length=200)


# แปลข้อความเป็นรายการคำและท่าทางภาษามือ
@router.post("/text-to-sign")
def text_to_sign(req: TextToSignRequest):
    tokens = tokenize(req.text)
    return {"tokens": tokens, "clips": find_clips(tokens)}
