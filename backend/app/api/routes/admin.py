import importlib.util
import os
import re
import subprocess
import sys
import threading
from collections import Counter
from functools import lru_cache
from datetime import datetime, timedelta, timezone
from typing import Literal

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select

from app.api.deps import require_admin, require_staff
from app.core.config import MODELS_DIR, TRAIN_SCRIPT
from app.db.models import Model, Motion, TrainingRun, Word
from app.db.session import SessionLocal
from app.ml.classifier import features
from app.ml.model_loader import clear_cache
from app.services import dataset_service as ds
from app.services import model_registry as mr
from app.services import model_store
from app.services import card_image, storage, test_split, user_service
from app.services.user_service import InvalidField

# กลุ่ม route ของแอดมิน: แดชบอร์ด ผู้ใช้ คลังคำศัพท์ และเวอร์ชันโมเดล
# ทุก route ต้องเป็นแอดมิน ยกเว้นดูรายชื่อผู้ใช้ที่ล่ามใช้เลือกผู้แสดงด้วย
router = APIRouter(prefix="/api/admin", tags=["admin"])
ADMIN = [Depends(require_admin)]
STAFF = [Depends(require_staff)]

# รูปแบบเลขเวอร์ชัน เช่น v0.0.1
VERSION_RE = re.compile(r"v(\d+)\.(\d+)\.(\d+)")
# คำสั่งเทรนโมเดลจากเครื่อง (ใช้เมื่อเครื่องที่รัน backend ไม่มี torch หรือไม่อยากให้แย่ง CPU เว็บ)
TRAIN_COMMAND = "cd ml/src && python train.py"
# ไฟล์ที่เก็บ output ของการเทรนที่สั่งจากหน้าเว็บ (log หลักอยู่ในตาราง training_runs อยู่แล้ว)
TRAIN_LOG = MODELS_DIR / "train.log"
# รอดูว่าสคริปต์ล้มทันทีตอนเริ่มไหม (เช่นข้อมูลไม่พอ/มีการเทรนอื่นอยู่) จะได้แจ้งบนหน้าเว็บเลย
TRAIN_STARTUP_WAIT = 4
# สคริปต์วัดผลโมเดลด้วยชุดทดสอบปัจจุบัน (Run Test) และไฟล์ output
EVALUATE_SCRIPT = TRAIN_SCRIPT.with_name("evaluate.py")
EVALUATE_LOG = MODELS_DIR / "evaluate.log"
_eval_proc: subprocess.Popen | None = None
# สคริปต์สร้างท่าอวตารจาก skeleton จริง (ชุด TSL + คลิปที่อัด) ใช้ numpy อย่างเดียว ไม่ต้องมี torch
MOTIONS_SCRIPT = TRAIN_SCRIPT.with_name("build_motions.py")
MOTIONS_LOG = MODELS_DIR / "build_motions.log"
_motion_proc: subprocess.Popen | None = None
# การเทรนที่สั่งจากหน้าเว็บ (มีได้ทีละตัวต่อ backend)
_train_lock = threading.Lock()
_train_proc: subprocess.Popen | None = None
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


# ข้อมูลที่รับตอนแก้ไขผู้ใช้ (ส่งเฉพาะช่องที่จะเปลี่ยน; ค่าว่าง = ลบค่านั้น ยกเว้นชื่อ)
class UserPatch(BaseModel):
    role: Role | None = None
    active: bool | None = None
    first_name: str | None = Field(default=None, max_length=50)
    last_name: str | None = Field(default=None, max_length=50)
    phone: str | None = Field(default=None, max_length=20)
    disability_card_number: str | None = Field(default=None, max_length=20)
    # อีเมล (เฉพาะคนที่ยังไม่มีบัญชีเข้าสู่ระบบ เช่น ล่ามที่แอดมินเพิ่มเอง)
    email: str | None = Field(default=None, max_length=120)


# ตั้งคลิปเป็นชุดเทรน/ทดสอบ
class SampleSplitIn(BaseModel):
    split: Literal["train", "test"]


# ข้อมูลที่รับตอนเลือก/ไม่เลือกคำไว้เทรน
class TrainWordIn(BaseModel):
    in_train_set: bool


# ข้อมูลที่รับตอนเลือก/ไม่เลือกหลายคำไว้เทรนพร้อมกัน
class TrainWordsIn(BaseModel):
    words: list[str] = Field(min_length=1, max_length=5000)
    in_train_set: bool


# คำใหม่ที่แอดมินเพิ่มเข้าคลัง (หมวด, ต้องให้ล่ามอัดไหม)
class WordIn(BaseModel):
    word: str = Field(min_length=1, max_length=50)
    category: str | None = Field(default=None, max_length=60)
    to_record: bool = True


# ช่องข้อมูลผู้ใช้ที่ล่ามเห็นได้ (ใช้เลือกผู้แสดง) — ไม่รวมอีเมลและวันที่สมัคร
STAFF_USER_FIELDS = ("id", "name", "role", "active", "split")


# ข้อมูลที่รับตอนเลือกเวอร์ชันโมเดลที่จะใช้งาน
class ActiveModelIn(BaseModel):
    version: str = Field(min_length=1, max_length=200)


# ไฟล์โมเดลใช้กับโค้ดปัจจุบันได้ไหม: อ่าน feature_version จากตัวไฟล์ (ค่าในตาราง models อาจไม่ตรงกับไฟล์)
#   cache ตามเวลาแก้ไขไฟล์ ไม่ต้องเปิดไฟล์ทุกครั้งที่โหลดหน้า
@lru_cache(maxsize=64)
def _file_compatible(path: str, mtime: float) -> bool:
    try:
        with np.load(path, allow_pickle=False) as d:
            return int(d["feature_version"]) == features().FEATURE_VERSION
    except (OSError, ValueError, KeyError):
        return False


# เช็กไฟล์โมเดลในโฟลเดอร์ ml/models (ไม่มีไฟล์ = None)
def _compatible(file: str) -> bool | None:
    path = MODELS_DIR / file
    return _file_compatible(str(path), path.stat().st_mtime) if path.is_file() else None


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
    users = user_service.list_users()
    signers = Counter(s.get("signer") or "ไม่ระบุ" for s in samples)
    hand_rates = [max(s.get("lh_present_rate", 0), s.get("rh_present_rate", 0)) for s in samples]
    summary = mr.model_summary()
    recent = sorted(samples, key=lambda s: s.get("created_at", ""), reverse=True)[:RECENT_LIMIT]
    return {
        "totals": {
            # จำนวนคำทั้งหมดในคลังคำศัพท์ (ตรงกับหน้าคลังคำศัพท์)
            "words": len(ds.load_vocab()),
            "samples": len(samples),
            "frames": sum(s.get("frame_count", 0) for s in samples),
            "duration_ms": round(sum(s.get("duration_ms") or 0 for s in samples)),
            # ล่าม = ผู้ใช้บทบาทล่ามทั้งหมด (ตรงกับตัวเลข "ล่าม" ในหน้าผู้ใช้)
            "signers": sum(1 for u in users if u["role"] == "contributor"),
            "users": len(users),
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
    users = test_split.annotate_users(user_service.list_users())
    if me["role"] != "admin":
        users = [{k: u.get(k) for k in STAFF_USER_FIELDS} for u in users]
    return {"users": users, "unknown_split": test_split.unknown_signer_split()}


# ตั้งคลิปทั้งหมดของผู้แสดงคนนี้ (ล่าม/แอดมิน/ผู้แสดงไม่มีบัญชี) เป็นชุดเทรนหรือชุดทดสอบ (มีผลตอนเทรนครั้งถัดไป)
@router.put("/users/{user_id}/split", dependencies=ADMIN)
def set_user_split(user_id: str, body: SampleSplitIn):
    user = next((u for u in user_service.list_users() if u["id"] == user_id), None)
    if user is None:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้")
    if user["role"] == "user":
        raise HTTPException(status_code=400, detail="ผู้ใช้ทั่วไปไม่ได้อัดคลิป จึงไม่มีชุดเทรน/ทดสอบ")
    test_split.set_signer_test(user["name"], body.split == "test")
    return test_split.annotate_users([user])[0]


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
    try:
        user = user_service.update_user(user_id, body.model_dump(exclude_unset=True))
    except InvalidField as e:
        raise HTTPException(status_code=422, detail=str(e))
    if user is None:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้")
    return test_split.annotate_users([user])[0]


# ลบผู้ใช้
@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: str, me: dict = Depends(require_admin)):
    if user_id == me["id"]:
        raise HTTPException(status_code=400, detail="ลบบัญชีของตัวเองไม่ได้ (ลบได้ที่หน้าโปรไฟล์)")
    image = user_service.delete_user(user_id)
    if image is None:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้")
    if image:
        try:
            storage.remove([image])
        except HTTPException:
            pass  # ลบผู้ใช้แล้ว รูปที่ลบไม่สำเร็จไม่ควรทำให้ทั้งคำขอล้ม
    return Response(status_code=204)


# ดูรูปบัตรคนพิการของผู้ใช้ (แอดมินเท่านั้น ไว้ตรวจสอบสิทธิ์)
@router.get("/users/{user_id}/card-image", dependencies=ADMIN)
def user_card_image(user_id: str):
    found, _ = user_service.card_image_path(user_id)
    if not found:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้")
    return card_image.response(user_id)


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


# เพิ่มคำใหม่เข้าคลัง (เช่นคำที่ไม่มีในชุด TSL ให้ล่ามอัด) คำซ้ำ = 409
@router.post("/vocabulary", status_code=201, dependencies=ADMIN)
def add_word(body: WordIn):
    word = ds.clean_word(body.word)
    with SessionLocal() as db:
        if db.scalar(select(Word.id).where(Word.word == word)):
            raise HTTPException(status_code=409, detail=f'มีคำว่า "{word}" ในคลังแล้ว')
        db.add(Word(word=word, category=(body.category or "").strip() or None, to_record=body.to_record))
        db.commit()
    return {"word": word}


# เลือก/ไม่เลือกหลายคำไว้เทรนพร้อมกัน (ปุ่ม "เลือกเทรนทั้งหมด" ในหน้าคลังคำศัพท์)
@router.post("/vocabulary/train-set", dependencies=ADMIN)
def set_train_words(body: TrainWordsIn):
    return {"updated": ds.set_in_train_set_many(body.words, body.in_train_set), "in_train_set": body.in_train_set}


# เลือก/ไม่เลือกคำไว้เทรนโมเดล (คอลัมน์ "เทรน" ในหน้าคลังคำศัพท์) มีผลในการเทรนครั้งถัดไป
@router.patch("/vocabulary/{word}", dependencies=ADMIN)
def set_train_word(word: str, body: TrainWordIn):
    if not ds.set_in_train_set(word, body.in_train_set):
        raise HTTPException(status_code=404, detail="ไม่พบคำนี้ในคลังคำศัพท์")
    return {"word": ds.clean_word(word), "in_train_set": body.in_train_set}


# ---------- ชุดทดสอบโมเดล ----------
#   คลิปที่อัดผ่านระบบ: ตั้งตามคนที่หน้าผู้ใช้ (PUT /users/{id}/split) หรือรายคลิปด้านล่าง · ชุด TSL: train.py สุ่ม 20% เอง


# ดูอย่างเดียว: ผู้แสดงในชุดทดสอบของการเทรนครั้งถัดไป พร้อมคลิป/คำ และคำที่ไม่มีคลิปทดสอบ
@router.get("/test-split", dependencies=ADMIN)
def get_test_split():
    return test_split.overview()


# ตั้งคลิปที่ล่ามอัดหนึ่งคลิปเป็นชุดเทรนหรือชุดทดสอบ
@router.patch("/samples/{sample_id}", dependencies=ADMIN)
def set_sample_split(sample_id: str, body: SampleSplitIn):
    if not test_split.set_sample_split(sample_id, body.split):
        raise HTTPException(status_code=404, detail="ไม่พบคลิปนี้")
    return {"id": sample_id, "split": body.split}


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
                # เทรนด้วยรูปแบบ feature ปัจจุบันไหม (รูปแบบเก่าโหลดไม่ได้ ตั้งเป็นตัวที่ใช้ไม่ได้)
                "compatible": _compatible(m.file) is not False,
                # สรุปตัวชี้วัด (ตอนเทรน / Run Test) รายละเอียดเต็มดูที่ /models/{file}/metrics
                "validation": _metric_summary((m.metrics or {}).get("validation")),
                "test": _metric_summary((m.metrics or {}).get("test")),
            }
        )
    active = next((m["version"] for m in models if m["active"]), None)
    draft = next((m["version"] for m in models if m["draft"]), None)
    return {"models": models, "active_version": active, "draft_version": draft}


# ค่าหลักของตัวชี้วัดสำหรับตาราง (ไม่ส่งผลรายคำ/กราฟ ให้หน้ารายการโหลดเร็ว)
METRIC_KEYS = ("clips", "accuracy", "top3", "precision", "recall", "f1", "threshold", "null_false_alarm",
               "word_dropped", "test_set_id", "evaluated_at", "excluded_clips", "seen_test", "final_excludes_test")


def _metric_summary(m: dict | None) -> dict | None:
    return {k: m.get(k) for k in METRIC_KEYS if k in m} if m else None


# ตัวชี้วัดเต็มของโมเดลหนึ่งเวอร์ชัน (ตอนเทรน + Run Test): ผลรายคำ คำที่สับสนกัน เส้นเกณฑ์ ฮิสโตแกรมความมั่นใจ
@router.get("/models/{file}/metrics", dependencies=ADMIN)
def model_metrics(file: str):
    with SessionLocal() as db:
        model = db.scalar(select(Model).where(Model.file == file))
    if model is None:
        raise HTTPException(status_code=404, detail="ไม่พบโมเดลเวอร์ชันนี้")
    return {"version": model.version, "file": model.file, **(model.metrics or {})}


# สั่งวัดผลทุกเวอร์ชันด้วยชุดทดสอบปัจจุบัน (Run Test) ในพื้นหลัง: รัน evaluate.py --all บนเครื่อง backend
@router.post("/models/evaluate", status_code=202, dependencies=ADMIN)
def evaluate_models():
    global _eval_proc
    if not _can_train_here() or not EVALUATE_SCRIPT.is_file():
        raise HTTPException(status_code=409, detail="เครื่องเซิร์ฟเวอร์นี้ไม่มี torch วัดผลจากหน้าเว็บไม่ได้ ให้รัน: cd ml/src && python evaluate.py --all")
    with _train_lock:
        if _eval_proc is not None and _eval_proc.poll() is None:
            raise HTTPException(status_code=409, detail="กำลังวัดผลอยู่แล้ว")
        if _train_proc is not None and _train_proc.poll() is None:
            raise HTTPException(status_code=409, detail="กำลังเทรนอยู่ รอให้เสร็จก่อน")
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        with open(EVALUATE_LOG, "w", encoding="utf-8") as log:
            _eval_proc = subprocess.Popen(
                [sys.executable, str(EVALUATE_SCRIPT), "--all"],
                cwd=EVALUATE_SCRIPT.parent,
                stdout=log,
                stderr=subprocess.STDOUT,
                env={**os.environ, "PYTHONIOENCODING": "utf-8"},
                **_low_priority(),
            )
    return {"message": "เริ่มวัดผลทุกเวอร์ชันแล้ว (ใช้เวลาสักครู่)"}


# สถานะการวัดผลล่าสุด (สั่งจากหน้าเว็บ): running / succeeded / failed / idle พร้อม log ท้าย ๆ
def _eval_state() -> dict:
    if _eval_proc is None:
        return {"status": "idle", "log": []}
    code = _eval_proc.poll()
    status = "running" if code is None else ("succeeded" if code == 0 else "failed")
    lines = EVALUATE_LOG.read_text(encoding="utf-8", errors="replace").splitlines() if EVALUATE_LOG.is_file() else []
    return {"status": status, "log": lines[-LOG_TAIL_LINES:]}


# สั่งสร้างท่าอวตารในพื้นหลัง: รัน build_motions.py บนเครื่อง backend
#   คำเป้าหมาย = คำที่เลือกเทรน + คำที่อวตารทำได้อยู่แล้ว + คำที่ล่ามอัด เลือกคลิปที่ดีที่สุดคำละ 1 คลิป
@router.post("/motions/build", status_code=202, dependencies=ADMIN)
def build_motions():
    global _motion_proc
    if not MOTIONS_SCRIPT.is_file():
        raise HTTPException(status_code=409, detail="ไม่พบสคริปต์ ml/src/build_motions.py บนเครื่องเซิร์ฟเวอร์นี้")
    with _train_lock:
        if _motion_proc is not None and _motion_proc.poll() is None:
            raise HTTPException(status_code=409, detail="กำลังสร้างท่าอวตารอยู่แล้ว")
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        with open(MOTIONS_LOG, "w", encoding="utf-8") as log:
            _motion_proc = subprocess.Popen(
                [sys.executable, "-u", str(MOTIONS_SCRIPT)],
                cwd=MOTIONS_SCRIPT.parent,
                stdout=log,
                stderr=subprocess.STDOUT,
                env={**os.environ, "PYTHONIOENCODING": "utf-8"},
                **_low_priority(),
            )
    return {"message": "เริ่มสร้างท่าอวตารแล้ว (ใช้เวลาสักครู่)"}


# สถานะการสร้างท่าอวตารล่าสุด: running / succeeded / failed / idle พร้อม log ท้าย ๆ
@router.get("/motions/build", dependencies=ADMIN)
def build_motions_status():
    if _motion_proc is None:
        return {"status": "idle", "log": []}
    code = _motion_proc.poll()
    status = "running" if code is None else ("succeeded" if code == 0 else "failed")
    lines = MOTIONS_LOG.read_text(encoding="utf-8", errors="replace").splitlines() if MOTIONS_LOG.is_file() else []
    return {"status": status, "log": lines[-LOG_TAIL_LINES:]}


# เลือกเวอร์ชันโมเดลที่ระบบใช้ (ย้อนกลับไปเวอร์ชันเก่าได้)
@router.post("/models/active", dependencies=ADMIN)
def set_active_model(body: ActiveModelIn):
    with SessionLocal() as db:
        model = db.scalar(select(Model).where(Model.file == body.version))
    if model is None:
        raise HTTPException(status_code=404, detail="ไม่พบโมเดลเวอร์ชันนี้")
    # ไม่มีไฟล์ในเครื่องนี้ = ลองดาวน์โหลดจาก Storage ก่อน
    if not model_store.ensure_local(model.file):
        raise HTTPException(status_code=409, detail=f"ไม่พบไฟล์โมเดล {model.file} ทั้งในเครื่องนี้และใน Storage (ให้คนที่เทรนรัน python -m app.scripts.upload_models)")
    if _compatible(model.file) is False:
        raise HTTPException(status_code=409, detail=f"{model.version} เทรนด้วยรูปแบบข้อมูลเก่า ใช้กับระบบปัจจุบันไม่ได้ ต้องเทรนใหม่")
    mr.set_active(model.id)
    clear_cache()
    return {"message": f"ตั้ง {model.file} เป็นเวอร์ชันที่ใช้งานแล้ว", "active_version": model.file}


# เครื่องที่รัน backend เทรนเองได้ไหม (ต้องมี torch และสคริปต์เทรน)
@lru_cache(maxsize=1)
def _can_train_here() -> bool:
    return TRAIN_SCRIPT.is_file() and importlib.util.find_spec("torch") is not None


# ให้ process เทรนมีลำดับความสำคัญต่ำกว่าเว็บ (เทรนแย่ง CPU แต่หน้าเว็บยังลื่น)
def _low_priority() -> dict:
    if sys.platform == "win32":
        return {"creationflags": subprocess.BELOW_NORMAL_PRIORITY_CLASS}
    return {"preexec_fn": lambda: os.nice(10)}


# สั่งเทรนจากหน้าเว็บ: รัน train.py บนเครื่องที่รัน backend (ความคืบหน้าดูได้จาก /train/status เหมือนเทรนจากเครื่อง)
@router.post("/train", status_code=202)
def start_training(user: dict = Depends(require_admin)):
    global _train_proc
    if not _can_train_here():
        raise HTTPException(
            status_code=409,
            detail=f"เครื่องเซิร์ฟเวอร์นี้ไม่มี torch เทรนจากหน้าเว็บไม่ได้ ให้รันคำสั่งเทรนบนเครื่องที่มี torch แทน: {TRAIN_COMMAND}",
        )
    with _train_lock:
        if _train_proc is not None and _train_proc.poll() is None:
            raise HTTPException(status_code=409, detail="กำลังเทรนอยู่แล้ว")
        if _eval_proc is not None and _eval_proc.poll() is None:
            raise HTTPException(status_code=409, detail="กำลังวัดผล (Run Test) อยู่ รอให้เสร็จก่อน")
        # กันเทรนซ้อนกับเครื่องอื่นที่กำลังเทรนอยู่ (ยังรายงานความคืบหน้าอยู่)
        with SessionLocal() as db:
            busy = db.scalar(
                select(TrainingRun)
                .where(
                    TrainingRun.status == "running",
                    func.coalesce(TrainingRun.heartbeat_at, TrainingRun.started_at) > datetime.now(timezone.utc) - HEARTBEAT_TIMEOUT,
                )
                .limit(1)
            )
        if busy:
            raise HTTPException(status_code=409, detail=f"มีการเทรนกำลังรันอยู่ (เครื่อง {busy.host or 'ไม่ทราบ'}) รอให้เสร็จก่อน")

        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        with open(TRAIN_LOG, "w", encoding="utf-8") as log:
            proc = subprocess.Popen(
                [sys.executable, str(TRAIN_SCRIPT)],
                cwd=TRAIN_SCRIPT.parent,
                stdout=log,
                stderr=subprocess.STDOUT,
                env={**os.environ, "PYTHONIOENCODING": "utf-8", "TRAIN_STARTED_BY": user["id"]},
                **_low_priority(),
            )
        # ล้มทันทีตอนเริ่ม = แจ้งเหตุผลจากท้าย log (เช่น ไม่มีข้อมูลสำหรับเทรน)
        try:
            code = proc.wait(timeout=TRAIN_STARTUP_WAIT)
        except subprocess.TimeoutExpired:
            code = None
        if code:
            tail = [line for line in TRAIN_LOG.read_text(encoding="utf-8", errors="replace").splitlines() if line.strip()]
            raise HTTPException(status_code=400, detail="เทรนไม่สำเร็จ: " + (tail[-1] if tail else f"รหัส {code}"))
        _train_proc = proc
    return {"message": "เริ่มเทรนแล้ว ดูความคืบหน้าได้ที่แท็บการเทรน", "status": "running"}


# ฆ่า process เทรนพร้อมโปรเซสลูก (Windows ต้องใช้ taskkill /T ไม่งั้นลูกค้างอยู่)
def _kill_tree(proc: subprocess.Popen) -> None:
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    else:
        proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


# ยกเลิกการเทรนที่กำลังรันหรือขาดการติดต่อ: ฆ่า process (ถ้าอยู่เครื่องนี้) แล้วปิดแถวเป็น failed จะได้เริ่มใหม่ได้
@router.post("/train/cancel", dependencies=ADMIN)
def cancel_training():
    global _train_proc
    with _train_lock:
        killed = _train_proc is not None and _train_proc.poll() is None
        if killed:
            _kill_tree(_train_proc)
        _train_proc = None
        with SessionLocal() as db:
            run = db.scalar(select(TrainingRun).where(TrainingRun.status == "running").order_by(TrainingRun.started_at.desc()).limit(1))
            if run is None:
                raise HTTPException(status_code=409, detail="ไม่มีการเทรนที่กำลังรันอยู่")
            run.status = "failed"
            run.finished_at = datetime.now(timezone.utc)
            run.error = "ยกเลิกโดยแอดมิน"
            run.progress = {**(run.progress or {}), "stage": "failed"}
            host = run.host
            db.commit()
    if killed:
        return {"message": "ยกเลิกการเทรนแล้ว"}
    return {"message": f"ปิดงานเทรนที่ค้างแล้ว (process อยู่เครื่อง {host or 'อื่น'} ถ้ายังรันอยู่ให้ปิดที่เครื่องนั้น)"}


# ลบโมเดลหนึ่งเวอร์ชัน (ข้อมูลใน database + ไฟล์ในเครื่องนี้ + ย้ายไฟล์ใน Storage ไปถังลบ) ลบตัวที่ใช้งานอยู่ไม่ได้
#   model_words ของเวอร์ชันนี้ถูกลบตาม ส่วนประวัติการเทรนยังอยู่แต่ไม่ผูกกับโมเดลแล้ว
@router.delete("/models/{file}", status_code=204, dependencies=ADMIN)
def delete_model(file: str):
    with SessionLocal() as db:
        model = db.scalar(select(Model).where(Model.file == file))
        if model is None:
            raise HTTPException(status_code=404, detail="ไม่พบโมเดลเวอร์ชันนี้")
        if model.status == "active":
            raise HTTPException(status_code=409, detail="ลบโมเดลที่ใช้งานอยู่ไม่ได้ เปลี่ยนไปใช้เวอร์ชันอื่นก่อน")
        db.delete(model)
        db.commit()
    model_store.remove(file)
    clear_cache()
    return Response(status_code=204)


# สถานะการเทรนล่าสุด (อ่านจากตาราง training_runs ที่ train.py เขียน) พร้อมความคืบหน้า log ท้าย ๆ และเวอร์ชัน draft
#   การเทรนสั่งได้ทั้งจากหน้าเว็บ (POST /train) และจากเครื่องด้วยคำสั่ง TRAIN_COMMAND
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
        # ปุ่ม "เริ่มเทรน" บนหน้าเว็บใช้ได้ไหม (เครื่อง backend มี torch)
        "can_train_here": _can_train_here(),
        # Run Test ที่สั่งจากหน้าเว็บ
        "evaluation": _eval_state(),
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
    # ไม่มีไฟล์ในเครื่องนี้ = ลองดาวน์โหลดจาก Storage ก่อน
    if not model_store.ensure_local(draft.file):
        raise HTTPException(status_code=409, detail=f"ไม่พบไฟล์โมเดล {draft.file} ทั้งในเครื่องนี้และใน Storage (ให้คนที่เทรนรัน python -m app.scripts.upload_models)")
    mr.set_active(draft.id)
    clear_cache()
    return {"message": f"เผยแพร่โมเดล {draft.file} สำเร็จ", "active_version": draft.file}