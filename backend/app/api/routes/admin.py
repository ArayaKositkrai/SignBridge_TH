import json
import os
import re
import subprocess
import sys
import threading
from collections import Counter
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field, field_validator

from app.core.config import MODEL_CONFIG_PATH, MODELS_DIR, TRAIN_SCRIPT
from app.services import dataset_service as ds
from app.services import model_registry as mr
from app.services import user_service
from app.services.motion_library import get_motion
from app.services.retrieval_service import load_vocabulary

# กลุ่ม route ของแอดมิน: แดชบอร์ด ผู้ใช้ คลังคำศัพท์ และเวอร์ชันโมเดล
router = APIRouter(prefix="/api/admin", tags=["admin"])

# นามสกุลไฟล์ที่นับเป็นไฟล์โมเดล
MODEL_EXTS = {".npz", ".h5", ".keras", ".pt", ".pth", ".onnx", ".pkl", ".joblib", ".tflite"}
# รูปแบบชื่อไฟล์โมเดลที่มีเลขเวอร์ชัน เช่น model_signBridge_v0.0.1.h5
VERSION_RE = re.compile(r"_v(\d+)\.(\d+)\.(\d+)\.[a-z0-9]+$", re.IGNORECASE)
# ไฟล์ log ของการเทรนล่าสุด
TRAIN_LOG = MODELS_DIR / "train.log"
# จำนวนคลิปล่าสุดที่แสดงบนแดชบอร์ด
RECENT_LIMIT = 8

# บทบาทผู้ใช้
Role = Literal["admin", "contributor", "user"]

# สถานะ process เทรนที่กำลังรัน (มีได้ทีละตัว)
_train_lock = threading.Lock()
_train: dict = {"proc": None, "started_at": None}


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


# อ่านไฟล์ตั้งค่าเวอร์ชันโมเดล
def load_config() -> dict:
    with open(MODEL_CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


# เขียนไฟล์ตั้งค่าแบบปลอดภัย (เขียนไฟล์ชั่วคราวก่อนแล้วค่อยแทนที่)
def save_config(data: dict) -> None:
    tmp = MODEL_CONFIG_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
    os.replace(tmp, MODEL_CONFIG_PATH)


# คืนสถานะของ process เทรน (ต้องถือ _train_lock อยู่)
def _train_state() -> tuple[str, int | None]:
    proc = _train["proc"]
    if proc is None:
        return "idle", None
    code = proc.poll()
    if code is None:
        return "running", None
    return ("succeeded" if code == 0 else "failed"), code


# ---------- แดชบอร์ด ----------


# ภาพรวมระบบ: จำนวนคำ คลิป เฟรม ความยาว ผู้แสดง คุณภาพ คลิปล่าสุด และโมเดลที่ใช้
@router.get("/dashboard")
def dashboard():
    samples = ds.all_samples()
    words = ds.all_word_stats()
    signers = Counter(s.get("signer") or "ไม่ระบุ" for s in samples)
    hand_rates = [max(s.get("lh_present_rate", 0), s.get("rh_present_rate", 0)) for s in samples]
    config = load_config()
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
            "active_version": config.get("active_version"),
            "draft_version": config.get("draft_version"),
            "words": config.get("words", []),
        },
    }


# ---------- ผู้ใช้ ----------


# รายชื่อผู้ใช้ทั้งหมด
@router.get("/users")
def list_users():
    return {"users": user_service.list_users()}


# เพิ่มผู้ใช้
@router.post("/users", status_code=201)
def add_user(body: UserIn):
    try:
        return user_service.add_user(body.name, body.role)
    except user_service.DuplicateName:
        raise HTTPException(status_code=409, detail="มีผู้ใช้ชื่อนี้แล้ว")


# แก้ไขบทบาท/สถานะผู้ใช้
@router.patch("/users/{user_id}")
def update_user(user_id: str, body: UserPatch):
    user = user_service.update_user(user_id, body.model_dump())
    if user is None:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้")
    return user


# ลบผู้ใช้
@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: str):
    if not user_service.delete_user(user_id):
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้")
    return Response(status_code=204)


# ---------- คลังคำศัพท์และท่า ----------


# รวมคลังคำ (คำที่ต้องอัด + ชุดข้อมูล TSL + คลิปที่อัด) กับสถานะในแต่ละเวอร์ชันโมเดล และคลังท่าของอวตาร
@router.get("/vocabulary")
def vocabulary():
    summary = mr.model_summary()
    active_words = set(summary["active"]["words"])
    draft_words = set(summary["draft"]["words"])
    avatar = load_vocabulary()
    base = {v["word"]: v for v in ds.vocabulary_items()}
    for word in (active_words | draft_words | set(avatar)) - set(base):
        base[word] = {"word": word, "category": None, "priority": None, "to_record": False, "external": {}, "data": None}
    items = []
    for word, v in base.items():
        entry = avatar.get(word)
        items.append(
            {
                **v,
                "in_active_model": word in active_words,
                "in_draft_model": word in draft_words,
                "model": mr.word_model_status(word, summary),
                "avatar": {
                    "has_motion": bool(entry and get_motion(entry["gloss"])),
                    "has_clip": bool(entry and entry.get("clip")),
                }
                if entry
                else None,
            }
        )
    return {"items": sorted(items, key=lambda v: (not v.get("to_record"), v["word"])), "models": {
        k: {kk: vv for kk, vv in v.items() if kk not in ("words", "per_word")} | {"word_count": len(v["words"])}
        for k, v in summary.items()
    }}


# ---------- เวอร์ชันโมเดล ----------


# รายการไฟล์โมเดลทั้งหมด พร้อมบอกว่าตัวไหนใช้งานอยู่/เป็น draft
@router.get("/models")
def list_models():
    config = load_config()
    models = []
    if MODELS_DIR.is_dir():
        for path in MODELS_DIR.iterdir():
            if path.is_file() and path.suffix.lower() in MODEL_EXTS:
                st = path.stat()
                m = VERSION_RE.search(path.name)
                info: dict = {}
                sidecar = path.with_suffix(".json")
                if sidecar.is_file():
                    try:
                        info = json.loads(sidecar.read_text(encoding="utf-8"))
                    except (OSError, ValueError):
                        info = {}
                models.append(
                    {
                        "version": path.name,
                        "label": "v{}.{}.{}".format(*m.groups()) if m else path.stem,
                        "semver": [int(x) for x in m.groups()] if m else None,
                        "bytes": st.st_size,
                        "modified_at": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
                        "words": len(info.get("words", {})) if info else None,
                        "samples": info.get("samples"),
                        "val_accuracy": info.get("val_accuracy"),
                        "val_top3": info.get("val_top3"),
                        "active": path.name == config.get("active_version"),
                        "draft": path.name == config.get("draft_version"),
                    }
                )
    # เรียงตามเลขเวอร์ชันจากใหม่ไปเก่า (ไฟล์ที่ไม่มีเลขเวอร์ชันไว้ท้าย เรียงตามเวลา)
    models.sort(key=lambda m: (m["semver"] is not None, m["semver"] or [], m["modified_at"]), reverse=True)
    return {
        "models": models,
        "active_version": config.get("active_version"),
        "draft_version": config.get("draft_version"),
    }


# เลือกเวอร์ชันโมเดลที่ระบบใช้ (ย้อนกลับไปเวอร์ชันเก่าได้)
@router.post("/models/active")
def set_active_model(body: ActiveModelIn):
    name = os.path.basename(body.version)
    if name != body.version or not (MODELS_DIR / name).is_file():
        raise HTTPException(status_code=404, detail="ไม่พบไฟล์โมเดลนี้")
    with _train_lock:
        config = load_config()
        config["active_version"] = name
        if config.get("draft_version") == name:
            config["draft_version"] = None
            config["words"] = config.pop("draft_words", config.get("words", []))
        save_config(config)
    return {"message": f"ตั้ง {name} เป็นเวอร์ชันที่ใช้งานแล้ว", "active_version": name}


# สั่งเทรนโมเดลในพื้นหลัง (รันได้ทีละครั้ง)
@router.post("/train", status_code=202)
def train_model():
    with _train_lock:
        if _train_state()[0] == "running":
            raise HTTPException(status_code=409, detail="กำลังเทรนโมเดลอยู่แล้ว")
        if not any(w["samples"] for w in ds.all_word_stats()):
            raise HTTPException(status_code=400, detail="ยังไม่มีคลิปสำหรับเทรน")
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
        _train["proc"] = proc
        _train["started_at"] = datetime.now().isoformat(timespec="seconds")
    return {"message": "เริ่มเทรนโมเดลในพื้นหลังแล้ว", "status": "running"}


# ดูสถานะการเทรนล่าสุด พร้อม log ท้าย ๆ และเวอร์ชัน draft
@router.get("/train/status")
def train_status():
    with _train_lock:
        status, code = _train_state()
        started_at = _train["started_at"]
    log_tail: list[str] = []
    if status != "idle" and TRAIN_LOG.is_file():
        log_tail = TRAIN_LOG.read_text(encoding="utf-8", errors="replace").splitlines()[-20:]
    config = load_config()
    return {
        "status": status,
        "return_code": code,
        "started_at": started_at,
        "log": log_tail,
        "active_version": config.get("active_version"),
        "draft_version": config.get("draft_version"),
    }


# เผยแพร่โมเดล: สลับเวอร์ชัน draft ขึ้นเป็น active
@router.post("/publish")
def publish_model():
    with _train_lock:
        if _train_state()[0] == "running":
            raise HTTPException(status_code=409, detail="รอให้เทรนเสร็จก่อนจึงเผยแพร่ได้")
        config = load_config()
        draft = config.get("draft_version")
        if not draft:
            raise HTTPException(status_code=400, detail="ไม่มีโมเดลเวอร์ชัน Draft ให้เผยแพร่")
        if not (MODELS_DIR / draft).is_file():
            raise HTTPException(status_code=409, detail=f"ไม่พบไฟล์โมเดล {draft}")
        config["active_version"] = draft
        config["draft_version"] = None
        config["words"] = config.pop("draft_words", config.get("words", []))
        save_config(config)
    return {"message": f"เผยแพร่โมเดล {draft} สำเร็จ", "active_version": draft}
