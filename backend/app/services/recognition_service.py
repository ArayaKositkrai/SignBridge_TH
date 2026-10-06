from collections import deque

import numpy as np

from app.ml.classifier import features, get_model

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
# ข้อความเมื่อยังไม่มีโมเดลที่ใช้งาน (ไม่เดาคำเอง เพราะผลปลอมอันตรายในสถานการณ์ฉุกเฉิน)
NO_MODEL = {**EMPTY, "model": None, "notice": "ยังไม่มีโมเดลแปลภาษามือที่ใช้งาน (แอดมินต้องเทรนและเผยแพร่โมเดลก่อน)"}
# จำนวนเฟรมสูงสุดในหน้าต่าง (กันหน่วยความจำโตไม่จำกัด แม้ส่งข้อมูลถี่ผิดปกติ)
MAX_WINDOW_FRAMES = 240


# ตัวแปลภาษามือด้วยโมเดลจริง: เก็บ skeleton ย้อนหลัง ~2 วินาที แล้วทายคำจากช่วงนั้นเป็นระยะ
#   ts = เวลาของเซิร์ฟเวอร์ (มิลลิวินาที) ไม่ใช้เวลาจากหน้าเว็บ กันข้อมูลเวลาปลอมทำให้หน้าต่างไม่ถูกตัด
#   ฟังก์ชัน push ใช้เวลาคำนวณ (numpy) จึงควรเรียกนอก event loop
class Recognizer:
    # เลือกเวอร์ชันโมเดล (active หรือ draft) ยังไม่มีโมเดลจะตอบว่า "ยังไม่มีโมเดล" ไม่เดาคำ
    def __init__(self, version: str = "active") -> None:
        self.version = version
        self.frames: deque[tuple[float, np.ndarray, np.ndarray]] = deque(maxlen=MAX_WINDOW_FRAMES)
        self.last_predict = 0.0
        self.last_hands = 0.0
        self.result: dict = EMPTY

    # รับ landmarks หนึ่งเฟรม คืนผลล่าสุด (คำ ความมั่นใจ คำใกล้เคียง และเวอร์ชันโมเดล)
    def push(self, ts: float, pose: list, left_hand: list, right_hand: list, aspect: float, face: list | None = None) -> dict:
        model = get_model(self.version)
        if model is None:
            self.frames.clear()
            return NO_MODEL

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
