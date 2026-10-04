import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.api.deps import require_staff
from app.services import dataset_service as ds
from app.services import model_registry as mr

# กลุ่ม route สำหรับล่าม/ผู้ช่วยเก็บข้อมูล: อัดคลิป ดูคลังคำศัพท์
router = APIRouter(prefix="/api/contributor", tags=["contributor"], dependencies=[Depends(require_staff)])

# ขนาดวิดีโอสูงสุดต่อคลิป (100 MB)
MAX_VIDEO_BYTES = 100 * 1024 * 1024
# ขนาดไฟล์ landmarks สูงสุดต่อคลิป (20 MB)
MAX_LANDMARKS_BYTES = 20 * 1024 * 1024
# จำนวนเฟรม landmarks สูงสุดต่อคลิป (30 วินาทีที่ 50 fps ยังไม่เกิน)
MAX_FRAMES = 2000
# ขนาดก้อนที่อ่าน/เขียนไฟล์ทีละครั้ง (1 MB)
CHUNK_SIZE = 1024 * 1024

# ที่มาของคลิป: อัดจากกล้อง หรืออัปโหลดไฟล์
Source = Literal["record", "upload"]


# ข้อมูลที่รับตอนบันทึกเฉพาะ landmarks (ไม่มีวิดีโอ)
class LandmarksIn(BaseModel):
    word: str
    signer: str | None = Field(default=None, max_length=40)
    fps: float | None = Field(default=None, gt=0, le=240)
    frames: list[dict] = Field(min_length=1, max_length=MAX_FRAMES)


# บันทึกไฟล์อัปโหลดลงดิสก์ทีละก้อน และหยุดถ้าใหญ่เกินกำหนด
async def save_upload(upload: UploadFile, dest: Path, limit: int) -> int:
    size = 0
    try:
        with open(dest, "wb") as out:
            while chunk := await upload.read(CHUNK_SIZE):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(status_code=413, detail="ไฟล์มีขนาดใหญ่เกินไป")
                out.write(chunk)
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    if size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="ไฟล์ว่างเปล่า")
    return size


# อ่านและตรวจไฟล์ landmarks (ต้องเป็น JSON array ของเฟรม)
async def read_landmarks(upload: UploadFile) -> list[dict]:
    raw = await upload.read(MAX_LANDMARKS_BYTES + 1)
    if len(raw) > MAX_LANDMARKS_BYTES:
        raise HTTPException(status_code=413, detail="ไฟล์ landmarks ใหญ่เกินไป")
    try:
        frames = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="ไฟล์ landmarks ไม่ใช่ JSON")
    if not isinstance(frames, list) or not all(isinstance(f, dict) for f in frames):
        raise HTTPException(status_code=400, detail="landmarks ต้องเป็นรายการของเฟรม")
    if len(frames) > MAX_FRAMES:
        raise HTTPException(status_code=400, detail="จำนวนเฟรมมากเกินไป")
    return frames


# ตัดช่องว่างชื่อผู้แสดง (ว่าง = ไม่ระบุ)
def clean_signer(signer: str | None) -> str | None:
    signer = (signer or "").strip()[:40]
    return signer or None


# รายการคำศัพท์ที่มีข้อมูล พร้อมสถิติ (คลิป เฟรม ความยาว ผู้แสดง)
@router.get("/words")
def list_words():
    return {"words": ds.all_word_stats()}


# คลังคำศัพท์ทั้งหมด (คำที่ต้องอัด + คำจากชุดข้อมูล TSL) พร้อมสถิติคลิปที่อัดแล้ว
# และสถานะในโมเดล (อยู่ในโมเดลที่ใช้/draft ไหม ทายถูกกี่ %) ให้ล่ามรู้ว่าคำไหนควรอัดเพิ่ม
@router.get("/vocabulary")
def vocabulary():
    summary = mr.model_summary()
    items = [{**v, "model": mr.word_model_status(v["word"], summary)} for v in ds.vocabulary_items()]
    return {"items": items, "models": _public_models(summary)}


# ข้อมูลสรุปโมเดลที่ส่งให้หน้าเว็บ (ตัดรายการคำและผลรายคำออก เพราะอยู่ในแต่ละคำแล้ว)
def _public_models(summary: dict) -> dict:
    return {k: {kk: vv for kk, vv in v.items() if kk not in ("words", "per_word")} | {"word_count": len(v["words"])} for k, v in summary.items()}


# รายการคลิปของคำศัพท์หนึ่งคำ
@router.get("/samples/{word}")
def get_samples(word: str):
    folder = ds.word_dir(word)
    return {"word": folder.name, "samples": ds.list_samples(folder)}


# บันทึกคลิปใหม่ (อัดจากกล้องหรืออัปโหลด) พร้อม landmarks และข้อมูลวิดีโอ (fps = อัตราเฟรมของ skeleton)
@router.post("/samples", status_code=201)
async def add_sample(
    word: str = Form(...),
    source: Source = Form("upload"),
    signer: str | None = Form(None),
    fps: float | None = Form(None, gt=0, le=240),
    camera_fps: float | None = Form(None, gt=0, le=240),
    duration_ms: float | None = Form(None, ge=0),
    width: int | None = Form(None, gt=0, le=8192),
    height: int | None = Form(None, gt=0, le=8192),
    video: UploadFile = File(...),
    landmarks: UploadFile | None = File(None),
):
    folder = ds.word_dir(word)
    ext = Path(video.filename or "").suffix.lower()
    if ext not in ds.VIDEO_EXTS:
        raise HTTPException(status_code=400, detail=f"รองรับเฉพาะไฟล์ {', '.join(sorted(ds.VIDEO_EXTS))}")

    frames = await read_landmarks(landmarks) if landmarks is not None else None
    folder.mkdir(parents=True, exist_ok=True)
    sid = ds.new_sample_id()
    video_name = f"{sid}{ext}"
    size = await save_upload(video, folder / video_name, MAX_VIDEO_BYTES)

    meta = {
        "id": sid,
        "word": folder.name,
        "source": source,
        "signer": clean_signer(signer),
        "video": video_name,
        "video_bytes": size,
        "fps": fps,
        "camera_fps": camera_fps,
        "duration_ms": round(duration_ms) if duration_ms is not None else None,
        "width": width,
        "height": height,
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }
    return ds.write_sample(folder, meta, frames)


# บันทึกเฉพาะ landmarks ของท่าทาง (ไม่มีไฟล์วิดีโอ)
@router.post("/landmarks", status_code=201)
def add_landmarks(body: LandmarksIn):
    folder = ds.word_dir(body.word)
    folder.mkdir(parents=True, exist_ok=True)
    meta = {
        "id": ds.new_sample_id(),
        "word": folder.name,
        "source": "record",
        "signer": clean_signer(body.signer),
        "video": None,
        "video_bytes": 0,
        "fps": body.fps,
        "duration_ms": body.frames[-1].get("t") if isinstance(body.frames[-1].get("t"), (int, float)) else None,
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }
    return ds.write_sample(folder, meta, body.frames)


# ส่งไฟล์วิดีโอของคลิปกลับไปให้เล่นดูซ้ำ
@router.get("/samples/{word}/{sample_id}/video")
def get_sample_video(word: str, sample_id: str):
    folder = ds.word_dir(word)
    sid = ds.check_sample_id(sample_id)
    for path in folder.glob(f"{sid}.*"):
        if path.suffix.lower() in ds.VIDEO_EXTS:
            return FileResponse(path)
    raise HTTPException(status_code=404, detail="ไม่พบวิดีโอของคลิปนี้")


# ส่ง skeleton ของคลิปกลับไปวาดทับวิดีโอ
@router.get("/samples/{word}/{sample_id}/landmarks")
def get_sample_landmarks(word: str, sample_id: str):
    folder = ds.word_dir(word)
    path = folder / f"{ds.check_sample_id(sample_id)}.landmarks.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="คลิปนี้ไม่มี skeleton")
    return FileResponse(path, media_type="application/json")


# ลบคลิป (วิดีโอ + landmarks + ข้อมูลสรุป) และลบโฟลเดอร์คำถ้าไม่เหลือคลิป
@router.delete("/samples/{word}/{sample_id}", status_code=204)
def delete_sample(word: str, sample_id: str):
    folder = ds.word_dir(word)
    sid = ds.check_sample_id(sample_id)
    files = list(folder.glob(f"{sid}.*"))
    if not files:
        raise HTTPException(status_code=404, detail="ไม่พบคลิปนี้")
    for path in files:
        path.unlink(missing_ok=True)
    if folder.is_dir() and not any(folder.iterdir()):
        shutil.rmtree(folder, ignore_errors=True)
    return Response(status_code=204)
