import math
from collections import Counter, deque

import numpy as np

from app.ml.classifier import features, get_model

# STUB: maps the number of extended fingers to a word so the whole
# frontend -> websocket -> backend pipeline can be exercised before a
# trained model exists. Replace with app.ml.classifier once available.
# จำนวนนิ้วที่ชู -> คำที่แปลได้ (ใช้ทดสอบระบบก่อนมีโมเดลจริง)
FINGER_WORDS = {
    5: "สวัสดี",
    0: "ขอบคุณ",
    1: "ช่วยด้วย",
    2: "ขอโทษ",
    3: "ใช่",
    4: "ไม่ใช่",
}

# จำนวนเฟรมล่าสุดที่ใช้โหวต เพื่อให้ผลไม่กระพริบ
WINDOW = 5
# คู่ (ปลายนิ้ว, ข้อกลาง) ของนิ้วชี้ กลาง นาง ก้อย ใช้เช็กว่านิ้วชูอยู่หรือไม่
FINGER_TIPS_PIPS = [(8, 6), (12, 10), (16, 14), (20, 18)]


# ระยะห่างระหว่างสองจุดบนภาพ
def _dist(a: list[float], b: list[float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


# นับจำนวนนิ้วที่ชูอยู่ (คืน None ถ้าข้อมูลมือไม่ครบ 21 จุด)
def count_extended(hand: list[list[float]]) -> int | None:
    if len(hand) < 21:
        return None
    count = sum(1 for tip, pip in FINGER_TIPS_PIPS if hand[tip][1] < hand[pip][1])
    if _dist(hand[4], hand[17]) > _dist(hand[2], hand[17]):
        count += 1
    return count


# ตัวจำแนกท่าแบบนับนิ้ว (ใช้แทนเมื่อยังไม่มีโมเดลที่เทรนจริง) โหวตผลย้อนหลังหลายเฟรมให้นิ่งขึ้น
class FingerCountRecognizer:
    """Per-connection recognizer that smooths predictions over a short window."""

    # เริ่มต้นหน้าต่างเก็บผลย้อนหลัง
    def __init__(self) -> None:
        self.window: deque[int] = deque(maxlen=WINDOW)

    # จำแนกท่าจากมือซ้ายขวา คืนคำ ความมั่นใจ และคำใกล้เคียง
    def predict(self, left_hand: list, right_hand: list) -> dict:
        counts = [c for c in (count_extended(right_hand), count_extended(left_hand)) if c is not None]
        if not counts:
            self.window.clear()
            return {"text": "", "confidence": 0.0, "candidates": []}

        self.window.append(counts[0])
        votes = Counter(self.window)
        best, hits = votes.most_common(1)[0]
        confidence = round(0.55 + 0.4 * hits / WINDOW, 2)

        candidates = [
            {"text": FINGER_WORDS[n], "confidence": round(confidence * 0.6 / (1 + abs(n - best)), 2)}
            for n in sorted(FINGER_WORDS, key=lambda n: abs(n - best))
            if n != best
        ][:2]
        return {"text": FINGER_WORDS[best], "confidence": confidence, "candidates": candidates}


# ช่วงเวลาย้อนหลังที่ใช้ทาย (มิลลิวินาที) — ใกล้กับความยาวคลิปในชุดข้อมูล
WINDOW_MS = 2200
# ทายใหม่ทุกกี่มิลลิวินาที
PREDICT_EVERY_MS = 200
# จำนวนเฟรมขั้นต่ำในหน้าต่างก่อนเริ่มทาย
MIN_FRAMES = 8
# มองไม่เห็นมือนานเท่านี้ ถือว่าจบท่า ล้างหน้าต่าง (มิลลิวินาที)
HANDS_GONE_MS = 700
# ความน่าจะเป็นขั้นต่ำที่จะแสดงผล
MIN_PROB = 0.45
# ชื่อคลาสของการไม่ทำท่า (ไม่แสดงเป็นคำ)
NULL_LABEL = "ไม่ทำท่า"
# ผลว่างเมื่อยังไม่มีคำ
EMPTY = {"text": "", "confidence": 0.0, "candidates": []}


# ตัวแปลภาษามือด้วยโมเดลจริง: เก็บ skeleton ย้อนหลัง ~2 วินาที แล้วทายคำจากช่วงนั้นเป็นระยะ
class Recognizer:
    # เลือกเวอร์ชันโมเดล (active หรือ draft) ถ้ายังไม่มีโมเดลจริงจะใช้ตัวนับนิ้วแทน
    def __init__(self, version: str = "active") -> None:
        self.version = version
        self.frames: deque[tuple[float, np.ndarray, np.ndarray]] = deque()
        self.last_predict = 0.0
        self.last_hands = 0.0
        self.result: dict = EMPTY
        self.fallback = FingerCountRecognizer()

    # รับ landmarks หนึ่งเฟรม คืนผลล่าสุด (คำ ความมั่นใจ คำใกล้เคียง และเวอร์ชันโมเดล)
    def push(self, ts: float, pose: list, left_hand: list, right_hand: list, aspect: float, face: list | None = None) -> dict:
        model = get_model(self.version)
        if model is None:
            return {**self.fallback.predict(left_hand, right_hand), "model": "นับนิ้ว (ยังไม่มีโมเดล)"}

        hands = len(left_hand) == 21 or len(right_hand) == 21
        if hands:
            self.last_hands = ts
        elif ts - self.last_hands > HANDS_GONE_MS:
            self.frames.clear()
            self.result = EMPTY
            return {**EMPTY, "model": model.version}

        F = features()
        self.frames.append((ts, F.from_mediapipe(pose, left_hand, right_hand), F.face_from_mediapipe(face)))
        while self.frames and ts - self.frames[0][0] > WINDOW_MS:
            self.frames.popleft()

        if len(self.frames) >= MIN_FRAMES and ts - self.last_predict >= PREDICT_EVERY_MS:
            self.last_predict = ts
            ranked = model.predict(
                np.stack([f for _, f, _ in self.frames]), aspect, np.stack([fc for _, _, fc in self.frames])
            )
            self.result = self._to_result(ranked)
        return {**self.result, "model": model.version}

    # แปลงอันดับคำเป็นผลที่หน้าเว็บใช้ (ไม่ทำท่า/ไม่มั่นใจ = ว่าง แต่ยังส่งคำใกล้เคียงไปให้ดู)
    @staticmethod
    def _to_result(ranked: list[tuple[str, float]] | None) -> dict:
        if not ranked:
            return EMPTY
        words = [(w, p) for w, p in ranked if w != NULL_LABEL]
        best, prob = ranked[0]
        candidates = [{"text": w, "confidence": round(p, 2)} for w, p in words[:4]]
        if best == NULL_LABEL or prob < MIN_PROB:
            return {"text": "", "confidence": 0.0, "candidates": candidates[:3]}
        return {"text": best, "confidence": round(prob, 2), "candidates": candidates[1:4]}
