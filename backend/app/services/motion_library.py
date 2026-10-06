from sqlalchemy import select

from app.db.models import Motion, Word
from app.db.session import SessionLocal


# ดึงท่าทางของคำตาม gloss จากตาราง motions (คำละ 1 ท่า: ท่าจากข้อมูลจริงหรือท่าเขียนมือ)
def get_motion(gloss: str) -> dict | None:
    with SessionLocal() as db:
        m = db.scalar(select(Motion).join(Word, Word.id == Motion.word_id).where(Word.gloss == gloss))
    if m is None:
        return None
    if m.source == "extracted":
        source = {"dataset": m.source_dataset, "signer": m.source_contributor, "clip": m.source_clip}
    else:
        source = {"dataset": "เขียนมือ (ยังไม่มีข้อมูลจริง)"}
    return {"duration": m.duration_ms, "frames": m.frames, "face": m.face or [], "source": source}
