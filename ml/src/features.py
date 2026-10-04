"""แปลง skeleton เป็น feature สำหรับโมเดล — ใช้ร่วมกันทั้งตอนเทรน (ml/src) และตอนแปลจริง (backend)

ใช้แค่ numpy เพื่อให้ backend โหลดได้โดยไม่ต้องลง torch

รูปแบบ skeleton กลางของทุกแหล่งข้อมูล: อาร์เรย์ (T, 48, 2) ของ x,y ในพิกัดภาพ 0-1 (NaN = มองไม่เห็น)
  จุด 0-5  : ไหล่ซ้าย ไหล่ขวา ศอกซ้าย ศอกขวา ข้อมือซ้าย ข้อมือขวา (ซ้าย/ขวา = ข้างของคนทำท่า)
  จุด 6-26 : มือซ้าย 21 จุด
  จุด 27-47: มือขวา 21 จุด
"""
import numpy as np

# เวอร์ชันของวิธีคำนวณ feature (โมเดลที่เทรนด้วยเวอร์ชันอื่นจะใช้ไม่ได้)
FEATURE_VERSION = 1
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
# จำนวน feature ต่อเฟรม: ตำแหน่ง 96 + มือปรากฏ 2 + ความเร็ว 96
FEATURE_DIM = N_POINTS * 2 + 2 + N_POINTS * 2


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


# แปลง skeleton หนึ่งคลิป (T,48,2) เป็น feature (SEQ_LEN, FEATURE_DIM)
#   aspect = ความกว้าง/ความสูงของภาพ ใช้แก้พิกัดให้สัดส่วนจริงก่อนวัดระยะ
#   ย้ายจุดศูนย์กลางไปกลางไหล่ แล้วหารด้วยความกว้างไหล่ (ไม่ขึ้นกับระยะห่างจากกล้อง)
def clip_features(seq: np.ndarray, aspect: float) -> np.ndarray | None:
    seq = np.asarray(seq, dtype=np.float32).copy()
    if seq.ndim != 3 or seq.shape[1:] != (N_POINTS, 2) or len(seq) == 0:
        return None
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
    return np.concatenate([pos, present, vel], axis=1).astype(np.float32)


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
