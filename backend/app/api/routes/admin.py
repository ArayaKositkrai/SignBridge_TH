import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from app.api.deps import require_admin, require_staff
from app.core.config import MODELS_DIR
from app.db.models import Model, Motion, TrainingRun, Word
from app.db.session import SessionLocal
from app.ml.model_loader import clear_cache
from app.services import dataset_service as ds
from app.services import model_registry as mr
from app.services import user_service

# กลุ่ม route ของแอดมิน: แดชบอร์ด ผู้ใช้ คลังคำศัพท์ และเวอร์ชันโมเดล
# ทุก route ต้องเป็นแอดมิน ยกเว้นดูรายชื่อผู้ใช้ที่ล่ามใช้เลือกผู้แสดงด้วย
router = APIRouter(prefix="/api/admin", tags=["admin"])
ADMIN = [Depends(require_admin)]
STAFF = [Depends(require_staff)]

# รูปแบบเลขเวอร์ชัน เช่น v0.0.1
VERSION_RE = re.compile(r"v(\d+)\.(\d+)\.(\d+)")
# คำสั่งเทรนโมเดล (รันบนเครื่องที่มี torch: เทรนผ่านหน้าเว็บไม่ได้ เพราะ backend ไม่มี torch และเทรนนานแย่ง CPU เว็บ)
TRAIN_COMMAND = "cd ml/src && python train.py"
# train.py รายงานความคืบหน้าทุกไม่กี่วินาที ถ้าเงียบนานกว่านี้ถือว่าขาดการติดต่อ (ปิดเครื่อง/หลุด)
HEARTBEAT_TIMEOUT = timedelta(minutes=2)
# จำนวนบรรทัด log ท้าย ๆ ที่ส่งให้หน้าเว็บ
LOG_TAIL_LINES = 40
# จำนวนคลิปล่าสุดที่แสดงบนแดชบอร์ด
RECENT_LIMIT = 8

# บทบาทผู้ใช้
Role = Literal["admin", "contributor", "user"]


# ข้อมูลที่รับตอนเพิ่มผู้ใช้
class UserIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    role: Role = "contributor"

    # ไม่รับชื่อว่างหรือมีแต่ช่องว่าง
    @field_validator("name")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v


# ข้อมูลที่รับตอนแก้ไขผู้ใช้ (ส่งเฉพาะช่องที่จะเปลี่ยน)
class UserPatch(BaseModel):
    role: Role | None = None
    active: bool | None = None


# ข้อมูลที่รับตอนเลือก/ไม่เลือกคำไว้เทรน
class TrainWordIn(BaseModel):
    in_train_set: bool


# ช่องข้อมูลผู้ใช้ที่ล่ามเห็นได้ (ใช้เลือกผู้แสดง) — ไม่รวมอีเมลและวันที่สมัคร
STAFF_USER_FIELDS = ("id", "name", "role", "active")


# ข้อมูลที่รับตอนเลือกเวอร์ชันโมเดลที่จะใช้งาน
class ActiveModelIn(BaseModel):
    version: str = Field(min_length=1, max_length=200)


# สถานะของการเทรนหนึ่งครั้ง: running ที่ไม่ได้รายงานนานเกินกำหนด = stalled (ขาดการติดต่อ)
def _run_state(run: TrainingRun) -> str:
    if run.status != "running":
        return run.status
    last = run.heartbeat_at or run.started_at
    return "running" if datetime.now(timezone.utc) - last < HEARTBEAT_TIMEOUT else "stalled"


# เวลาแบบเวลาท้องถิ่นของเซิร์ฟเวอร์ (ไม่มีโซนเวลา) สำหรับแสดงบนหน้าเว็บ
def _local(t: datetime | None) -> str | None:
    return t.astimezone().replace(tzinfo=None).isoformat(timespec="seconds") if t else None


# ---------- แดชบอร์ด ----------


# ภาพรวมระบบ: จำนวนคำ คลิป เฟรม ความยาว ผู้แสดง คุณภาพ คลิปล่าสุด และโมเดลที่ใช้
@router.get("/dashboard", dependencies=ADMIN)
def dashboard():
    samples = ds.all_samples()
    words = ds.all_word_stats()
    signers = Counter(s.get("signer") or "ไม่ระบุ" for s in samples)
    hand_rates = [max(s.get("lh_present_rate", 0), s.get("rh_present_rate", 0)) for s in samples]
    summary = mr.model_summary()
    recent = sorted(samples, key=lambda s: s.get("created_at", ""), reverse=True)[:RECENT_LIMIT]
    return {
        "totals": {
            "words": sum(1 for w in words if w["samples"]),
            "samples": len(samples),
            "frames": sum(s.get("frame_count", 0) for s in samples),
            "duration_ms": round(sum(s.get("duration_ms") or 0 for s in samples)),
            "signers": len([k for k in signers if k != "ไม่ระบุ"]),
            "users": len(user_service.list_users()),
            "without_landmarks": sum(1 for s in samples if not s.get("frame_count")),
            "hand_rate": round(sum(hand_rates) / len(hand_rates), 4) if hand_rates else 0.0,
        },
        "words": sorted(words, key=lambda w: w["samples"], reverse=True),
        "signers": [{"name": k, "samples": v} for k, v in signers.most_common()],
        "recent": recent,
        "model": {
            "active_version": summary["active"]["file"],
            "draft_version": summary["draft"]["file"],
            "words": summary["active"]["words"],
        },
    }


# ---------- ผู้ใช้ ----------


# รายชื่อผู้ใช้ทั้งหมด: แอดมินเห็นข้อมูลเต็ม ล่ามเห็นแค่ชื่อ/บทบาท (ไว้เลือกผู้แสดง ไม่เห็นอีเมลของคนอื่น)
@router.get("/users")
def list_users(me: dict = Depends(require_staff)):
    users = user_service.list_users()
    if me["role"] != "admin":
        users = [{k: u.get(k) for k in STAFF_USER_FIELDS} for u in users]
    return {"users": users}


# เพิ่มผู้ใช้
@router.post("/users", status_code=201, dependencies=ADMIN)
def add_user(body: UserIn):
    try:
        return user_service.add_user(body.name, body.role)
    except user_service.DuplicateName:
        raise HTTPException(status_code=409, detail="มีผู้ใช้ชื่อนี้แล้ว")


# แก้ไขบทบาท/สถานะผู้ใช้
@router.patch("/users/{user_id}")
def update_user(user_id: str, body: UserPatch, me: dict = Depends(require_admin)):
    # กันแอดมินลดสิทธิ์หรือปิดบัญชีตัวเองจนไม่มีใครเข้าหน้าแอดมินได้
    if user_id == me["id"] and (body.role not in (None, "admin") or body.active is False):
        raise HTTPException(status_code=400, detail="เปลี่ยนบทบาทหรือปิดบัญชีของตัวเองไม่ได้")
    user = user_service.update_user(user_id, body.model_dump())
    if user is None:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้")
    return user


# ลบผู้ใช้
@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: str, me: dict = Depends(require_admin)):
    if user_id == me["id"]:
        raise HTTPException(status_code=400, detail="ลบบัญชีของตัวเองไม่ได้")
    if not user_service.delete_user(user_id):
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้")
    return Response(status_code=204)


# ---------- คลังคำศัพท์และท่า ----------


# รวมคลังคำ (คำที่ต้องอัด + ชุดข้อมูล TSL + คลิปที่อัด) กับสถานะในแต่ละเวอร์ชันโมเดล และคลังท่าของอวตาร
@router.get("/vocabulary", dependencies=ADMIN)
def vocabulary():
    summary = mr.model_summary()
    active_words = set(summary["active"]["words"])
    draft_words = set(summary["draft"]["words"])
    with SessionLocal() as db:
        avatar = {
            w: {"gloss": g, "clip": c, "has_motion": m is not None}
            for w, g, c, m in db.execute(
                select(Word.word, Word.gloss, Word.clip_url, Motion.id)
                .outerjoin(Motion, Motion.word_id == Word.id)
                .where(Word.gloss.isnot(None))
            ).all()
        }
    items = []
    for v in ds.vocabulary_items():
        word = v["word"]
        entry = avatar.get(word)
        items.append(
            {
                **v,
                "in_active_model": word in active_words,
                "in_draft_model": word in draft_words,
                "model": mr.word_model_status(word, summary),
                "avatar": {"has_motion": entry["has_motion"], "has_clip": bool(entry["clip"])} if entry else None,
            }
        )
    return {"items": sorted(items, key=lambda v: (not v.get("to_record"), v["word"])), "models": {
        k: {kk: vv for kk, vv in v.items() if kk not in ("words", "per_word")} | {"word_count": len(v["words"])}
        for k, v in summary.items()
    }}


# เลือก/ไม่เลือกคำไว้เทรนโมเดล (คอลัมน์ "เทรน" ในหน้าคลังคำศัพท์) มีผลในการเทรนครั้งถัดไป
@router.patch("/vocabulary/{word}", dependencies=ADMIN)
def set_train_word(word: str, body: TrainWordIn):
    if not ds.set_in_train_set(word, body.in_train_set):
        raise HTTPException(status_code=404, detail="ไม่พบคำนี้ในคลังคำศัพท์")
    return {"word": ds.clean_word(word), "in_train_set": body.in_train_set}


# ---------- เวอร์ชันโมเดล ----------


# รายการโมเดลทุกเวอร์ชัน พร้อมบอกว่าตัวไหนใช้งานอยู่/เป็น draft
@router.get("/models", dependencies=ADMIN)
def list_models():
    models = []
    for row in mr.list_models():
        m = row["model"]
        semver = VERSION_RE.search(m.version)
        models.append(
            {
                "version": m.file,
                "label": m.version,
                "semver": [int(x) for x in semver.groups()] if semver else None,
                "bytes": m.bytes,
                "modified_at": m.trained_at.astimezone().replace(tzinfo=None).isoformat(timespec="seconds"),
                "words": row["word_count"],
                "samples": m.samples,
                "val_accuracy": m.val_accuracy,
                "val_top3": m.val_top3,
                "active": m.status == "active",
                "draft": m.status == "draft",
                "file_missing": not row["exists"],
            }
        )
    active = next((m["version"] for m in models if m["active"]), None)
    draft = next((m["version"] for m in models if m["draft"]), None)
    return {"models": models, "active_version": active, "draft_version": draft}


# เลือกเวอร์ชันโมเดลที่ระบบใช้ (ย้อนกลับไปเวอร์ชันเก่าได้)
@router.post("/models/active", dependencies=ADMIN)
def set_active_model(body: ActiveModelIn):
    with SessionLocal() as db:
        model = db.scalar(select(Model).where(Model.file == body.version))
    if model is None:
        raise HTTPException(status_code=404, detail="ไม่พบโมเดลเวอร์ชันนี้")
    if not (MODELS_DIR / model.file).is_file():
        raise HTTPException(status_code=409, detail=f"ไม่พบไฟล์โมเดล {model.file} ในเครื่องนี้")
    mr.set_active(model.id)
    clear_cache()
    return {"message": f"ตั้ง {model.file} เป็นเวอร์ชันที่ใช้งานแล้ว", "active_version": model.file}


# สถานะการเทรนล่าสุด (อ่านจากตาราง training_runs ที่ train.py เขียน) พร้อมความคืบหน้า log ท้าย ๆ และเวอร์ชัน draft
#   การเทรนรันจากเครื่องด้วยคำสั่ง TRAIN_COMMAND ไม่ได้สั่งจากหน้าเว็บ
@router.get("/train/status", dependencies=ADMIN)
def train_status():
    with SessionLocal() as db:
        run = db.scalar(select(TrainingRun).order_by(TrainingRun.started_at.desc()).limit(1))
        model_file = db.scalar(select(Model.file).where(Model.id == run.model_id)) if run and run.model_id else None
    active, draft = mr.get_by_status("active"), mr.get_by_status("draft")
    status = _run_state(run) if run else "idle"
    if status in ("succeeded", "failed"):
        clear_cache()
    return {
        "status": status,
        "command": TRAIN_COMMAND,
        "run": None if run is None else {
            "id": run.id,
            "host": run.host,
            "started_at": _local(run.started_at),
            "finished_at": _local(run.finished_at),
            "heartbeat_at": _local(run.heartbeat_at),
            "progress": run.progress or {},
            "error": run.error,
            "model": model_file,
            "log": (run.log or "").splitlines()[-LOG_TAIL_LINES:],
        },
        "active_version": active.file if active else None,
        "draft_version": draft.file if draft else None,
    }


# เผยแพร่โมเดล: สลับเวอร์ชัน draft ขึ้นเป็น active (ตัวเดิมเป็น archived)
@router.post("/publish", dependencies=ADMIN)
def publish_model():
    draft = mr.get_by_status("draft")
    if draft is None:
        raise HTTPException(status_code=400, detail="ไม่มีโมเดลเวอร์ชัน Draft ให้เผยแพร่")
    if not (MODELS_DIR / draft.file).is_file():
        raise HTTPException(status_code=409, detail=f"ไม่พบไฟล์โมเดล {draft.file} ในเครื่องเซิร์ฟเวอร์ (ต้องเทรนบนเครื่องเดียวกับ backend หรือคัดลอกไฟล์ไปไว้ที่ ml/models)")
    mr.set_active(draft.id)
    clear_cache()
    return {"message": f"เผยแพร่โมเดล {draft.file} สำเร็จ", "active_version": draft.file}