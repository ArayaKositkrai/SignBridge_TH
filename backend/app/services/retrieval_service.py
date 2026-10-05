import time

from sqlalchemy import select

from app.db.models import Word
from app.db.session import SessionLocal
from app.services.motion_library import get_motion

# จำคลังคำของอวตารไว้ช่วงสั้น ๆ (ตัดคำเรียกทุกครั้งที่แปล)
CACHE_SECONDS = 30
_cache: dict = {"at": 0.0, "vocab": {}}


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
