import time

from sqlalchemy import select

from app.db.models import Motion, Word
from app.db.session import SessionLocal
from app.services.motion_library import get_motion

# จำคลังคำของอวตารไว้ช่วงสั้น ๆ (ตัดคำเรียกทุกครั้งที่แปล)
CACHE_SECONDS = 30
_cache: dict = {"at": 0.0, "vocab": {}, "words_at": 0.0, "words": []}


# คลังคำที่อวตารทำท่าได้ (คำที่มี gloss) จากตาราง words: {คำ: {gloss, word, clip}}
def load_vocabulary() -> dict[str, dict]:
    now = time.monotonic()
    if now - _cache["at"] > CACHE_SECONDS:
        with SessionLocal() as db:
            rows = db.execute(select(Word.word, Word.gloss, Word.clip_url).where(Word.gloss.isnot(None))).all()
        _cache["vocab"] = {w: {"word": w, "gloss": g, "clip": c} for w, g, c in rows}
        _cache["at"] = now
    return _cache["vocab"]


# ค้นหาคลิปและท่าทางของแต่ละคำ (ข้ามคำที่ไม่อยู่ในคลัง)
def find_clips(tokens: list[str]) -> list[dict]:
    vocab = load_vocabulary()
    clips = []
    for token in tokens:
        entry = vocab.get(token)
        if entry:
            clips.append(
                {
                    "gloss": entry["gloss"],
                    "word": entry["word"],
                    "url": entry["clip"],
                    "motion": get_motion(entry["gloss"]),
                }
            )
    return clips


# รายการคำที่อวตารทำท่าได้จริง (มีท่าในตาราง motions) เรียงท่าจากข้อมูลจริงก่อน แล้วตามตัวอักษร
#   ใช้แสดงให้ผู้ใช้หน้า ข้อความ → ภาษามือ เลือกคำ แทนรายการคำตายตัวในหน้าเว็บ
def list_sign_words() -> list[dict]:
    now = time.monotonic()
    if now - _cache["words_at"] > CACHE_SECONDS:
        with SessionLocal() as db:
            rows = db.execute(
                select(Word.word, Motion.source).join(Motion, Motion.word_id == Word.id).where(Word.gloss.isnot(None))
            ).all()
        _cache["words"] = [
            {"word": w, "source": src} for w, src in sorted(rows, key=lambda r: (r[1] != "extracted", r[0]))
        ]
        _cache["words_at"] = now
    return _cache["words"]
