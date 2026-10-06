"""สร้าง keyframe ท่าภาษามือของตัวละคร (ข้อความ → ภาษามือ) จาก skeleton ของคนทำท่าจริง

ใช้:
    python build_motions.py            (ใช้ numpy อย่างเดียว)

แหล่งข้อมูล (เลือกคลิปตัวแทนคำละ 1 คลิป):
    1. ml/data/processed/tsl_skeleton.npz  — ชุดข้อมูล TSL (ให้ผู้เชี่ยวชาญ TSL-51 ก่อน แล้วค่อย TSL-ONE-S)
    2. คลิปที่ล่ามอัดผ่านระบบ (ตาราง samples + ไฟล์ใน Supabase Storage)

คำเป้าหมาย: คำที่อวตารทำท่าได้ (words.gloss) + คำที่เทรนโมเดล + คำที่ล่ามอัด
ผลลัพธ์: ตาราง motions (source = extracted) และตั้ง gloss ให้คำที่ได้ท่าใหม่ (อวตารจะทำท่าคำนั้นได้)

การแปลงพิกัดไปเป็นพิกัดตัวละคร (ดู frontend/src/lib/avatar/skeleton.ts):
    - แกนนอน: ความกว้างไหล่จริง = ความกว้างไหล่ตัวละคร (0.2)
    - แกนตั้งเหนือไหล่: ยืดให้ระดับปากจริงตรงกับปากตัวละคร (หัวตัวละครอยู่สูงกว่าคนจริง)
    - แกนตั้งใต้ไหล่: ย่อ/ขยายให้ข้อมือตอนพักตรงกับท่าพักของตัวละคร
"""
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402
import features as F  # noqa: E402
from psycopg.types.json import Jsonb  # noqa: E402

# โฟลเดอร์หลัก
ROOT = Path(__file__).resolve().parents[2]
ML_DIR = ROOT / "ml"
TSL_PATH = ML_DIR / "data" / "processed" / "tsl_skeleton.npz"

# ตำแหน่งในพิกัดตัวละคร (ต้องตรงกับ skeleton.ts)
SHOULDER_Y = 0.42
SHOULDER_W = 0.2
MOUTH_Y = 0.2 + 0.075 * 0.44  # ศีรษะ y=0.2 รัศมี 0.075 ปากอยู่ต่ำกว่ากลางหัว 0.44 รัศมี
REST_Y = 0.79
# ระยะปากเหนือแนวไหล่ของคนจริง (หน่วย = ความกว้างไหล่) วัดจากคลิปที่อัดด้วยระบบ
REAL_MOUTH_UP = 0.49
# fps โดยประมาณของชุดข้อมูล TSL (TSL-51 จาก fps_est ใน metadata, TSL-ONE-S ไม่มีข้อมูลจึงใช้ 25)
TSL_FPS = {"TSL-51": 21.4, "TSL-ONE-S": 25.0}
# เวลาเผื่อก่อน/หลังช่วงทำท่า (วินาที) ให้ตัวละครยกมือขึ้นจากท่าพักและลดมือลง
PAD_SEC = 0.35
# ส่วนของคลิปที่ใช้ทำ keyframe ห่างกันประมาณกี่มิลลิวินาที
KEY_EVERY_MS = 110
# มือข้างที่ยกขึ้นน้อยกว่าสัดส่วนนี้ของช่วงทำท่า ถือว่าไม่ได้ใช้ (ตัวละครปล่อยมือนั้นไว้ท่าพัก)
HAND_USED = 0.2
# ข้อมือต้องสูงกว่าระดับพักของคลิปอย่างน้อยเท่านี้ (หน่วยความกว้างไหล่) จึงนับว่ายกมือทำท่า
RAISE_MIN = 0.35
# ลำดับความน่าเชื่อถือของแหล่งข้อมูล (น้อย = เลือกก่อน)
SOURCE_RANK = {"tsl51_expert": 0, "TSL-ONE-S": 1, "ล่าม": 2, "tsl51_user": 3}
# ระยะจากข้อมือถึงโคนนิ้วกลางของมือตัวละคร (0.06 × HAND_SCALE 1.25 ใน skeleton.ts)
AVATAR_PALM = 0.075
# ระยะมือยื่นไปข้างหน้าลำตัว (หน่วยตัวละคร) ของท่าจากข้อมูลจริง
#   ข้อมูลมีแค่ x,y (ไม่มีความลึกที่เชื่อถือได้) จึงให้มือชิดลำตัว เพื่อให้ตำแหน่งที่เห็นจากด้านหน้าตรงกับข้อมูลที่สุด
#   (ถ้าดันมือไปข้างหน้ามาก แขนจะต้องยืดไปทางนั้น มือจึงตกต่ำกว่าตำแหน่งจริง เช่น มือที่คอกลายเป็นที่ท้อง)
DATA_FORWARD = 0.09
# ระยะมือยื่นไปข้างหน้าที่ยอมรับจากความลึกจริง (หน่วยตัวละคร) กันค่าความลึกที่เพี้ยนจากการตรวจจับ
FORWARD_MIN, FORWARD_MAX = 0.05, 0.28
# มุมงอที่เก็บได้ของข้อโคน/กลาง/ปลายของนิ้ว (เรเดียน, ลบ = งอย้อนเล็กน้อย) ต้องตรงกับ JOINT_MAX ใน rig.ts
JOINT_RANGE = ((-0.15, 1.6), (0.0, 1.9), (0.0, 1.3))
# มุมกางนิ้วที่เก็บ (เรเดียน บวก = กางออกจากนิ้วกลาง) ต้องตรงกับ SPREAD_MIN/MAX ใน rig.ts
SPREAD_RANGE = (-0.15, 0.45)
# นิ้วที่งอเกินค่านี้ ไม่วัดการกาง (ทิศนิ้วที่พับอยู่บอกการกางไม่ได้ ให้เป็น 0)
SPREAD_MAX_CURL = 0.4
# จำนวนเฟรมที่ใช้หาค่ากลางของรูปมือ (กันนิ้วกระพริบงอ/เหยียดจากการตรวจจับ 2 มิติ)
SHAPE_WINDOW = 7
# ความกว้างฝ่ามือ (โคนนิ้วชี้-โคนนิ้วก้อย) เทียบความยาวฝ่ามือ (ข้อมือ-โคนนิ้วกลาง) ตอนฝ่ามือหันตรงเข้ากล้อง
PALM_RATIO = 0.85
# ข้อต่อนิ้ว [โคน, ข้อกลาง, ข้อปลาย, ปลายนิ้ว] ของนิ้วชี้ กลาง นาง ก้อย
FINGER_JOINTS = [(5, 6, 7, 8), (9, 10, 11, 12), (13, 14, 15, 16), (17, 18, 19, 20)]


# ทำให้เส้นทางการเคลื่อนไหวเรียบขึ้นด้วยค่าเฉลี่ยเคลื่อนที่ (ไม่สนค่า NaN)
def smooth(x: np.ndarray, k: int = 5) -> np.ndarray:
    out = x.copy()
    half = k // 2
    for i in range(len(x)):
        seg = x[max(0, i - half) : i + half + 1]
        with np.errstate(all="ignore"):
            m = np.nanmean(seg, axis=0)
        out[i] = np.where(np.isnan(x[i]), x[i], m)
    return out


# เติมค่าที่หายในแต่ละช่วงด้วยการลากเส้นตรงจากค่าก่อน/หลัง (หัวท้ายใช้ค่าที่ใกล้ที่สุด)
def fill(x: np.ndarray) -> np.ndarray:
    x = x.copy()
    idx = np.arange(len(x))
    flat = x.reshape(len(x), -1)
    for j in range(flat.shape[1]):
        ok = ~np.isnan(flat[:, j])
        if ok.any():
            flat[:, j] = np.interp(idx, idx[ok], flat[ok, j])
    return flat.reshape(x.shape)


# ระดับการงอของนิ้วหนึ่งนิ้ว 0 (เหยียดตรง) - 1 (งอสุด) จากความตรงของนิ้ว
def finger_curl(h: np.ndarray, joints) -> float:
    a, b, c, d = (h[j] for j in joints)
    path = np.linalg.norm(b - a) + np.linalg.norm(c - b) + np.linalg.norm(d - c)
    if path < 1e-6:
        return 0.3
    straight = np.linalg.norm(d - a) / path
    return float(np.clip((1.0 - straight) / 0.55, 0, 1))


# ระดับการพับนิ้วโป้งเข้าฝ่ามือ: ปลายนิ้วโป้งยิ่งใกล้โคนนิ้วก้อยยิ่งพับ
def thumb_curl(h: np.ndarray) -> float:
    palm = np.linalg.norm(h[5] - h[17]) + 1e-6
    return float(np.clip(1.4 - np.linalg.norm(h[4] - h[17]) / palm, 0, 1))


# มุมระหว่างเวกเตอร์สองเส้น (เรเดียน 0-pi)
def angle_between(u: np.ndarray, v: np.ndarray) -> float:
    nu, nv = np.linalg.norm(u), np.linalg.norm(v)
    if nu < 1e-6 or nv < 1e-6:
        return 0.0
    return float(np.arccos(np.clip(np.dot(u, v) / (nu * nv), -1, 1)))


# ตัดส่วนของเวกเตอร์ v ที่ขนานกับแกน n ออก (ฉายลงระนาบที่ตั้งฉากกับ n)
def _flat(v: np.ndarray, n: np.ndarray) -> np.ndarray:
    return v - np.dot(v, n) * n


# กรอบพิกัดของฝ่ามือจากจุดมือ 3 มิติ: แกนนิ้ว (ข้อมือ→โคนนิ้วกลาง), แกนกว้าง (โคนนิ้วชี้→ก้อย), แกนตั้งฉากฝ่ามือ (ด้านฝ่ามือ)
def palm_frame(h: np.ndarray, side: str):
    fwd = h[9] - h[0]
    across = h[17] - h[5]
    normal = np.cross(fwd, across) * (1 if side == "r" else -1)
    nn = np.linalg.norm(normal)
    if np.linalg.norm(fwd) < 1e-6 or nn < 1e-6:
        return None
    normal = normal / nn
    fwd = _flat(fwd, normal)
    return fwd / np.linalg.norm(fwd), normal


# มุมงอรายข้อ (เรเดียน) [โคน, กลาง, ปลาย] ของนิ้วหนึ่งนิ้วจากจุดมือ 3 มิติ
#   ข้อโคน: มุมของกระดูกนิ้วท่อนแรกกับแกนนิ้วของฝ่ามือ วัดเฉพาะในระนาบงอ (ตัดการกางออก) มีเครื่องหมาย (งอเข้าฝ่ามือ = บวก)
#   ข้อกลาง/ปลาย: มุมหักระหว่างกระดูกนิ้วสองท่อนที่ต่อกัน
def finger_joints(h: np.ndarray, joints, frame) -> list[float]:
    fwd, normal = frame
    base, pip, dip, tip = (h[j] for j in joints)
    prox = pip - base
    lateral = np.cross(normal, fwd)
    p = _flat(prox, lateral)
    mcp = math.atan2(float(np.dot(p, normal)), float(np.dot(p, fwd)))
    bends = [mcp, angle_between(pip - base, dip - pip), angle_between(dip - pip, tip - dip)]
    return [round(float(np.clip(b, lo, hi)), 3) for b, (lo, hi) in zip(bends, JOINT_RANGE)]


# มุมกางของนิ้วชี้ นาง ก้อย (เรเดียน บวก = กางออกจากนิ้วกลาง) วัดเทียบกระดูกนิ้วกลางท่อนแรกในระนาบฝ่ามือ
#   นิ้วที่งอมาก (curl > SPREAD_MAX_CURL) ให้ 0 เพราะทิศของนิ้วที่พับบอกการกางไม่ได้
def finger_spread(h: np.ndarray, curls: list[float], frame) -> list[float]:
    _, normal = frame
    mid = _flat(h[10] - h[9], normal)
    out = []
    for joints, curl in ((FINGER_JOINTS[0], curls[1]), (FINGER_JOINTS[2], curls[3]), (FINGER_JOINTS[3], curls[4])):
        if curl > SPREAD_MAX_CURL:
            out.append(0.0)
            continue
        prox = _flat(h[joints[1]] - h[joints[0]], normal)
        ang = math.atan2(float(np.dot(np.cross(mid, prox), normal)), float(np.dot(mid, prox)))
        # ทิศ "ออกจากนิ้วกลาง" = ทิศจากโคนนิ้วกลางไปโคนนิ้วนั้น (ในระนาบฝ่ามือ)
        away = _flat(h[joints[0]] - h[9], normal)
        sign = 1.0 if np.dot(np.cross(mid, away), normal) >= 0 else -1.0
        out.append(round(float(np.clip(ang * sign, *SPREAD_RANGE)), 3))
    return out


# แปลงมือ 21 จุดหนึ่งเฟรม (พิกัดจริงที่แก้สัดส่วนภาพแล้ว) เป็นมุมมือ a และการงอนิ้ว c ตามรูปแบบตัวละคร
#   h3 = จุดมือแบบ 3 มิติ (มีเฉพาะคลิปที่อัดผ่านระบบ) ใช้วัดการงอนิ้วได้แม่นกว่าภาพ 2 มิติ
def hand_shape(h: np.ndarray, h3: np.ndarray | None = None) -> tuple[float, list[float]]:
    v = h[9] - h[0]  # ข้อมือ → โคนนิ้วกลาง
    a = math.atan2(v[0], -v[1])  # 0 = นิ้วชี้ขึ้น, pi = ชี้ลง
    pts = h3 if h3 is not None and np.isfinite(h3).all() else h
    curls = [thumb_curl(pts)] + [finger_curl(pts, j) for j in FINGER_JOINTS]
    return a, [round(c, 2) for c in curls]


# รายละเอียดมือหนึ่งเฟรม: มุมงอรายข้อของนิ้วชี้-ก้อย (4x3 เรเดียน) และมุมกางนิ้ว (3)
#   ต้องมีจุดมือ 3 มิติเท่านั้น (ภาพ 2 มิติวัดข้อโคน/การกางไม่ได้แม่น ทำให้นิ้วหักแปลก) ไม่มีคืน None
def hand_detail(h3: np.ndarray | None, curls: list[float], side: str):
    if h3 is None or not np.isfinite(h3).all():
        return None
    frame = palm_frame(h3, side)
    if frame is None:
        return None
    return [finger_joints(h3, j, frame) for j in FINGER_JOINTS], finger_spread(h3, curls, frame)


# ทิศของฝ่ามือจากภาพ: แนวกว้างฝ่ามือบนจอ (โคนนิ้วชี้ → โคนนิ้วก้อย), สัดส่วนที่เห็นเต็มความกว้าง (0 = เห็นสันมือ, 1 = เห็นเต็มฝ่า)
#   และด้านที่หันเข้ากล้อง (+1 = ฝ่ามือ, -1 = หลังมือ) ดูจากลำดับการวนของจุดบนภาพเทียบกับมือข้างนั้น
def palm_pose(h: np.ndarray, side: str) -> tuple[float, float, float, int]:
    f = h[9] - h[0]
    w = h[17] - h[5]
    fl, wl = np.linalg.norm(f), np.linalg.norm(w)
    if fl < 1e-6 or wl < 1e-6:
        return 0.0, 0.0, 0.0, 1
    visible = float(np.clip(wl / (PALM_RATIO * fl), 0, 1))
    cross = f[0] * w[1] - f[1] * w[0]
    # มือขวาหันฝ่าเข้ากล้อง: นิ้วโป้งอยู่ทางขวาของภาพ ทำให้ cross < 0 (มือซ้ายกลับกัน)
    toward = cross < 0 if side == "r" else cross > 0
    return float(w[0] / wl), float(w[1] / wl), visible, 1 if toward else -1


# แปลงพิกัดจริง (หน่วยความกว้างไหล่ ศูนย์กลางที่กลางไหล่) เป็นพิกัดตัวละคร
def to_avatar(p: np.ndarray, down_gain: float) -> tuple[float, float]:
    x = 0.5 + p[0] * SHOULDER_W
    up = (SHOULDER_Y - MOUTH_Y) / REAL_MOUTH_UP
    y = SHOULDER_Y + p[1] * (up if p[1] < 0 else down_gain)
    return round(float(x), 3), round(float(y), 3)


# เตรียมคลิป: แก้สัดส่วนภาพ ย้ายศูนย์กลางไปกลางไหล่ หารด้วยความกว้างไหล่ (คืน None ถ้าไม่เห็นไหล่)
def normalize(seq: np.ndarray, aspect: float) -> np.ndarray | None:
    seq = seq.astype(np.float64).copy()
    seq[..., 0] *= aspect
    ok = ~np.isnan(seq[:, [F.L_SH, F.R_SH], 0]).any(axis=1)
    if ok.sum() < 3:
        return None
    center = np.nanmedian((seq[ok, F.L_SH] + seq[ok, F.R_SH]) / 2, axis=0)
    width = np.nanmedian(np.linalg.norm(seq[ok, F.L_SH] - seq[ok, F.R_SH], axis=1))
    if not width > 1e-4:
        return None
    return (seq - center) / width


# ความกว้างไหล่ (หน่วยความสูงภาพ หลังแก้สัดส่วนภาพ) ค่ากลางทั้งคลิป ไว้ปรับความลึกให้หน่วยเดียวกับ normalize
def shoulder_width(seq: np.ndarray, aspect: float) -> float:
    s = seq.astype(np.float64).copy()
    s[..., 0] *= aspect
    ok = ~np.isnan(s[:, [F.L_SH, F.R_SH], 0]).any(axis=1)
    return float(np.nanmedian(np.linalg.norm(s[ok, F.L_SH] - s[ok, F.R_SH], axis=1))) if ok.any() else float("nan")


# ข้อมูลความลึกของคลิปที่ normalize แล้ว: depth = ระยะข้อมือยื่นไปหน้าไหล่ (หน่วยความกว้างไหล่) และ hands3d = จุดมือ x,y,z
#   ใช้เมื่อคลิปมี z ที่ใช้ได้ (ข้อมือมีค่าความลึกครบพอ) ไม่งั้นคืน None
def depth_info(norm: np.ndarray, z: np.ndarray, aspect: float, seq: np.ndarray):
    width = shoulder_width(seq, aspect)
    if z is None or not width > 1e-4 or z.shape[0] != norm.shape[0]:
        return None, None
    zn = z.astype(np.float64) * aspect / width
    sh = np.nanmean(zn[:, [F.L_SH, F.R_SH]], axis=1)
    depth, hands3d = {}, {}
    for side, wr, sl in (("l", F.L_WR, F.LH), ("r", F.R_WR, F.RH)):
        d = sh - zn[:, wr]
        if np.isfinite(d).sum() < 3:
            return None, None
        depth[side] = d
        hands3d[side] = np.concatenate([norm[:, sl], zn[:, sl][..., None]], axis=-1)
    return depth, hands3d


# ระยะข้อมือต่ำกว่าแนวไหล่ตอนพัก (เฟรมแรกของคลิป) เฉลี่ยทั้งชุดข้อมูล ใช้ปรับสเกลแกนตั้งใต้ไหล่
def rest_depth(clips) -> float:
    vals = []
    for seq in clips:
        first = seq[: max(2, len(seq) // 10)]
        vals += list(first[:, F.L_WR, 1]) + list(first[:, F.R_WR, 1])
    vals = [v for v in vals if np.isfinite(v) and v > 0.3]
    return float(np.median(vals)) if vals else 1.3


# ระยะมือยื่นไปข้างหน้าลำตัวต่อเฟรม (หน่วยตัวละคร) จากความลึกของข้อมือเทียบกลางไหล่ (หน่วยความกว้างไหล่; ค่า z น้อย = ใกล้กล้อง)
def forward_track(d: np.ndarray) -> np.ndarray:
    f = np.clip(smooth(fill(d), 9) * SHOULDER_W, FORWARD_MIN, FORWARD_MAX)
    return f


# สร้าง keyframe ของท่าจากคลิปที่ normalize แล้ว
def build_motion(seq: np.ndarray, fps: float, down_gain: float, hands3d: dict | None = None,
                 depth: dict | None = None) -> dict | None:
    present = {
        "l": ~np.isnan(seq[:, F.LH][:, 0, 0]),
        "r": ~np.isnan(seq[:, F.RH][:, 0, 0]),
    }
    # ช่วงทำท่า = ช่วงที่ข้อมือยกสูงกว่าระดับพักของคลิปนั้นชัดเจน (มือที่วางพักแต่ยังมองเห็นไม่นับ)
    raised = {}
    for side, wr in (("l", F.L_WR), ("r", F.R_WR)):
        wy = seq[:, wr, 1]
        rest = np.nanpercentile(wy, 90) if np.isfinite(wy).any() else np.nan
        raised[side] = np.nan_to_num(wy, nan=np.inf) < rest - RAISE_MIN
    active = raised["l"] | raised["r"]
    if active.sum() < 3:
        return None
    first, last = np.flatnonzero(active)[[0, -1]]
    # ตัดช่วงยืนนิ่งหัวท้ายคลิปออก เหลือช่วงทำท่า + เวลาเผื่อให้ยก/ลดมือ
    pad = PAD_SEC * fps
    win0, win1 = first - pad, last + pad
    used = {s: raised[s][first : last + 1].mean() >= HAND_USED for s in ("l", "r")}
    if not any(used.values()):
        return None

    tracks = {}
    for side, sl, wr in (("l", F.LH, F.L_WR), ("r", F.RH, F.R_WR)):
        if not used[side]:
            continue
        hand = seq[:, sl].copy()
        # มือที่หายบางเฟรม: ตำแหน่งข้อมือใช้จาก pose แทน ส่วนรูปมือเติมจากเฟรมใกล้เคียง
        wrist = np.where(present[side][:, None], hand[:, 0], seq[:, wr])
        palm = hand[:, 9] if present[side][first : last + 1].any() else np.full_like(wrist, np.nan)
        tr = {"wrist": smooth(fill(wrist)), "palm": smooth(fill(palm)), "hand": fill(hand)}
        if hands3d is not None:
            tr["hand3"] = fill(hands3d[side])
        if depth is not None:
            tr["forward"] = forward_track(depth[side])
        tracks[side] = tr

    # รูปมือทุกเฟรม แล้วหาค่ากลางในช่วงสั้น ๆ ให้นิ่ง (มุมใช้ค่าเฉลี่ยแบบวงกลม)
    shapes = {}
    for side, tr in tracks.items():
        h3 = tr.get("hand3")
        raw = [hand_shape(tr["hand"][i], None if h3 is None else h3[i]) for i in range(len(seq))]
        ang = np.array([a for a, _ in raw])
        curl = np.array([c for _, c in raw])
        details = [hand_detail(None if h3 is None else h3[i], raw[i][1], side) for i in range(len(seq))]
        has_detail = all(d is not None for d in details)
        joints = np.array([d[0] for d in details]) if has_detail else None  # (T, 4, 3)
        spreads = np.array([d[1] for d in details]) if has_detail else None  # (T, 3)
        palms = np.array([palm_pose(tr["hand"][i], side) for i in range(len(seq))])
        half = SHAPE_WINDOW // 2
        sm_a, sm_c, sm_p, sm_j, sm_s = [], [], [], [], []
        for i in range(len(seq)):
            lo, hi = max(0, i - half), i + half + 1
            sm_a.append(math.atan2(np.sin(ang[lo:hi]).mean(), np.cos(ang[lo:hi]).mean()))
            sm_c.append([round(float(v), 2) for v in np.median(curl[lo:hi], axis=0)])
            if has_detail:
                sm_j.append(np.round(np.median(joints[lo:hi], axis=0), 3).tolist())
                sm_s.append([round(float(v), 3) for v in np.median(spreads[lo:hi], axis=0)])
            seg = palms[lo:hi]
            wx, wy = seg[:, 0].mean(), seg[:, 1].mean()
            norm = math.hypot(wx, wy) or 1.0
            sm_p.append(
                {"w": [round(wx / norm, 3), round(wy / norm, 3), round(float(np.median(seg[:, 2])), 2)],
                 "p": 1 if seg[:, 3].sum() >= 0 else -1}
            )
        shapes[side] = (sm_a, sm_c, sm_p, sm_j if has_detail else None, sm_s if has_detail else None)

    step = max(1, round(KEY_EVERY_MS / 1000 * fps))
    picks = list(range(first, last + 1, step))
    if picks[-1] != last:
        picks.append(last)
    frames = []
    for i in picks:
        kf = {"t": round((i - win0) / (win1 - win0), 3)}
        for side, tr in tracks.items():
            a, c = shapes[side][0][i], shapes[side][1][i]
            if np.isfinite(tr["palm"][i]).all():
                # วางกลางฝ่ามือให้ตรงตำแหน่งบนร่างกาย (เช่น ที่ปาก/อก) แล้วถอยกลับไปหาข้อมือตามทิศของมือ
                # เพราะหัวตัวละครอยู่สูงกว่าคนจริง ถ้าวางข้อมือตรง ๆ ปลายนิ้วจะไปไม่ถึงตำแหน่งที่ควรถึง
                px, py = to_avatar(tr["palm"][i], down_gain)
                x, y = round(px - AVATAR_PALM * math.sin(a), 3), round(py + AVATAR_PALM * math.cos(a), 3)
            else:
                x, y = to_avatar(tr["wrist"][i], down_gain)
            fwd = tr["forward"][i] if "forward" in tr else DATA_FORWARD
            kf[side] = {"x": x, "y": y, "a": round(a, 3), "c": c, "z": round(float(fwd), 3), **shapes[side][2][i]}
            # งอรายข้อ/กางนิ้ว: เฉพาะคลิปที่มีจุดมือ 3 มิติ (คลิป 2 มิติใช้ c ตามเดิม)
            if shapes[side][3] is not None:
                kf[side]["j"], kf[side]["s"] = shapes[side][3][i], shapes[side][4][i]
        frames.append(kf)
    return {"duration": int(round((win1 - win0) / fps * 1000)), "frames": frames}


# โหลดคลิปจากชุดข้อมูล TSL (คืนรายการ ต่อคำ)
def load_tsl():
    if not TSL_PATH.is_file():
        print("ไม่พบ tsl_skeleton.npz (ข้ามชุดข้อมูล TSL)")
        return []
    with np.load(TSL_PATH) as d:
        # อ่านแต่ละอาร์เรย์ครั้งเดียว (อ่านซ้ำในลูปจะคลายไฟล์บีบอัดใหม่ทุกครั้ง)
        points, offsets, labels = d["points"], d["offsets"], d["label"]
        signers, sources, aspects, ids = d["signer"], d["source"], d["aspect"], d["sample_id"]
    out = []
    for i, label in enumerate(labels):
        signer = str(signers[i])
        source = "tsl51_expert" if "expert" in signer else ("tsl51_user" if signer == "tsl51_user" else str(sources[i]))
        seq = points[offsets[i] : offsets[i + 1]]
        out.append({"word": str(label), "seq": seq, "aspect": float(aspects[i]), "fps": TSL_FPS.get(str(sources[i]), 25.0),
                    "source": source, "signer": signer, "clip": str(ids[i])})
    return out


# โหลดคลิปที่ล่ามอัดผ่านระบบจาก database + Storage
#   คลิปรุ่นใหม่เก็บความลึก z ด้วย (ใช้หาระยะมือยื่นและงอนิ้วแบบ 3 มิติ) คลิปรุ่นเก่าใช้มือ 2 มิติเหมือนชุดข้อมูล TSL
def load_recorded(conn):
    out = []
    for c in db.recorded_samples(conn):
        if len(c["points"]) < 5:
            continue
        t = c["t_ms"]
        span = (int(t[-1]) - int(t[0])) / 1000
        fps = c["fps"] or ((len(t) - 1) / span if span > 0 else 30)
        out.append({"word": c["word"], "seq": c["points"], "aspect": c["aspect"], "fps": float(fps), "z": c.get("z"),
                    "source": "ล่าม", "signer": c["signer"] or "ไม่ระบุ", "clip": c["id"]})
    return out


# เลือกคลิปตัวแทนของคำ: แหล่งที่น่าเชื่อถือก่อน เห็นมือครบ และความยาวใกล้ค่ากลางของคำนั้น
def pick_clip(cands):
    lengths = np.array([len(c["seq"]) / c["fps"] for c in cands])
    med = np.median(lengths)

    def score(c):
        hands = ~np.isnan(c["seq"][:, F.LH][:, 0, 0]) | ~np.isnan(c["seq"][:, F.RH][:, 0, 0])
        dur = len(c["seq"]) / c["fps"]
        # fps สูงกว่าได้รายละเอียดการเคลื่อนไหวมากกว่า (คลิปเดียวกันที่สร้าง skeleton ใหม่ที่ 50 fps ดีกว่าแบบเก่า 15 fps)
        return (SOURCE_RANK.get(c["source"], 9), -round(hands.mean(), 1), -min(c["fps"], 50), abs(dur - med))

    return min(cands, key=score)


# ใช้สัดส่วนภาพที่ประมาณได้ของแต่ละผู้แสดง (ค่ากลางของทุกคลิปของคนนั้น) แทนค่าเดียวทั้งชุดข้อมูล
#   แต่ละคนในชุดข้อมูล TSL ถ่ายด้วยกล้อง/การตั้งภาพต่างกัน ค่าเดียวทั้งชุดทำให้ท่าหดหรือยืดผิดรูป
def per_signer_aspect(clips) -> None:
    by_signer: dict[str, list[float]] = {}
    for c in clips:
        if c["source"] != "ล่าม":
            a = F.estimate_aspect(c["seq"])
            if 0.4 < a < 2.5:
                by_signer.setdefault(c["signer"], []).append(a)
    medians = {s: float(np.median(v)) for s, v in by_signer.items() if len(v) >= 3}
    for c in clips:
        if c["signer"] in medians:
            c["aspect"] = medians[c["signer"]]


# สร้างท่าจากข้อมูลจริงให้คำในคลังตัวละคร + คำที่เทรนโมเดล + คำที่ล่ามอัด แล้วบันทึกลงตาราง motions
def main():
    conn = db.connect()
    targets = [r[0] for r in conn.execute(
        """
        SELECT word FROM words
        WHERE gloss IS NOT NULL OR in_train_set
           OR id IN (SELECT word_id FROM samples WHERE status <> 'rejected' AND source IN ('record', 'upload'))
        ORDER BY id
        """
    )]

    clips = load_tsl() + load_recorded(conn)
    per_signer_aspect(clips)
    by_word: dict[str, list] = {}
    for c in clips:
        if c["word"] in targets:
            norm = normalize(c["seq"], c["aspect"])
            if norm is not None:
                depth, hands3d = depth_info(norm, c.get("z"), c["aspect"], c["seq"])
                by_word.setdefault(c["word"], []).append({**c, "seq": norm, "depth": depth, "hands3d": hands3d})
    if not by_word:
        raise SystemExit("ไม่มีคลิปของคำเป้าหมาย (รัน import_tsl.py หรืออัดคลิปก่อน)")
    down_gain = (REST_Y - SHOULDER_Y) / rest_depth([c["seq"] for cs in by_word.values() for c in cs])

    made = []
    with conn.transaction():
        for word in targets:
            cands = by_word.get(word)
            if not cands:
                continue
            best = pick_clip(cands)
            m = build_motion(best["seq"], best["fps"], down_gain, best.get("hands3d"), best.get("depth"))
            if m is None:
                continue
            # ท่าใหม่แทนท่าเดิมของคำ (เก็บสีหน้าเดิมไว้ เพราะข้อมูลจริงยังไม่มีสีหน้า)
            word_id = db.word_id(conn, word)
            conn.execute(
                """
                INSERT INTO motions (word_id, duration_ms, frames, face, source, source_dataset, source_contributor, source_clip)
                VALUES (%s, %s, %s, '[]'::jsonb, 'extracted', %s, %s, %s)
                ON CONFLICT (word_id) DO UPDATE SET duration_ms = EXCLUDED.duration_ms, frames = EXCLUDED.frames,
                    source = 'extracted', source_dataset = EXCLUDED.source_dataset,
                    source_contributor = EXCLUDED.source_contributor, source_clip = EXCLUDED.source_clip
                """,
                (word_id, m["duration"], Jsonb(m["frames"]), best["source"], best["signer"], best["clip"]),
            )
            # ให้อวตารทำท่าคำนี้ได้ (คำที่ยังไม่มี gloss ใช้ชื่อคำเป็น gloss)
            conn.execute("UPDATE words SET gloss = word WHERE id = %s AND gloss IS NULL", (word_id,))
            made.append(word)
            print(f"  {word}: {len(m['frames'])} keyframe · {m['duration']} ms · {best['source']} ({best['clip']})")
    conn.close()

    missing = [w for w in targets if w not in made]
    print(f"สร้างท่าจากข้อมูลจริง {len(made)} คำ")
    if missing:
        print(f"ไม่มีข้อมูลจริง (ใช้ท่าเดิมใน database ถ้ามี): {', '.join(missing)}")


if __name__ == "__main__":
    main()
