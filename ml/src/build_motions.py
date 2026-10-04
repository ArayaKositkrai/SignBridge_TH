"""สร้าง keyframe ท่าภาษามือของตัวละคร (ข้อความ → ภาษามือ) จาก skeleton ของคนทำท่าจริง

ใช้:
    python build_motions.py            (ใช้ numpy อย่างเดียว)

แหล่งข้อมูล (เลือกคลิปตัวแทนคำละ 1 คลิป):
    1. ml/data/processed/tsl_skeleton.npz  — ชุดข้อมูล TSL (ให้ผู้เชี่ยวชาญ TSL-51 ก่อน แล้วค่อย TSL-ONE-S)
    2. ml/data/raw/<คำ>/*.landmarks.json   — คลิปที่ล่ามอัดผ่านระบบ

ผลลัพธ์: backend/app/data/motions.json และเพิ่มคำใหม่ลง backend/app/data/vocabulary.json

การแปลงพิกัดไปเป็นพิกัดตัวละคร (ดู frontend/src/lib/avatar/skeleton.ts):
    - แกนนอน: ความกว้างไหล่จริง = ความกว้างไหล่ตัวละคร (0.2)
    - แกนตั้งเหนือไหล่: ยืดให้ระดับปากจริงตรงกับปากตัวละคร (หัวตัวละครอยู่สูงกว่าคนจริง)
    - แกนตั้งใต้ไหล่: ย่อ/ขยายให้ข้อมือตอนพักตรงกับท่าพักของตัวละคร
"""
import json
import math
import sys
from datetime import datetime
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import features as F  # noqa: E402

# โฟลเดอร์หลัก
ROOT = Path(__file__).resolve().parents[2]
ML_DIR = ROOT / "ml"
TSL_PATH = ML_DIR / "data" / "processed" / "tsl_skeleton.npz"
RAW_PATH = ML_DIR / "data" / "raw"
WORDS_PATH = ML_DIR / "configs" / "train_words.json"
OUT_PATH = ROOT / "backend" / "app" / "data" / "motions.json"
AVATAR_VOCAB = ROOT / "backend" / "app" / "data" / "vocabulary.json"

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


# แปลงมือ 21 จุดหนึ่งเฟรม (พิกัดจริงที่แก้สัดส่วนภาพแล้ว) เป็นมุมมือ a และการงอนิ้ว c ตามรูปแบบตัวละคร
#   h3 = จุดมือแบบ 3 มิติ (มีเฉพาะคลิปที่อัดผ่านระบบ) ใช้วัดการงอนิ้วได้แม่นกว่าภาพ 2 มิติ
def hand_shape(h: np.ndarray, h3: np.ndarray | None = None) -> tuple[float, list[float]]:
    v = h[9] - h[0]  # ข้อมือ → โคนนิ้วกลาง
    a = math.atan2(v[0], -v[1])  # 0 = นิ้วชี้ขึ้น, pi = ชี้ลง
    pts = h3 if h3 is not None and np.isfinite(h3).all() else h
    curls = [thumb_curl(pts)] + [finger_curl(pts, j) for j in FINGER_JOINTS]
    return a, [round(c, 2) for c in curls]


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


# ระยะข้อมือต่ำกว่าแนวไหล่ตอนพัก (เฟรมแรกของคลิป) เฉลี่ยทั้งชุดข้อมูล ใช้ปรับสเกลแกนตั้งใต้ไหล่
def rest_depth(clips) -> float:
    vals = []
    for seq in clips:
        first = seq[: max(2, len(seq) // 10)]
        vals += list(first[:, F.L_WR, 1]) + list(first[:, F.R_WR, 1])
    vals = [v for v in vals if np.isfinite(v) and v > 0.3]
    return float(np.median(vals)) if vals else 1.3


# สร้าง keyframe ของท่าจากคลิปที่ normalize แล้ว
def build_motion(seq: np.ndarray, fps: float, down_gain: float, hands3d: dict | None = None) -> dict | None:
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
        tracks[side] = tr

    # รูปมือทุกเฟรม แล้วหาค่ากลางในช่วงสั้น ๆ ให้นิ่ง (มุมใช้ค่าเฉลี่ยแบบวงกลม)
    shapes = {}
    for side, tr in tracks.items():
        h3 = tr.get("hand3")
        raw = [hand_shape(tr["hand"][i], None if h3 is None else h3[i]) for i in range(len(seq))]
        ang = np.array([a for a, _ in raw])
        curl = np.array([c for _, c in raw])
        palms = np.array([palm_pose(tr["hand"][i], side) for i in range(len(seq))])
        half = SHAPE_WINDOW // 2
        sm_a, sm_c, sm_p = [], [], []
        for i in range(len(seq)):
            lo, hi = max(0, i - half), i + half + 1
            sm_a.append(math.atan2(np.sin(ang[lo:hi]).mean(), np.cos(ang[lo:hi]).mean()))
            sm_c.append([round(float(v), 2) for v in np.median(curl[lo:hi], axis=0)])
            seg = palms[lo:hi]
            wx, wy = seg[:, 0].mean(), seg[:, 1].mean()
            norm = math.hypot(wx, wy) or 1.0
            sm_p.append(
                {"w": [round(wx / norm, 3), round(wy / norm, 3), round(float(np.median(seg[:, 2])), 2)],
                 "p": 1 if seg[:, 3].sum() >= 0 else -1}
            )
        shapes[side] = (sm_a, sm_c, sm_p)

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
            kf[side] = {"x": x, "y": y, "a": round(a, 3), "c": c, "z": DATA_FORWARD, **shapes[side][2][i]}
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


# จุดมือ 21 จุดแบบ 3 มิติ (x แก้สัดส่วนภาพแล้ว, z ของ MediaPipe อยู่ในหน่วยเดียวกับ x) ไม่มีมือ = NaN
def hand_xyz(points, aspect: float) -> np.ndarray:
    if not points or len(points) != 21:
        return np.full((21, 3), np.nan)
    return np.array([[p["x"] * aspect, p["y"], p.get("z", 0.0) * aspect] for p in points], dtype=np.float64)


# โหลดคลิปที่ล่ามอัดผ่านระบบ
def load_recorded():
    out = []
    for f in sorted(RAW_PATH.glob("*/*.landmarks.json")):
        meta_file = f.with_name(f.name.replace(".landmarks.json", ".meta.json"))
        meta = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.is_file() else {}
        frames = json.loads(f.read_text(encoding="utf-8"))
        if len(frames) < 5:
            continue
        seq = np.stack([F.from_mediapipe(x.get("pose"), x.get("leftHand"), x.get("rightHand")) for x in frames])
        aspect_ = meta["width"] / meta["height"] if meta.get("width") and meta.get("height") else 1.0
        hands3d = {s: np.stack([hand_xyz(x.get(k), aspect_) for x in frames]) for s, k in (("l", "leftHand"), ("r", "rightHand"))}
        span = (frames[-1].get("t", 0) - frames[0].get("t", 0)) / 1000
        fps = meta.get("fps") or ((len(frames) - 1) / span if span > 0 else 30)
        aspect = meta["width"] / meta["height"] if meta.get("width") and meta.get("height") else 1.0
        out.append({"word": f.parent.name, "seq": seq, "aspect": aspect, "fps": float(fps),
                    "source": "ล่าม", "signer": meta.get("signer") or "ไม่ระบุ", "clip": meta.get("id", f.stem),
                    "hands3d": hands3d})
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


# สร้าง motions.json สำหรับคำในคลังตัวละคร + คำที่เทรนโมเดล
def main():
    vocab = json.loads(AVATAR_VOCAB.read_text(encoding="utf-8"))
    targets = [v["gloss"] for v in vocab]
    if WORDS_PATH.is_file():
        targets += json.loads(WORDS_PATH.read_text(encoding="utf-8"))["words"]
    targets += sorted({f.parent.name for f in RAW_PATH.glob("*/*.landmarks.json")})
    targets = list(dict.fromkeys(targets))

    clips = load_tsl() + load_recorded()
    per_signer_aspect(clips)
    by_word: dict[str, list] = {}
    for c in clips:
        if c["word"] in targets:
            norm = normalize(c["seq"], c["aspect"])
            if norm is not None:
                by_word.setdefault(c["word"], []).append({**c, "seq": norm})
    down_gain = (REST_Y - SHOULDER_Y) / rest_depth([c["seq"] for cs in by_word.values() for c in cs])

    motions = {}
    for word in targets:
        cands = by_word.get(word)
        if not cands:
            continue
        best = pick_clip(cands)
        m = build_motion(best["seq"], best["fps"], down_gain, best.get("hands3d"))
        if m is None:
            continue
        m["source"] = {"dataset": best["source"], "signer": best["signer"], "clip": best["clip"],
                       "aspect": round(best["aspect"], 2), "candidates": len(cands)}
        motions[word] = m
        print(f"  {word}: {len(m['frames'])} keyframe · {m['duration']} ms · {best['source']} ({best['clip']})")

    OUT_PATH.write_text(
        json.dumps({"generated_at": datetime.now().isoformat(timespec="seconds"), "motions": motions},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    # เพิ่มคำที่ได้ท่าจากข้อมูลจริงเข้าคลังของตัวละคร (คำเดิมคงไว้)
    known = {v["word"] for v in vocab}
    added = [w for w in motions if w not in known]
    vocab += [{"gloss": w, "word": w, "clip": None} for w in added]
    AVATAR_VOCAB.write_text(
        "[\n" + ",\n".join(f"  {json.dumps(v, ensure_ascii=False)}" for v in vocab) + "\n]\n", encoding="utf-8"
    )
    missing = [w for w in targets if w not in motions]
    print(f"สร้างท่าจากข้อมูลจริง {len(motions)} คำ · เพิ่มคำใหม่ในคลังตัวละคร {len(added)} คำ")
    if missing:
        print(f"ไม่มีข้อมูลจริง (ใช้ท่าเขียนมือเดิม): {', '.join(missing)}")


if __name__ == "__main__":
    main()
