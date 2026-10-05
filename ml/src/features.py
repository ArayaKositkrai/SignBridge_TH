"""แปลง skeleton เป็น feature สำหรับโมเดล — ใช้ร่วมกันทั้งตอนเทรน (ml/src) และตอนแปลจริง (backend)

ใช้แค่ numpy เพื่อให้ backend โหลดได้โดยไม่ต้องลง torch

รูปแบบ skeleton กลางของทุกแหล่งข้อมูล: อาร์เรย์ (T, 48, 2) ของ x,y ในพิกัดภาพ 0-1 (NaN = มองไม่เห็น)
  จุด 0-5  : ไหล่ซ้าย ไหล่ขวา ศอกซ้าย ศอกขวา ข้อมือซ้าย ข้อมือขวา (ซ้าย/ขวา = ข้างของคนทำท่า)
  จุด 6-26 : มือซ้าย 21 จุด
  จุด 27-47: มือขวา 21 จุด

ใบหน้าเก็บแยก: อาร์เรย์ (T, 47, 2) ของจุดสำคัญตาม FACE_KEYPOINTS (NaN = ไม่เห็นหน้า)
  ใช้คำนวณ feature สีหน้า 8 ค่า (คิ้ว ตา ปาก การหันหน้า) ไม่ได้ใช้ตำแหน่งดิบทุกจุด
"""
import numpy as np

# เวอร์ชันของวิธีคำนวณ feature (โมเดลที่เทรนด้วยเวอร์ชันอื่นจะใช้ไม่ได้)
#   1 = แขน + มือ, 2 = เพิ่มสีหน้า
FEATURE_VERSION = 2
# จำนวนจุดทั้งหมด
N_POINTS = 48
# จำนวนเฟรมที่ปรับทุกคลิปให้เท่ากัน
SEQ_LEN = 32
# ตำแหน่งจุดของลำตัวในรูปแบบกลาง
L_SH, R_SH, L_EL, R_EL, L_WR, R_WR = range(6)
# ช่วงของมือซ้าย/ขวาในรูปแบบกลาง
LH = slice(6, 27)
RH = slice(27, 48)
# ตำแหน่งของไหล่ ศอก ข้อมือ ใน pose 33 จุดของ MediaPipe
MP_POSE_IDX = [11, 12, 13, 14, 15, 16]
# เติมค่ามือที่หายได้ไม่เกินกี่เฟรมติดกัน (ก่อนปรับจำนวนเฟรม)
MAX_GAP = 6
# จุดสำคัญของใบหน้า (เลขจุดใน face mesh 478 จุดของ MediaPipe) ต้องตรงกับ frontend/src/lib/mediapipe/faceKeypoints.ts
FACE_KEYPOINTS = [
    70, 63, 105, 66, 107,           # 0-4   คิ้วข้างหนึ่ง
    300, 293, 334, 296, 336,        # 5-9   คิ้วอีกข้าง
    33, 160, 158, 133, 153, 144,    # 10-15 ตา (หางตา บน บน หัวตา ล่าง ล่าง)
    362, 385, 387, 263, 373, 380,   # 16-21 ตาอีกข้าง (หัวตา บน บน หางตา ล่าง ล่าง)
    61, 40, 37, 0, 267, 270, 291, 321, 314, 17, 84, 91,  # 22-33 ปากด้านนอก (มุมปาก 22, 28)
    78, 81, 13, 311, 308, 402, 14, 178,                   # 34-41 ปากด้านใน (บน 36, ล่าง 40)
    1, 152, 10, 234, 454,           # 42-46 ปลายจมูก คาง หน้าผาก แก้ม แก้ม
]
N_FACE = len(FACE_KEYPOINTS)
_BROW = (slice(0, 5), slice(5, 10))
_EYE_UP = ([11, 12], [17, 18])
_EYE_LOW = ([14, 15], [20, 21])
_EYE_W = ((10, 13), (16, 19))
_MOUTH_IN = (36, 40)
_MOUTH_CORNERS = (22, 28)
_NOSE, _CHIN, _FOREHEAD, _CHEEKS = 42, 43, 44, (45, 46)
# feature สีหน้า: คิ้ว 2 + ตา 2 + ปากเปิด + ปากกว้าง + หันซ้ายขวา + ก้มเงย
N_FACE_FEAT = 8
# จำนวน feature ต่อเฟรม: ตำแหน่ง 96 + มือปรากฏ 2 + ความเร็ว 96 + สีหน้า 8 + เห็นหน้า 1 + ความเร็วสีหน้า 8
FEATURE_DIM = N_POINTS * 2 + 2 + N_POINTS * 2 + N_FACE_FEAT * 2 + 1


# แปลง landmarks จาก MediaPipe (pose 33 จุด + มือ) หนึ่งเฟรมเป็นแถวของรูปแบบกลาง (48, 2)
def from_mediapipe(pose, left_hand, right_hand) -> np.ndarray:
    out = np.full((N_POINTS, 2), np.nan, dtype=np.float32)
    if pose is not None and len(pose) >= 17:
        out[:6] = [_xy(pose[i]) for i in MP_POSE_IDX]
    if left_hand is not None and len(left_hand) == 21:
        out[LH] = [_xy(p) for p in left_hand]
    if right_hand is not None and len(right_hand) == 21:
        out[RH] = [_xy(p) for p in right_hand]
    return out


# อ่าน x,y จากจุดที่อาจเป็น dict {"x","y"} หรือ list [x, y, z]
def _xy(p):
    if isinstance(p, dict):
        return (p.get("x", np.nan), p.get("y", np.nan))
    return (p[0], p[1])


# เติมค่ามือที่หายช่วงสั้น ๆ ด้วยการลากเส้นตรงระหว่างเฟรมก่อน/หลัง (ช่วงยาวกว่า MAX_GAP ปล่อยว่าง)
def _fill_short_gaps(hand: np.ndarray) -> np.ndarray:
    present = ~np.isnan(hand[:, 0, 0])
    idx = np.flatnonzero(present)
    if len(idx) < 2:
        return hand
    hand = hand.copy()
    for a, b in zip(idx[:-1], idx[1:]):
        gap = b - a - 1
        if 0 < gap <= MAX_GAP:
            for k in range(1, gap + 1):
                w = k / (gap + 1)
                hand[a + k] = hand[a] * (1 - w) + hand[b] * w
    return hand


# ปรับจำนวนเฟรมเป็น n ด้วยการประมาณค่าเชิงเส้นตามลำดับเฟรม (ค่า NaN ยังคงเป็น NaN)
def _resample(x: np.ndarray, n: int) -> np.ndarray:
    t = len(x)
    if t == 1:
        return np.repeat(x, n, axis=0)
    pos = np.linspace(0, t - 1, n)
    lo = np.floor(pos).astype(int)
    hi = np.minimum(lo + 1, t - 1)
    w = (pos - lo).reshape(-1, *([1] * (x.ndim - 1)))
    return x[lo] * (1 - w) + x[hi] * w


# แปลงจุดใบหน้าจาก MediaPipe หนึ่งเฟรม (478 จุด หรือเฉพาะ 47 จุดสำคัญที่เลือกไว้แล้ว) เป็น (47, 2)
def face_from_mediapipe(face) -> np.ndarray:
    out = np.full((N_FACE, 2), np.nan, dtype=np.float32)
    if face is None:
        return out
    if len(face) >= 468:
        out[:] = [_xy(face[i]) for i in FACE_KEYPOINTS]
    elif len(face) == N_FACE:
        out[:] = [_xy(p) for p in face]
    return out


# feature สีหน้าต่อเฟรม (T, 8) หารด้วยความกว้างหน้า (ไม่ขึ้นกับระยะกล้อง) ไม่เห็นหน้า = NaN
#   คิ้วยก (ระยะคิ้ว-ตา) ซ้าย/ขวา, ตาเปิด (สูง/กว้าง) ซ้าย/ขวา, ปากเปิด, ปากกว้าง, หันซ้ายขวา, ก้มเงย
def _face_signals(face: np.ndarray) -> np.ndarray:
    fw = np.linalg.norm(face[:, _CHEEKS[0]] - face[:, _CHEEKS[1]], axis=1)
    fw = np.where(fw > 1e-4, fw, np.nan)
    y = face[..., 1]
    out = []
    for side in range(2):
        out.append((y[:, _EYE_UP[side]].mean(1) - y[:, _BROW[side]].mean(1)) / fw)
    for side in range(2):
        a, b = _EYE_W[side]
        ew = np.linalg.norm(face[:, a] - face[:, b], axis=1)
        out.append((y[:, _EYE_LOW[side]].mean(1) - y[:, _EYE_UP[side]].mean(1)) / np.where(ew > 1e-4, ew, np.nan))
    out.append((y[:, _MOUTH_IN[1]] - y[:, _MOUTH_IN[0]]) / fw)
    out.append(np.linalg.norm(face[:, _MOUTH_CORNERS[0]] - face[:, _MOUTH_CORNERS[1]], axis=1) / fw)
    mid = (face[:, _CHEEKS[0]] + face[:, _CHEEKS[1]]) / 2
    out.append((face[:, _NOSE, 0] - mid[:, 0]) / fw)
    fh = np.abs(y[:, _CHIN] - y[:, _FOREHEAD])
    out.append((y[:, _NOSE] - (y[:, _CHIN] + y[:, _FOREHEAD]) / 2) / np.where(fh > 1e-4, fh, np.nan))
    return np.stack(out, axis=1).astype(np.float32)


# แปลง skeleton หนึ่งคลิป (T,48,2) เป็น feature (SEQ_LEN, FEATURE_DIM)
#   aspect = ความกว้าง/ความสูงของภาพ ใช้แก้พิกัดให้สัดส่วนจริงก่อนวัดระยะ
#   ย้ายจุดศูนย์กลางไปกลางไหล่ แล้วหารด้วยความกว้างไหล่ (ไม่ขึ้นกับระยะห่างจากกล้อง)
#   face = จุดสำคัญของใบหน้า (T,47,2) ไม่มี (เช่นชุดข้อมูล TSL) = feature สีหน้าเป็น 0 และ "เห็นหน้า" = 0
def clip_features(seq: np.ndarray, aspect: float, face: np.ndarray | None = None) -> np.ndarray | None:
    seq = np.asarray(seq, dtype=np.float32).copy()
    if seq.ndim != 3 or seq.shape[1:] != (N_POINTS, 2) or len(seq) == 0:
        return None
    n_frames = len(seq)
    seq[..., 0] *= aspect
    sh_ok = ~np.isnan(seq[:, [L_SH, R_SH], 0]).any(axis=1)
    if not sh_ok.any():
        return None
    center = np.nanmedian((seq[sh_ok, L_SH] + seq[sh_ok, R_SH]) / 2, axis=0)
    width = np.nanmedian(np.linalg.norm(seq[sh_ok, L_SH] - seq[sh_ok, R_SH], axis=1))
    if not np.isfinite(width) or width < 1e-4:
        return None
    seq = (seq - center) / width

    # ลำตัวที่หายบางเฟรมเติมด้วยค่ากลางของคลิป
    body = seq[:, :6]
    med = np.nanmedian(body, axis=0)
    body = np.where(np.isnan(body), med, body)
    seq[:, :6] = np.nan_to_num(body)

    seq[:, LH] = _fill_short_gaps(seq[:, LH])
    seq[:, RH] = _fill_short_gaps(seq[:, RH])
    present = np.stack([~np.isnan(seq[:, LH][:, 0, 0]), ~np.isnan(seq[:, RH][:, 0, 0])], axis=1).astype(np.float32)

    seq = _resample(np.nan_to_num(seq), SEQ_LEN)
    present = (_resample(present, SEQ_LEN) > 0.5).astype(np.float32)
    seq[:, LH] *= present[:, 0, None, None]
    seq[:, RH] *= present[:, 1, None, None]

    pos = seq.reshape(SEQ_LEN, -1)
    vel = np.diff(pos, axis=0, prepend=pos[:1])
    return np.concatenate([pos, present, vel, _face_features(face, aspect, n_frames)], axis=1).astype(np.float32)


# feature สีหน้าของคลิป (SEQ_LEN, 17): ค่า 8 + เห็นหน้า 1 + ความเร็ว 8
def _face_features(face: np.ndarray | None, aspect: float, n_frames: int) -> np.ndarray:
    out = np.zeros((SEQ_LEN, N_FACE_FEAT * 2 + 1), dtype=np.float32)
    if face is None:
        return out
    face = np.asarray(face, dtype=np.float32).copy()
    if face.shape != (n_frames, N_FACE, 2):
        return out
    face[..., 0] *= aspect
    sig = _face_signals(face)
    seen = ~np.isnan(sig).any(axis=1)
    if not seen.any():
        return out
    sig = _fill_short_gaps(sig[:, :, None])[:, :, 0]
    seen = (~np.isnan(sig).any(axis=1)).astype(np.float32)
    sig = _resample(np.nan_to_num(sig), SEQ_LEN)
    seen = (_resample(seen, SEQ_LEN) > 0.5).astype(np.float32)
    sig *= seen[:, None]
    vel = np.diff(sig, axis=0, prepend=sig[:1])
    return np.concatenate([sig, seen[:, None], vel], axis=1)


# ความยาวต้นแขนตอนแขนห้อย / ความกว้างไหล่ ของคนจริง (วัดจากคลิปที่อัดด้วยระบบซึ่งรู้สัดส่วนภาพ)
UPPER_ARM_RATIO = 0.815


# ประมาณสัดส่วนภาพ (กว้าง/สูง) ของคลิปที่ไม่รู้ขนาดวิดีโอ จากความยาวต้นแขนตอนห้อยเทียบความกว้างไหล่
#   ต้นแขนที่ห้อยตรงยาวตามแกนตั้งล้วน จึงเทียบกับความกว้างไหล่ (แกนนอน) แล้วได้อัตราส่วนของสองแกน
#   คืน NaN ถ้าไม่มีช่วงที่แขนห้อยให้วัด
def estimate_aspect(seq: np.ndarray) -> float:
    seq = np.asarray(seq, dtype=np.float64)
    sw = np.nanmedian(np.abs(seq[:, L_SH, 0] - seq[:, R_SH, 0]))
    vals = []
    for sh, el, wr in ((L_SH, L_EL, L_WR), (R_SH, R_EL, R_WR)):
        wy = seq[:, wr, 1]
        if not np.isfinite(wy).any():
            continue
        rest = wy >= np.nanpercentile(wy, 75)
        up = np.abs(seq[rest, el, 1] - seq[rest, sh, 1])
        dx = np.abs(seq[rest, el, 0] - seq[rest, sh, 0])
        vals += list(up[dx < 0.5 * up])
    if not vals or not sw > 0:
        return float("nan")
    return float(np.nanmedian(vals) / sw / UPPER_ARM_RATIO)


# ---------- ตัวโมเดลแบบ numpy (ใช้ตอนแปลจริง ไม่ต้องลง torch) ----------


# conv1d แบบ "same" padding: x (C_in, T), w (C_out, C_in, K), b (C_out)
def _conv1d(x: np.ndarray, w: np.ndarray, b: np.ndarray) -> np.ndarray:
    k = w.shape[2]
    pad = k // 2
    xp = np.pad(x, ((0, 0), (pad, pad)))
    cols = np.stack([xp[:, i : i + x.shape[1]] for i in range(k)], axis=2)  # (C_in, T, K)
    return np.einsum("ctk,ock->ot", cols, w) + b[:, None]


# ทำนายความน่าจะเป็นของแต่ละคำจาก feature หนึ่งคลิป (ต้องตรงกับ SignCNN ใน train_lstm.py)
def predict_proba(weights: dict, feats: np.ndarray) -> np.ndarray:
    x = (feats - weights["mean"]) / weights["std"]
    h = x.T  # (C, T)
    for i in range(3):
        h = np.maximum(_conv1d(h, weights[f"conv{i}.weight"], weights[f"conv{i}.bias"]), 0)
        if i < 2:
            t = h.shape[1] // 2 * 2
            h = h[:, :t].reshape(h.shape[0], -1, 2).max(axis=2)
    pooled = np.concatenate([h.mean(axis=1), h.max(axis=1)])
    logits = weights["fc.weight"] @ pooled + weights["fc.bias"]
    e = np.exp(logits - logits.max())
    return e / e.sum()
