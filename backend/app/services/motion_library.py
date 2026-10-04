"""Placeholder skeleton motions for the text -> sign avatar.

These are illustrative approximations authored by hand, NOT verified Thai Sign
Language. Replace them with motion extracted from real sign videos (see
ml/src/extract_landmarks.py) once the dataset exists.

Coordinates: x/y in a unit square, x=0.5 is the body centre, y grows downward.
"r" is the signer's right hand, drawn on the viewer's left. `a` is the hand
rotation in radians (0 = fingers up, pi = fingers down) and `c` is the curl of
[thumb, index, middle, ring, pinky] from 0 (open) to 1 (fist).
"""
import json
import math
from pathlib import Path

# รูปแบบการงอนิ้ว [โป้ง, ชี้, กลาง, นาง, ก้อย] ตั้งแต่ 0 (กางตรง) ถึง 1 (กำแน่น)
OPEN = [0.0, 0.0, 0.0, 0.0, 0.0]
FLAT = [0.5, 0.0, 0.0, 0.0, 0.0]
FIST = [1.0, 1.0, 1.0, 1.0, 1.0]
POINT = [0.8, 0.0, 1.0, 1.0, 1.0]
CLAW = [0.5, 0.5, 0.5, 0.5, 0.5]
CUP = [0.5, 0.45, 0.45, 0.45, 0.45]


# สร้างท่ามือหนึ่งข้าง: ตำแหน่งข้อมือ x,y มุมหมุน a และการงอนิ้ว c
def hand(x: float, y: float, a: float = 0.0, c: list[float] = FLAT) -> dict:
    return {"x": x, "y": y, "a": a, "c": list(c)}


# สร้าง keyframe ของมือ ณ เวลา t (0-1) มือที่ไม่ระบุจะอยู่ท่าพัก
def kf(t: float, r: dict | None = None, l: dict | None = None) -> dict:
    frame: dict = {"t": t}
    if r:
        frame["r"] = r
    if l:
        frame["l"] = l
    return frame


# สร้าง keyframe สีหน้า ณ เวลา t ค่าที่ไม่ระบุจะเป็นสีหน้าปกติ
def fx(t: float, **face: float) -> dict:
    """Facial expression keyframe. Missing values fall back to a calm neutral face.

    brow: -1 lowered .. 1 raised      tilt: -1 angry (inner down) .. 1 worried (inner up)
    eye: eye openness, 1 = normal     smile: -1 frown .. 1 smile
    open: mouth opening 0..1          hx/hy: head shift (unit space)      rot: head tilt (rad)
    """
    return {"t": t, **face}


# รวม keyframe มือและสีหน้าเป็นท่าของหนึ่งคำ พร้อมระยะเวลา (มิลลิวินาที)
def motion(duration: int, *frames: dict, face: list[dict] | None = None) -> dict:
    return {"duration": duration, "frames": list(frames), "face": face or []}


# สร้าง keyframe ให้มือวนเป็นวงกลม ใช้กับท่า ขอโทษ
def _circle(cx: float, cy: float, radius: float, times: list[float]) -> list[dict]:
    out = []
    for i, t in enumerate(times):
        ang = math.tau * i / (len(times) - 1) - math.pi / 2
        out.append(kf(t, hand(cx + radius * math.cos(ang), cy + radius * math.sin(ang), 0.2, FIST)))
    return out


# คลังท่าทางของแต่ละคำ (คีย์คือ gloss) เป็นท่าตัวอย่างเขียนมือ ไม่ใช่ท่ามาตรฐาน
MOTIONS: dict[str, dict] = {
    # สวัสดี: พนมมือไหว้ที่หน้าอก แล้วก้มศีรษะเล็กน้อย
    "สวัสดี": motion(
        2200,
        kf(0.28, hand(0.47, 0.56, 0.2, FLAT), hand(0.53, 0.56, -0.2, FLAT)),
        kf(0.5, hand(0.48, 0.42, 0.15, FLAT), hand(0.52, 0.42, -0.15, FLAT)),
        kf(0.66, hand(0.48, 0.42, 0.15, FLAT), hand(0.52, 0.42, -0.15, FLAT)),
        kf(0.78, hand(0.48, 0.47, 0.25, FLAT), hand(0.52, 0.47, -0.25, FLAT)),
        face=[fx(0.15, smile=0.7, brow=0.25, eye=0.9), fx(0.7, smile=0.7, brow=0.2, eye=0.9), fx(0.85, smile=0.5, hy=0.02, eye=0.8)],
    ),
    # ขอบคุณ: มือแบนจากใต้คางเลื่อนออกไปข้างหน้า
    "ขอบคุณ": motion(
        1900,
        kf(0.22, hand(0.44, 0.33, 0.3, FLAT)),
        kf(0.5, hand(0.41, 0.4, 0.5, FLAT)),
        kf(0.68, hand(0.39, 0.47, 0.75, FLAT)),
        face=[fx(0.2, smile=0.55, brow=0.2, eye=0.85), fx(0.55, smile=0.6, hy=0.015, eye=0.8)],
    ),
    # ขอโทษ: กำมือถูวนที่หน้าอก สีหน้าเสียใจ
    "ขอโทษ": motion(
        2200,
        *_circle(0.46, 0.54, 0.045, [0.18, 0.32, 0.46, 0.6, 0.74]),
        face=[fx(0.15, tilt=0.9, brow=0.15, smile=-0.4, eye=0.9, hy=0.01), fx(0.8, tilt=0.9, brow=0.15, smile=-0.4, eye=0.9, hy=0.015)],
    ),
    # ช่วยด้วย: ยกมือทั้งสองข้างโบกเหนือศีรษะ สีหน้าตกใจ
    "ช่วยด้วย": motion(
        2200,
        kf(0.22, hand(0.3, 0.16, -0.2, OPEN), hand(0.7, 0.16, 0.2, OPEN)),
        kf(0.38, hand(0.3, 0.16, 0.35, OPEN), hand(0.7, 0.16, -0.35, OPEN)),
        kf(0.54, hand(0.3, 0.16, -0.35, OPEN), hand(0.7, 0.16, 0.35, OPEN)),
        kf(0.7, hand(0.3, 0.16, 0.2, OPEN), hand(0.7, 0.16, -0.2, OPEN)),
        face=[fx(0.12, brow=0.9, eye=1.3, open=0.7, smile=-0.2, tilt=0.4), fx(0.85, brow=0.9, eye=1.3, open=0.7, smile=-0.2, tilt=0.4)],
    ),
    # ใช่: กำมือพยักขึ้นลง พร้อมพยักหน้า
    "ใช่": motion(
        1700,
        kf(0.2, hand(0.42, 0.5, 0.0, FIST)),
        kf(0.36, hand(0.42, 0.58, 0.0, FIST)),
        kf(0.52, hand(0.42, 0.5, 0.0, FIST)),
        kf(0.68, hand(0.42, 0.58, 0.0, FIST)),
        face=[fx(0.15, smile=0.35, brow=0.2), fx(0.36, smile=0.35, hy=0.018), fx(0.52, smile=0.35), fx(0.68, smile=0.35, hy=0.018), fx(0.82, smile=0.35)],
    ),
    # ไม่ใช่: ชูนิ้วชี้แกว่งไปมา พร้อมส่ายหน้า
    "ไม่ใช่": motion(
        1900,
        kf(0.2, hand(0.38, 0.33, -0.35, POINT)),
        kf(0.35, hand(0.38, 0.33, 0.35, POINT)),
        kf(0.5, hand(0.38, 0.33, -0.35, POINT)),
        kf(0.65, hand(0.38, 0.33, 0.35, POINT)),
        face=[fx(0.12, tilt=-0.5, brow=-0.2, smile=-0.25, eye=0.85), fx(0.3, tilt=-0.5, brow=-0.2, smile=-0.25, eye=0.85, hx=-0.014), fx(0.45, tilt=-0.5, brow=-0.2, smile=-0.25, eye=0.85, hx=0.014), fx(0.6, tilt=-0.5, brow=-0.2, smile=-0.25, eye=0.85, hx=-0.014), fx(0.75, tilt=-0.5, brow=-0.2, smile=-0.25, eye=0.85, hx=0.014)],
    ),
    # ผม: ชี้นิ้วเข้าหาอกตัวเอง
    "ผม": motion(
        1600,
        kf(0.3, hand(0.44, 0.5, 1.4, POINT)),
        kf(0.5, hand(0.45, 0.5, 1.45, POINT)),
        kf(0.7, hand(0.44, 0.5, 1.4, POINT)),
        face=[fx(0.2, smile=0.3, brow=0.1), fx(0.7, smile=0.3, brow=0.1)],
    ),
    # เจ็บ: มือหงิกสั่นที่ไหล่ สีหน้าเจ็บปวด
    "เจ็บ": motion(
        1900,
        kf(0.25, hand(0.4, 0.42, 0.3, CLAW)),
        kf(0.35, hand(0.42, 0.42, 0.3, CLAW)),
        kf(0.45, hand(0.38, 0.42, 0.3, CLAW)),
        kf(0.55, hand(0.42, 0.42, 0.3, CLAW)),
        kf(0.65, hand(0.4, 0.42, 0.3, CLAW)),
        face=[fx(0.1, tilt=0.95, brow=0.2, eye=0.35, open=0.4, smile=-0.7), fx(0.8, tilt=0.95, brow=0.2, eye=0.35, open=0.4, smile=-0.7)],
    ),
    # หิว: มือรูปตัว C ลากลงที่หน้าท้อง
    "หิว": motion(
        1900,
        kf(0.25, hand(0.47, 0.5, 1.2, CUP)),
        kf(0.6, hand(0.47, 0.66, 1.2, CUP)),
        face=[fx(0.15, tilt=0.5, smile=-0.35, open=0.15, eye=0.9, rot=0.08), fx(0.8, tilt=0.5, smile=-0.35, open=0.15, eye=0.9, rot=0.08)],
    ),
    # น้ำ: มือรูปถ้วยที่ปาก แล้วเอียงเหมือนดื่ม
    "น้ำ": motion(
        1900,
        kf(0.25, hand(0.45, 0.3, 0.3, CUP)),
        kf(0.5, hand(0.45, 0.29, 0.95, CUP)),
        kf(0.7, hand(0.45, 0.3, 0.3, CUP)),
        face=[fx(0.2, open=0.25, smile=0.1), fx(0.55, open=0.4, smile=0.1, rot=-0.06)],
    ),
    # ห้องน้ำ: กำมือแล้วสั่นไปด้านข้าง
    "ห้องน้ำ": motion(
        1900,
        kf(0.2, hand(0.4, 0.5, 0.0, FIST)),
        kf(0.32, hand(0.36, 0.5, 0.0, FIST)),
        kf(0.44, hand(0.42, 0.5, 0.0, FIST)),
        kf(0.56, hand(0.36, 0.5, 0.0, FIST)),
        kf(0.68, hand(0.42, 0.5, 0.0, FIST)),
        face=[fx(0.15, tilt=0.4, smile=-0.1, eye=0.95), fx(0.8, tilt=0.4, smile=-0.1, eye=0.95)],
    ),
    # ไม่เข้าใจ: ชี้ที่ขมับแล้วสะบัดมือออก สีหน้าสงสัย
    "ไม่เข้าใจ": motion(
        2100,
        kf(0.25, hand(0.43, 0.21, 0.15, POINT)),
        kf(0.4, hand(0.43, 0.21, -0.2, POINT)),
        kf(0.52, hand(0.43, 0.21, 0.2, POINT)),
        kf(0.7, hand(0.33, 0.28, 0.4, OPEN)),
        face=[fx(0.12, brow=0.7, tilt=0.35, eye=1.15, smile=-0.15, rot=0.14), fx(0.8, brow=0.7, tilt=0.35, eye=1.15, smile=-0.15, rot=0.14)],
    ),
}


# ไฟล์ท่าที่สร้างจาก skeleton ของคนทำท่าจริง (สร้างด้วย ml/src/build_motions.py)
DATA_MOTIONS_PATH = Path(__file__).resolve().parent.parent / "data" / "motions.json"
# ท่าจากข้อมูลจริงที่โหลดไว้ (จำเวลาแก้ไขไฟล์ เพื่อโหลดใหม่เมื่อสร้างไฟล์ใหม่)
_data_cache: dict = {"mtime": None, "motions": {}}


# โหลดท่าจากข้อมูลจริง (ไม่มีไฟล์หรือไฟล์เสีย = ไม่มีท่าจากข้อมูลจริง)
def _data_motions() -> dict[str, dict]:
    try:
        mtime = DATA_MOTIONS_PATH.stat().st_mtime
    except OSError:
        return {}
    if _data_cache["mtime"] != mtime:
        try:
            _data_cache["motions"] = json.loads(DATA_MOTIONS_PATH.read_text(encoding="utf-8")).get("motions", {})
        except (OSError, ValueError):
            _data_cache["motions"] = {}
        _data_cache["mtime"] = mtime
    return _data_cache["motions"]


# ดึงท่าทางของคำตาม gloss: ใช้ท่าจากข้อมูลจริงก่อน (ใส่สีหน้าที่เขียนไว้เดิมถ้ามี) ไม่มีค่อยใช้ท่าเขียนมือ
def get_motion(gloss: str) -> dict | None:
    data = _data_motions().get(gloss)
    hand_made = MOTIONS.get(gloss)
    if data:
        face = hand_made["face"] if hand_made else []
        return {"duration": data["duration"], "frames": data["frames"], "face": face, "source": data.get("source")}
    if hand_made:
        return {**hand_made, "source": {"dataset": "เขียนมือ (ยังไม่มีข้อมูลจริง)"}}
    return None
