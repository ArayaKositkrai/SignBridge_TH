import io
import re
import uuid
from datetime import datetime

import numpy as np
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.db.models import Contributor, Sample, Word, WordExternalSource
from app.db.session import SessionLocal
from app.ml.classifier import features
from app.services import storage

# อักขระที่ห้ามใช้ในคำศัพท์ (ตรงกับ CHECK ของตาราง words)
FORBIDDEN_WORD_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
# รูปแบบรหัสคลิป (ชื่อไฟล์) แบบใหม่: W{รหัสคำ}_S{รหัสผู้แสดง}_C{ลำดับคลิป} เช่น W0017_S011_C003
#   W = id ของคำในตาราง words, S = id ของผู้แสดงในตาราง contributors (S000 = ไม่ระบุผู้แสดง),
#   C = ลำดับคลิปของ (คำ, ผู้แสดง) คู่นั้น เริ่มที่ 001
SAMPLE_ID_NEW = r"W\d{4,}_S\d{3,}_C\d{3,}"
# รูปแบบเก่า เช่น 20261001-143000-a1b2c3 (ยังรับไว้จนกว่าจะรันสคริปต์ย้ายชื่อครบ)
SAMPLE_ID_LEGACY = r"\d{8}-\d{6}-[0-9a-f]{6}"
SAMPLE_ID_RE = re.compile(rf"^(?:{SAMPLE_ID_NEW}|{SAMPLE_ID_LEGACY})$")
SAMPLE_ID_NEW_RE = re.compile(r"^W(\d+)_S(\d+)_C(\d+)$")
UNKNOWN_SIGNER = 0
# เวอร์ชันของรูปแบบไฟล์ skeleton ใน Storage (.npz):
#   1 = points (T,48,2) NaN = มองไม่เห็น, t_ms (T,), aspect
#   2 = เพิ่ม face (T,47,2) จุดสำคัญของใบหน้า และ face_idx (47,) เลขจุดใน face mesh ของ MediaPipe
FORMAT_VERSION = 2
# จุดสำคัญของใบหน้าที่เก็บ: FACE_KEYPOINTS ใน ml/src/features.py (ใช้ตัวเดียวกับตอนเทรน)
# ชื่อ dataset ในตาราง ↔ ชื่อที่หน้าเว็บแสดง
SOURCE_LABELS = {"tsl51": "TSL-51", "tsl_one": "TSL-ONE-S"}
# คลิปที่ไม่นับ (แอดมินปฏิเสธแล้ว)
REJECTED = "rejected"


# ตรวจและทำความสะอาดคำศัพท์
def clean_word(word: str) -> str:
    word = word.strip()
    if not 1 <= len(word) <= 50:
        raise HTTPException(status_code=400, detail="คำศัพท์ต้องยาว 1-50 ตัวอักษร")
    if FORBIDDEN_WORD_CHARS.search(word) or word.startswith(".") or word.endswith("."):
        raise HTTPException(status_code=400, detail="คำศัพท์มีอักขระที่ไม่อนุญาต")
    return word


# ประกอบรหัสคลิปจากเลข 3 ตัว เช่น (17, 11, 3) -> W0017_S011_C003
def make_sample_id(word_id: int, signer_id: int | None, clip_no: int) -> str:
    return f"W{word_id:04d}_S{signer_id or UNKNOWN_SIGNER:03d}_C{clip_no:03d}"


# ลำดับคลิปถัดไปของ (คำ, ผู้แสดง): เลขมากสุดที่มีอยู่ + 1 (ลบคลิปท้ายสุดไปแล้วเลขนั้นอาจถูกใช้ใหม่ได้)
def next_clip_no(db, word_id: int, signer_id: int | None) -> int:
    prefix = make_sample_id(word_id, signer_id, 0)[:-3]  # "W0017_S011_C"
    like = prefix.replace("_", "\\_") + "%"
    ids = db.scalars(select(Sample.id).where(Sample.id.like(like, escape="\\"))).all()
    nums = [int(i[len(prefix):]) for i in ids if i[len(prefix):].isdigit()]
    return max(nums, default=0) + 1


# รหัสแบบเก่า (ใช้เฉพาะสคริปต์ทดสอบ/ย้อนกลับ) สร้างจากเวลา + สุ่ม
def legacy_sample_id() -> str:
    return f"{datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}"


# ตรวจรหัสคลิปที่รับจาก URL
def check_sample_id(sample_id: str) -> str:
    if not SAMPLE_ID_RE.match(sample_id):
        raise HTTPException(status_code=400, detail="รหัสคลิปไม่ถูกต้อง")
    return sample_id


# ที่อยู่ไฟล์ใน Storage (ใช้ word_id เพราะ Storage และตาราง samples รับเฉพาะตัวอักษรอังกฤษ)
#   skeleton: raw_data/{word_id}/{sample_id}.npz  (เก็บใน samples.file_path ใช้เทรน)
#   วิดีโอ:   videos/{word_id}/{sample_id}        (ไม่มีนามสกุล ชนิดไฟล์เก็บใน Storage) ไว้เปิดดูซ้ำ
def storage_path(word_id: int, sample_id: str) -> str:
    return f"raw_data/{word_id}/{sample_id}.npz"


def video_dir(word_id: int) -> str:
    return f"videos/{word_id}"


def video_path(word_id: int, sample_id: str) -> str:
    return f"{video_dir(word_id)}/{sample_id}"


# หา id ของคำ (สร้างคำใหม่ถ้ายังไม่มี เพราะล่ามอัดคำนอกคลังได้)
def get_or_create_word(db, word: str) -> int:
    word = clean_word(word)
    word_id = db.scalar(select(Word.id).where(Word.word == word))
    if word_id is None:
        row = Word(word=word)
        db.add(row)
        db.flush()
        word_id = row.id
    return word_id


# หา id ของผู้แสดงจากชื่อ (สร้างใหม่ถ้ายังไม่มี)
def get_or_create_contributor(db, name: str | None) -> int | None:
    name = (name or "").strip()[:40]
    if not name:
        return None
    cid = db.scalar(select(Contributor.id).where(Contributor.name == name))
    if cid is None:
        row = Contributor(name=name)
        db.add(row)
        db.flush()
        cid = row.id
    return cid


# ---------- แปลง skeleton ↔ ไฟล์ ----------


# สัดส่วนเฟรมที่เจอจุดของส่วนนั้น
def _present_rate(frames: list[dict], key: str) -> float:
    if not frames:
        return 0.0
    return round(sum(1 for f in frames if f.get(key)) / len(frames), 4)


# แปลงเฟรมจาก MediaPipe เป็นไฟล์ .npz รูปแบบกลาง พร้อมสถิติของคลิป
def encode_frames(frames: list[dict], width: int | None, height: int | None) -> tuple[bytes, dict]:
    F = features()
    points = np.stack([F.from_mediapipe(f.get("pose"), f.get("leftHand"), f.get("rightHand")) for f in frames])
    face = np.stack([F.face_from_mediapipe(f.get("face")) for f in frames])
    t_ms = np.array([f.get("t") if isinstance(f.get("t"), (int, float)) else np.nan for f in frames], dtype=np.float64)
    has_time = not np.isnan(t_ms).any()
    aspect = width / height if width and height else F.estimate_aspect(points)
    if not np.isfinite(aspect) or not 0.2 < aspect < 5:
        aspect = 1.0  # ประมาณสัดส่วนภาพไม่ได้ (เช่นไม่เห็นไหล่) ใช้ภาพสี่เหลี่ยมจัตุรัส
    buf = io.BytesIO()
    np.savez_compressed(
        buf,
        points=points.astype(np.float32),
        face=face,
        face_idx=np.array(F.FACE_KEYPOINTS, dtype=np.int16),
        t_ms=np.round(t_ms).astype(np.int32) if has_time else np.zeros(len(frames), np.int32),
        aspect=np.float32(aspect),
    )
    duration = int(t_ms[-1]) if has_time and len(frames) else None
    stats = {
        "frame_count": len(frames),
        "duration_ms": duration,
        "pose_present_rate": _present_rate(frames, "pose"),
        "lh_present_rate": _present_rate(frames, "leftHand"),
        "rh_present_rate": _present_rate(frames, "rightHand"),
        "has_time": has_time,
    }
    return buf.getvalue(), stats


# แปลงไฟล์ .npz กลับเป็นเฟรมสำหรับวาดทับบนหน้าเว็บ
#   มีเฉพาะแขน มือ และจุดสำคัญของใบหน้า (face = 47 จุดตาม FACE_KEYPOINTS ไฟล์รุ่นเก่าไม่มี = ว่าง)
def decode_frames(data: bytes) -> list[dict]:
    F = features()
    with np.load(io.BytesIO(data), allow_pickle=False) as d:
        points, t_ms = d["points"], d["t_ms"]
        faces = d["face"] if "face" in d.files else np.full((len(points), 1, 2), np.nan)

    def pts(arr):
        return [] if np.isnan(arr).all() else [{"x": float(x), "y": float(y)} for x, y in arr]

    frames = []
    for p, t, face in zip(points, t_ms, faces):
        pose: list = [None] * 33
        for i, mp_i in enumerate(F.MP_POSE_IDX):
            if not np.isnan(p[i]).any():
                pose[mp_i] = {"x": float(p[i][0]), "y": float(p[i][1])}
        frames.append({"t": int(t), "pose": pose, "leftHand": pts(p[F.LH]), "rightHand": pts(p[F.RH]),
                       "face": [] if np.isnan(face).any() else pts(face)})
    return frames


# ---------- อ่านข้อมูล ----------


# แปลงแถวคลิปเป็น dict รูปแบบเดิมที่หน้าเว็บใช้ (video = มีไฟล์วิดีโอใน Storage หรือไม่)
def _sample_dict(s: Sample, word: str, signer: str | None, has_video: bool = False, video_bytes: int = 0) -> dict:
    return {
        "id": s.id,
        "word": word,
        "source": s.source,
        "signer": signer,
        "video": s.id if has_video else None,
        "video_bytes": video_bytes,
        "fps": s.fps,
        "camera_fps": None,
        "duration_ms": s.duration_ms,
        "width": None,
        "height": None,
        "frame_count": s.frame_count,
        "pose_present_rate": s.pose_present_rate,
        "lh_present_rate": s.lh_present_rate,
        "rh_present_rate": s.rh_present_rate,
        "status": s.status,
        "created_at": s.created_at.astimezone().replace(tzinfo=None).isoformat(timespec="seconds"),
    }


def _sample_query():
    return (
        select(Sample, Word.word, Contributor.name)
        .join(Word, Word.id == Sample.word_id)
        .outerjoin(Contributor, Contributor.id == Sample.contributor_id)
        .where(Sample.status != REJECTED, Sample.source.in_(("record", "upload")))
    )


# คลิปที่ล่ามอัดของคำหนึ่งคำ (เรียงจากเก่าไปใหม่) พร้อมบอกว่าคลิปไหนมีวิดีโอ
def list_samples(word: str) -> list[dict]:
    with SessionLocal() as db:
        rows = db.execute(_sample_query().where(Word.word == word).order_by(Sample.created_at, Sample.id)).all()
    videos = storage.list_names(video_dir(rows[0][0].word_id)) if rows else set()
    return [_sample_dict(s, w, c, has_video=s.id in videos) for s, w, c in rows]


# คลิปที่ล่ามอัดของทุกคำ (ใช้ทำแดชบอร์ด)
def all_samples() -> list[dict]:
    with SessionLocal() as db:
        rows = db.execute(_sample_query().order_by(Sample.created_at)).all()
    return [_sample_dict(s, w, c) for s, w, c in rows]


# สรุปสถิติของคำหนึ่งคำ: จำนวนคลิป เฟรม ความยาวรวม ผู้แสดง และความครบของมือ
def word_stats(word: str, samples: list[dict]) -> dict:
    n = len(samples)
    hand_rates = [max(s.get("lh_present_rate") or 0, s.get("rh_present_rate") or 0) for s in samples]
    return {
        "word": word,
        "samples": n,
        "frames": sum(s.get("frame_count", 0) for s in samples),
        "duration_ms": round(sum(s.get("duration_ms") or 0 for s in samples)),
        "signers": sorted({s["signer"] for s in samples if s.get("signer")}),
        "without_landmarks": 0,
        "hand_rate": round(sum(hand_rates) / n, 4) if n else 0.0,
        "updated_at": max((s.get("created_at", "") for s in samples), default=None),
    }


# สถิติของทุกคำที่มีคลิป
def all_word_stats() -> list[dict]:
    by_word: dict[str, list[dict]] = {}
    for s in all_samples():
        by_word.setdefault(s["word"], []).append(s)
    return [word_stats(w, by_word[w]) for w in sorted(by_word)]


# คลังคำศัพท์จาก database ในรูปแบบเดิมของ vocabulary.json
def load_vocab() -> list[dict]:
    with SessionLocal() as db:
        words = db.scalars(select(Word).order_by(Word.id)).all()
        ext_rows = db.execute(
            select(WordExternalSource.word_id, WordExternalSource.source, WordExternalSource.clips, WordExternalSource.contributors)
        ).all()
    external: dict[int, dict] = {}
    for word_id, source, clips, contributors in ext_rows:
        external.setdefault(word_id, {})[SOURCE_LABELS.get(source, source)] = {"clips": clips, "signers": contributors}
    return [
        {
            "word": w.word,
            "category": w.category,
            "priority": w.priority,
            "assigned": w.assigned_to,
            "note": w.note,
            "to_record": w.to_record,
            "external": external.get(w.id, {}),
        }
        for w in words
    ]


# รวมคลังคำกับสถิติคลิปที่อัดจริง
def vocabulary_items() -> list[dict]:
    stats = {w["word"]: w for w in all_word_stats()}
    return [{**v, "data": stats.get(v["word"])} for v in load_vocab()]


# ---------- เขียนข้อมูล ----------


# บันทึกคลิปใหม่: อัปโหลด skeleton (+ วิดีโอถ้ามี) ไป Storage แล้วเพิ่มแถวในตาราง samples
def create_sample(
    *, word: str, frames: list[dict], source: str, signer: str | None, uploaded_by: str | None,
    fps: float | None, width: int | None, height: int | None,
    video: bytes | None = None, video_type: str | None = None,
) -> dict:
    data, stats = encode_frames(frames, width, height)
    with SessionLocal() as db:
        word_id = get_or_create_word(db, word)
        signer_id = get_or_create_contributor(db, signer)
        db.commit()  # เก็บคำ/ผู้แสดงใหม่ไว้ก่อน เพราะถ้าชนรหัสแล้ว rollback ต้องไม่ทำให้ id หาย
        last_error: Exception | None = None
        # คนสองคนอัดคำเดียวกันพร้อมกันอาจได้ลำดับเดียวกัน: Sample.id เป็น primary key จึงชน -> ลองใหม่ด้วยเลขถัดไป
        for _ in range(5):
            sid = make_sample_id(word_id, signer_id, next_clip_no(db, word_id, signer_id))
            path = storage_path(word_id, sid)
            uploaded = []
            try:
                sample = Sample(
                    id=sid,
                    word_id=word_id,
                    contributor_id=signer_id,
                    uploaded_by=uploaded_by,
                    source=source,
                    file_path=path,
                    format_version=FORMAT_VERSION,
                    frame_count=stats["frame_count"],
                    fps=fps,
                    fps_estimated=not stats["has_time"],
                    duration_ms=stats["duration_ms"],
                    pose_present_rate=stats["pose_present_rate"],
                    lh_present_rate=stats["lh_present_rate"],
                    rh_present_rate=stats["rh_present_rate"],
                )
                db.add(sample)
                db.flush()  # จองรหัสในตารางก่อนอัปไฟล์ ถ้ารหัสชนจะ error ตรงนี้ ก่อนที่ไฟล์ของคนอื่นจะถูกทับ
                storage.upload(path, data)
                uploaded.append(path)
                if video:
                    storage.upload(video_path(word_id, sid), video, video_type or "video/webm")
                    uploaded.append(video_path(word_id, sid))
                db.commit()
            except IntegrityError as e:
                # รหัสชน (ยังไม่ได้อัปไฟล์อะไร) -> ลองเลขถัดไป
                db.rollback()
                last_error = e
                continue
            except Exception:
                # บันทึกไม่สำเร็จ = ลบไฟล์ที่อัปโหลดไปแล้วทิ้ง ไม่ให้มีไฟล์ค้างใน Storage
                db.rollback()
                storage.remove(uploaded)
                raise
            return _sample_dict(
                sample, clean_word(word), (signer or "").strip()[:40] or None,
                has_video=bool(video), video_bytes=len(video or b""),
            )
        raise HTTPException(status_code=409, detail="บันทึกคลิปไม่สำเร็จ มีคนอัดคำเดียวกันพร้อมกัน ลองใหม่อีกครั้ง") from last_error


# หาคลิปของคำ คืน (sample, file_path) หรือ None
def find_sample(word: str, sample_id: str) -> Sample | None:
    with SessionLocal() as db:
        return db.scalar(
            select(Sample).join(Word, Word.id == Sample.word_id).where(Word.word == word, Sample.id == sample_id)
        )


# ลบคลิป (ไฟล์ใน Storage + แถวในตาราง) คืน False ถ้าไม่พบ
def delete_sample(word: str, sample_id: str) -> bool:
    with SessionLocal() as db:
        sample = db.scalar(
            select(Sample).join(Word, Word.id == Sample.word_id).where(Word.word == word, Sample.id == sample_id)
        )
        if sample is None:
            return False
        storage.remove([sample.file_path, video_path(sample.word_id, sample.id)])
        db.delete(sample)
        db.commit()
        return True


# จำนวนคลิปที่ใช้เทรนได้ของคำที่มีคลิปมากที่สุด (ไม่นับคลิปที่ถูกปฏิเสธ)
def max_clips_per_word() -> int:
    with SessionLocal() as db:
        counts = db.scalars(
            select(func.count())
            .select_from(Sample)
            .where(Sample.status != REJECTED, Sample.source.in_(("record", "upload")))
            .group_by(Sample.word_id)
        ).all()
    return max(counts, default=0)
