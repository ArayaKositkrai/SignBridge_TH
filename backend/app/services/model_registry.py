import re

from sqlalchemy import func, select, update

from app.core.config import MODELS_DIR
from app.services import model_store
from app.db.models import Model, ModelWord, Word
from app.db.session import SessionLocal

# รูปแบบชื่อไฟล์โมเดลที่มีเลขเวอร์ชัน เช่น model_signBridge_v0.0.2.npz
VERSION_RE = re.compile(r"_v(\d+\.\d+\.\d+)\.[a-z0-9]+$", re.IGNORECASE)
# คลาสของคลิปที่ไม่ได้ทำท่า (ไม่นับเป็นคำ)
NULL_LABEL = "ไม่ทำท่า"


# ชื่อเวอร์ชันสั้นจากชื่อไฟล์ เช่น v0.0.2 (ไม่มีเลขเวอร์ชันคืนชื่อไฟล์เดิม)
def version_label(file: str | None) -> str | None:
    if not file:
        return None
    m = VERSION_RE.search(file)
    return f"v{m.group(1)}" if m else file


# โมเดลตามสถานะ (active / draft) คืน None ถ้าไม่มี
def get_by_status(status: str) -> Model | None:
    with SessionLocal() as db:
        return db.scalar(select(Model).where(Model.status == status))


# คำที่โมเดลรู้จัก พร้อมผลรายคำ: {คำ: (จำนวนคลิปที่เทรน, ความแม่นยำ)}
def model_words(model_id: int) -> dict[str, tuple[int | None, float | None]]:
    with SessionLocal() as db:
        rows = db.execute(
            select(Word.word, ModelWord.train_clips, ModelWord.val_accuracy)
            .join(Word, Word.id == ModelWord.word_id)
            .where(ModelWord.model_id == model_id)
        ).all()
    return {w: (n, acc) for w, n, acc in rows}


# สรุปโมเดลที่ใช้งานและ draft: เวอร์ชัน คำที่รู้จัก ความแม่นยำรวม และความแม่นยำรายคำ (ทดสอบกับคนใหม่)
def model_summary() -> dict:
    out = {}
    for key in ("active", "draft"):
        m = get_by_status(key)
        words = model_words(m.id) if m else {}
        out[key] = {
            "file": m.file if m else None,
            "label": m.version if m else None,
            "words": [w for w in words if w != NULL_LABEL],
            "val_accuracy": m.val_accuracy if m else None,
            "val_top3": m.val_top3 if m else None,
            "per_word": {w: acc for w, (_, acc) in words.items() if acc is not None},
            "trained_at": m.trained_at.astimezone().replace(tzinfo=None).isoformat(timespec="seconds") if m else None,
        }
    return out


# สถานะของคำหนึ่งคำในโมเดลที่ใช้งานและ draft (อยู่ในโมเดลไหม และทายคำนี้ถูกกี่ %)
def word_model_status(word: str, summary: dict) -> dict:
    status = {}
    for key in ("active", "draft"):
        m = summary[key]
        status[key] = {"included": word in m["words"], "accuracy": m["per_word"].get(word)}
    return status


# รายการโมเดลทุกเวอร์ชัน (ใหม่ไปเก่า) พร้อมจำนวนคำ และบอกว่าไฟล์อยู่ในเครื่องนี้หรือไม่
def list_models() -> list[dict]:
    with SessionLocal() as db:
        rows = db.scalars(select(Model).order_by(Model.trained_at.desc(), Model.id.desc())).all()
        # จำนวนคำที่รู้จัก (ไม่นับคลาส "ไม่ทำท่า")
        counts = dict(
            db.execute(
                select(ModelWord.model_id, func.count())
                .join(Word, Word.id == ModelWord.word_id)
                .where(Word.word != NULL_LABEL)
                .group_by(ModelWord.model_id)
            ).all()
        )
    remote = model_store.remote_files()
    out = []
    for m in rows:
        path = MODELS_DIR / m.file
        out.append({
            "model": m,
            "word_count": counts.get(m.id),
            # มีไฟล์ในเครื่องนี้ หรือใน Storage (ดาวน์โหลดมาใช้ได้)
            "exists": path.is_file() or m.file in remote,
        })
    return out


# ตั้งเวอร์ชันที่ใช้งาน: ตัวเดิม → archived, ตัวที่เลือก → active (ถ้าเป็น draft อยู่ draft จะหายไป)
def set_active(model_id: int) -> None:
    with SessionLocal() as db:
        db.execute(update(Model).where(Model.status == "active", Model.id != model_id).values(status="archived"))
        db.execute(update(Model).where(Model.id == model_id).values(status="active"))
        db.commit()
