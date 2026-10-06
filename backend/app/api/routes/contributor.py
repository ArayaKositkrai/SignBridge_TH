import json
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app.api.deps import require_staff
from app.services import dataset_service as ds
from app.services import model_registry as mr
from app.services import storage

# กลุ่ม route สำหรับล่าม/ผู้ช่วยเก็บข้อมูล: อัดคลิป ดูคลังคำศัพท์
router = APIRouter(prefix="/api/contributor", tags=["contributor"], dependencies=[Depends(require_staff)])

# ขนาดวิดีโอสูงสุดต่อคลิป (50 MB = ขนาดไฟล์สูงสุดของ Supabase Storage แบบฟรี)
MAX_VIDEO_BYTES = 50 * 1024 * 1024
# ชนิดวิดีโอที่รับ
VIDEO_TYPES = {
    "video/webm", "video/mp4", "video/quicktime", "video/x-matroska", "video/x-m4v",
    "video/x-msvideo", "video/3gpp", "video/ogg",
}
# เดาชนิดจากนามสกุลเมื่อเบราว์เซอร์ไม่บอกชนิดไฟล์มา (เช่นไฟล์ .mkv)
VIDEO_EXT_TYPES = {
    ".webm": "video/webm", ".mp4": "video/mp4", ".mov": "video/quicktime", ".mkv": "video/x-matroska",
    ".m4v": "video/x-m4v", ".avi": "video/x-msvideo", ".3gp": "video/3gpp", ".ogv": "video/ogg",
}
# ขนาดไฟล์ landmarks สูงสุดต่อคลิป (20 MB)
MAX_LANDMARKS_BYTES = 20 * 1024 * 1024
# จำนวนเฟรม landmarks สูงสุดต่อคลิป (30 วินาทีที่ 50 fps ยังไม่เกิน)
MAX_FRAMES = 2000

# ที่มาของคลิป: อัดจากกล้อง หรืออัปโหลดไฟล์
Source = Literal["record", "upload"]


# ข้อมูลที่รับตอนบันทึกเฉพาะ landmarks (ไม่มีวิดีโอ)
class LandmarksIn(BaseModel):
    word: str
    signer: str | None = Field(default=None, max_length=40)
    fps: float | None = Field(default=None, gt=0, le=240)
    frames: list[dict] = Field(min_length=1, max_length=MAX_FRAMES)


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


# อ่านไฟล์วิดีโอ (จำกัดขนาด) คืน (ข้อมูล, ชนิดไฟล์)
async def read_video(upload: UploadFile) -> tuple[bytes, str]:
    content_type = (upload.content_type or "").split(";")[0].strip().lower()
    if content_type not in VIDEO_TYPES:
        ext = "." + (upload.filename or "").rsplit(".", 1)[-1].lower()
        content_type = VIDEO_EXT_TYPES.get(ext, content_type)
    if content_type not in VIDEO_TYPES:
        raise HTTPException(status_code=400, detail="รองรับเฉพาะวิดีโอ mp4, webm, mov, mkv, m4v, avi, 3gp, ogv")
    data = await upload.read(MAX_VIDEO_BYTES + 1)
    if len(data) > MAX_VIDEO_BYTES:
        raise HTTPException(status_code=413, detail="วิดีโอใหญ่เกิน 50 MB")
    if not data:
        raise HTTPException(status_code=400, detail="ไฟล์วิดีโอว่างเปล่า")
    return data, content_type


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
    word = ds.clean_word(word)
    return {"word": word, "samples": ds.list_samples(word)}


# บันทึกคลิปใหม่ (อัดจากกล้องหรืออัปโหลด) — เก็บ skeleton และวิดีโอ (ถ้าส่งมา) ใน Storage
# fps = อัตราเฟรมของ skeleton, width/height = ขนาดภาพ (ใช้คำนวณสัดส่วนภาพตอนเทรน)
@router.post("/samples", status_code=201)
async def add_sample(
    word: str = Form(...),
    source: Source = Form("upload"),
    signer: str | None = Form(None),
    fps: float | None = Form(None, gt=0, le=240),
    width: int | None = Form(None, gt=0, le=8192),
    height: int | None = Form(None, gt=0, le=8192),
    landmarks: UploadFile = File(...),
    video: UploadFile | None = File(None),
    user: dict = Depends(require_staff),
):
    frames = await read_landmarks(landmarks)
    if not frames:
        raise HTTPException(status_code=400, detail="ไม่พบท่าทางในคลิป")
    video_data, video_type = await read_video(video) if video is not None else (None, None)
    return await run_in_threadpool(
        ds.create_sample, word=word, frames=frames, source=source, signer=signer,
        uploaded_by=user["id"], fps=fps, width=width, height=height, video=video_data, video_type=video_type,
    )


# บันทึกเฉพาะ landmarks ของท่าทาง (ส่งเป็น JSON)
@router.post("/landmarks", status_code=201)
def add_landmarks(body: LandmarksIn, user: dict = Depends(require_staff)):
    return ds.create_sample(
        word=body.word, frames=body.frames, source="record", signer=body.signer,
        uploaded_by=user["id"], fps=body.fps, width=None, height=None,
    )


# เปิดวิดีโอของคลิป: ส่งต่อไปยังลิงก์ชั่วคราวของ Storage (เลื่อนดูได้ และ backend ไม่ต้องส่งไฟล์เอง)
@router.get("/samples/{word}/{sample_id}/video")
def get_sample_video(word: str, sample_id: str):
    sample = ds.find_sample(ds.clean_word(word), ds.check_sample_id(sample_id))
    url = storage.signed_url(ds.video_path(sample.word_id, sample.id)) if sample else None
    if url is None:
        raise HTTPException(status_code=404, detail="คลิปนี้ไม่มีวิดีโอ")
    return RedirectResponse(url, status_code=307)


# ส่ง skeleton ของคลิปกลับไปวาดบนหน้าเว็บ (แปลงจากไฟล์ใน Storage)
@router.get("/samples/{word}/{sample_id}/landmarks")
def get_sample_landmarks(word: str, sample_id: str):
    sample = ds.find_sample(ds.clean_word(word), ds.check_sample_id(sample_id))
    data = storage.download(sample.file_path) if sample else None
    if data is None:
        raise HTTPException(status_code=404, detail="ไม่พบ skeleton ของคลิปนี้")
    return ds.decode_frames(data)


# ลบคลิป (ไฟล์ใน Storage + ข้อมูลในตาราง)
@router.delete("/samples/{word}/{sample_id}", status_code=204)
def delete_sample(word: str, sample_id: str):
    if not ds.delete_sample(ds.clean_word(word), ds.check_sample_id(sample_id)):
        raise HTTPException(status_code=404, detail="ไม่พบคลิปนี้")
    return Response(status_code=204)
