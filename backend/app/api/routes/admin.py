import json
import os
import re
import subprocess
import sys
import threading
from collections import Counter
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select

from app.api.deps import require_admin, require_staff
from app.core.config import ML_DIR, MODELS_DIR, TRAIN_SCRIPT
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
# ชุดข้อมูล TSL ที่นำเข้าแล้ว (สร้างด้วย ml/src/import_tsl.py)
TSL_DATA_PATH = ML_DIR / "data" / "processed" / "tsl_skeleton.npz"
# ตั้งค่าการเทรน (จำนวนคลิปขั้นต่ำต่อคำ ฯลฯ)
TRAIN_SETTINGS_PATH = ML_DIR / "configs" / "train_words.json"
# ไฟล์ log ของการเทรนล่าสุด
TRAIN_LOG = MODELS_DIR / "train.log"
# จำนวนคลิปล่าสุดที่แสดงบนแดชบอร์ด
RECENT_LIMIT = 8

# บทบาทผู้ใช้
Role = Literal["admin", "contributor", "user"]

# สถานะ process เทรนที่กำลังรัน (มีได้ทีละตัว)
_train_lock = threading.Lock()
_train: dict = {"proc": None, "started_at": None, "run_id": None}


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


# ข้อมูลที่รับตอนเลือกเวอร์ชันโมเดลที่จะใช้งาน
class ActiveModelIn(BaseModel):
    version: str = Field(min_length=1, max_length=200)


# อ่านตั้งค่าการเทรน (ไม่มีไฟล์ = ค่าเริ่มต้น)
def _train_settings() -> dict:
    try:
        return json.loads(TRAIN_SETTINGS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


# คืนสถานะของ process เทรน (ต้องถือ _train_lock อยู่)
def _train_state() -> tuple[str, int | None]:
    proc = _train["proc"]
    if proc is None:
        return "idle", None
    code = proc.poll()
    if code is None:
        return "running", None
    status = "succeeded" if code == 0 else "failed"
    _finish_run(status, code)
    return status, code


# บันทึกผลการเทรนลงตาราง training_runs ครั้งเดียวเมื่อ process จบ (ผูกกับโมเดล draft ที่ได้)
def _finish_run(status: str, code: int) -> None:
    run_id = _train["run_id"]
    if run_id is None:
        return
    _train["run_id"] = None
    with SessionLocal() as db:
        run = db.get(TrainingRun, run_id)
        if run is None:
            return
        run.status, run.return_code, run.finished_at = status, code, func.now()
        if status == "succeeded":
            run.model_id = db.scalar(
                select(Model.id).where(Model.trained_at >= run.started_at).order_by(Model.trained_at.desc()).limit(1)
            )
        db.commit()
    clear_cache()


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


# รายชื่อผู้ใช้ทั้งหมด
@router.get("/users", dependencies=STAFF)
def list_users():
    return {"users": user_service.list_users()}


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
    with _train_lock:
        mr.set_active(model.id)
    clear_cache()
    return {"message": f"ตั้ง {model.file} เป็นเวอร์ชันที่ใช้งานแล้ว", "active_version": model.file}


# สั่งเทรนโมเดลในพื้นหลัง (รันได้ทีละครั้ง)
@router.post("/train", status_code=202)
def train_model(user: dict = Depends(require_admin)):
    with _train_lock:
        if _train_state()[0] == "running":
            raise HTTPException(status_code=409, detail="กำลังเทรนโมเดลอยู่แล้ว")
        min_clips = _train_settings().get("min_recorded_clips", 5)
        if not TSL_DATA_PATH.is_file() and ds.max_clips_per_word() < min_clips:
            raise HTTPException(
                status_code=400,
                detail=f"ยังไม่มีข้อมูลสำหรับเทรน: ไม่มีชุดข้อมูล TSL ในเครื่องนี้ และยังไม่มีคำไหนที่ล่ามอัดครบ {min_clips} คลิป",
            )
        if not TRAIN_SCRIPT.is_file():
            raise HTTPException(status_code=500, detail="ไม่พบสคริปต์เทรนโมเดล")

        # ใช้ python ตัวเดียวกับ backend และรันในโฟลเดอร์ของสคริปต์ เขียน output ลง train.log
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        try:
            with open(TRAIN_LOG, "w", encoding="utf-8") as log:
                proc = subprocess.Popen(
                    [sys.executable, str(TRAIN_SCRIPT)],
                    cwd=TRAIN_SCRIPT.parent,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    env={**os.environ, "PYTHONIOENCODING": "utf-8"},
                )
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"เริ่มเทรนไม่สำเร็จ: {e}")
        with SessionLocal() as db:
            run = TrainingRun(started_by=user["id"], status="running", log_path=str(TRAIN_LOG))
            db.add(run)
            db.commit()
            _train["run_id"] = run.id
        _train["proc"] = proc
        _train["started_at"] = datetime.now().isoformat(timespec="seconds")
    return {"message": "เริ่มเทรนโมเดลในพื้นหลังแล้ว", "status": "running"}


# ดูสถานะการเทรนล่าสุด พร้อม log ท้าย ๆ และเวอร์ชัน draft
@router.get("/train/status", dependencies=ADMIN)
def train_status():
    with _train_lock:
        status, code = _train_state()
        started_at = _train["started_at"]
    log_tail: list[str] = []
    if status != "idle" and TRAIN_LOG.is_file():
        log_tail = TRAIN_LOG.read_text(encoding="utf-8", errors="replace").splitlines()[-20:]
    active, draft = mr.get_by_status("active"), mr.get_by_status("draft")
    return {
        "status": status,
        "return_code": code,
        "started_at": started_at,
        "log": log_tail,
        "active_version": active.file if active else None,
        "draft_version": draft.file if draft else None,
    }


# เผยแพร่โมเดล: สลับเวอร์ชัน draft ขึ้นเป็น active (ตัวเดิมเป็น archived)
@router.post("/publish", dependencies=ADMIN)
def publish_model():
    with _train_lock:
        if _train_state()[0] == "running":
            raise HTTPException(status_code=409, detail="รอให้เทรนเสร็จก่อนจึงเผยแพร่ได้")
        draft = mr.get_by_status("draft")
        if draft is None:
            raise HTTPException(status_code=400, detail="ไม่มีโมเดลเวอร์ชัน Draft ให้เผยแพร่")
        if not (MODELS_DIR / draft.file).is_file():
            raise HTTPException(status_code=409, detail=f"ไม่พบไฟล์โมเดล {draft.file}")
        mr.set_active(draft.id)
    clear_cache()
    return {"message": f"เผยแพร่โมเดล {draft.file} สำเร็จ", "active_version": draft.file}
