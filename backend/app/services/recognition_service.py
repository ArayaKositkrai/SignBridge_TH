from collections import deque

import numpy as np

from app.ml.classifier import features, get_model

# ค่าทั้งหมดด้านล่างเลือกจากการจำลองทำท่าต่อกันหลายคำด้วยผู้แสดงที่โมเดลไม่เคยเห็น (ชุด TSL)
#   วิธีเดิม (หน้าต่าง 2.2 วิ เดียว + หน้าเว็บนับผลซ้ำ 3 ครั้ง ≥ 60%): ทำท่าต่อเนื่องขึ้นคำถูก ~48% หน่วง ~1.5 วิ
#   วิธีนี้ (หลายหน้าต่าง + เฉลี่ยความมั่นใจ + ตัดหน้าต่างหลังได้คำ): ~73% หน่วง ~1.1 วิ
#   ปรับรอบ 2 ให้ทันคนทำเร็ว (จำลองเร่งท่า 1.5/2 เท่า + ตัดช่วงพัก, หน้าเว็บส่ง 20 เฟรม/วิ):
#     ปกติ/1.5x/2x = 78/69/51% หน่วง ~0.5-0.8 วิ (เดิม 76/47/33%) — ใช้ CPU ~25 ms ต่อรอบทาย
#   รอบ 3 (โมเดลที่เทรนแบบปนท่าคำข้างเคียง): เพิ่มเกณฑ์ผ่อน "นำอันดับ 2 ห่างชัด" ด้านล่าง
#     ปกติ/1.5x/2x/2.5x = 78/70/67/47% (ก่อนเพิ่ม 81/68/62/45%) — ทำเร็วขึ้นคำได้มากขึ้น แลกกับคำแทรกเล็กน้อยตอนทำช้า
#     ลองแล้วไม่ได้ผล: ห้ามคำเดิมชนะซ้ำหลังได้คำ (คำแทรกเพิ่มมาก), เทรนปนท่าข้างเคียงแรงขึ้น (แย่ลงทุกความเร็ว)

# ความยาวหน้าต่างย้อนหลังที่ทายพร้อมกัน (มิลลิวินาที): feature ยืดทุกช่วงเป็นจำนวนเฟรมเท่ากัน
#   คำสั้นในหน้าต่างยาวจะถูกบีบจนจำไม่ได้ จึงลองหลายความยาวแล้วเลือกหน้าต่างที่มั่นใจคำที่สุด
#   หน้าต่างสั้นสุด 0.7 วิ รับคำที่คนคล่องทำเร็ว ๆ
WINDOWS_MS = (700, 1000, 1400, 2000)
# ทายใหม่ทุกกี่มิลลิวินาที (ถี่ = ตามทันคำสั้น ๆ ที่ทำต่อกัน)
PREDICT_EVERY_MS = 100
# จำนวนเฟรมขั้นต่ำในหน้าต่างก่อนเริ่มทาย
MIN_FRAMES = 6
# มองไม่เห็นมือนานเท่านี้ ถือว่าจบท่า ล้างหน้าต่าง (มิลลิวินาที)
HANDS_GONE_MS = 700
# น้ำหนักของค่าเฉลี่ยเดิม เมื่อเฉลี่ยความน่าจะเป็นข้ามรอบ (สูง = นิ่งแต่ช้า) ลดการกระพริบของผล
EMA_KEEP = 0.4
# ความมั่นใจเฉลี่ยขั้นต่ำที่จะนับเป็นคำ
WORD_PROB = 0.45
# ต้องได้คำเดิม (ผ่านเกณฑ์) ติดกันกี่รอบ ถึงจะนับเป็นคำ
WORD_HOLD = 2
# ได้คำแล้วเก็บท่าล่าสุดไว้เท่านี้ (มิลลิวินาที) ที่เหลือทิ้ง คำถัดไปจะไม่ปนท่าของคำก่อน
KEEP_AFTER_WORD_MS = 300
# ไม่นับคำเดิมซ้ำภายในเวลานี้ (ท่าค้าง) — ทำคำเดิมซ้ำจริงได้ถ้าเว้นนานกว่านี้
REPEAT_BLOCK_MS = 1500
# เกณฑ์ผ่อน: ความมั่นใจถึง LOW_PROB และนำคำอันดับ 2 อย่างน้อย MARGIN_RATIO เท่า ก็นับเป็นคำได้ (None = ปิด)
#   ท่าที่ทำเร็วมักทายถูกเป็นอันดับ 1 แต่ความมั่นใจไม่ถึง WORD_PROB เพราะท่าของคำข้าง ๆ ปนในหน้าต่าง
LOW_PROB: float | None = 0.25
MARGIN_RATIO = 3.0
# คำที่ผ่านด้วยเกณฑ์ผ่อน ต้องชนะติดกันกี่รอบ (มากกว่า WORD_HOLD กันคำแทรกตอนเปลี่ยนท่า)
LEAD_HOLD = 3
# ความมั่นใจขั้นต่ำที่จะแสดงเป็น "กำลังดูท่า…" (ยังไม่นับเป็นคำ)
SHOW_PROB = 0.3
# ชื่อคลาสของการไม่ทำท่า (ไม่แสดงเป็นคำ)
NULL_LABEL = "ไม่ทำท่า"
# ผลว่างเมื่อยังไม่มีคำ
EMPTY = {"text": "", "confidence": 0.0, "candidates": [], "word": None}
# ข้อความเมื่อยังไม่มีโมเดลที่ใช้งาน (ไม่เดาคำเอง เพราะผลปลอมอันตรายในสถานการณ์ฉุกเฉิน)
NO_MODEL = {**EMPTY, "model": None, "notice": "ยังไม่มีโมเดลแปลภาษามือที่ใช้งาน (แอดมินต้องเทรนและเผยแพร่โมเดลก่อน)"}
# จำนวนเฟรมสูงสุดในหน้าต่าง (กันหน่วยความจำโตไม่จำกัด แม้ส่งข้อมูลถี่ผิดปกติ)
MAX_WINDOW_FRAMES = 240


# ตัวแปลภาษามือด้วยโมเดลจริง: เก็บ skeleton ย้อนหลัง แล้วทายคำเป็นระยะ ได้คำแล้วส่ง "word" ครั้งเดียว
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
        self._reset_votes()
        # คำล่าสุดที่ส่งไปแล้ว และเวลา (กันคำซ้ำจากท่าค้าง)
        self.last_word: tuple[str | None, float] = (None, -1e12)

    # ล้างค่าเฉลี่ยความน่าจะเป็นและคำที่กำลังนับ
    def _reset_votes(self) -> None:
        self.avg: np.ndarray | None = None
        self.candidate: int | None = None
        self.hits = 0

    # รับ landmarks หนึ่งเฟรม คืนผลล่าสุด (คำที่กำลังดู ความมั่นใจ คำใกล้เคียง เวอร์ชันโมเดล และ word เมื่อได้คำใหม่)
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
            self._reset_votes()
            self.result = EMPTY
            return {**EMPTY, "model": model.version}

        F = features()
        self.frames.append((ts, F.from_mediapipe(pose, left_hand, right_hand), F.face_from_mediapipe(face)))
        while self.frames and ts - self.frames[0][0] > max(WINDOWS_MS):
            self.frames.popleft()

        if len(self.frames) < MIN_FRAMES or ts - self.last_predict < PREDICT_EVERY_MS:
            # ผลเดิมยังแสดงต่อได้ แต่ "word" ส่งแค่ครั้งเดียวตอนได้คำ
            return {**self.result, "word": None, "model": model.version}
        self.last_predict = ts
        self.result = self._predict(model, ts, aspect)
        return {**self.result, "model": model.version}

    # ทายจากหลายความยาวหน้าต่าง → เลือกหน้าต่างที่มั่นใจคำที่สุด → เฉลี่ยข้ามรอบ → ตัดสินว่าได้คำหรือยัง
    def _predict(self, model, ts: float, aspect: float) -> dict:
        labels = model.labels
        null = labels.index(NULL_LABEL) if NULL_LABEL in labels else None
        best_probs = None
        best_score = -1.0
        for w in WINDOWS_MS:
            sub = [f for f in self.frames if ts - f[0] <= w]
            if len(sub) < MIN_FRAMES:
                continue
            probs = model.proba(np.stack([f[1] for f in sub]), aspect, np.stack([f[2] for f in sub]))
            if probs is None:
                continue
            score = float(np.delete(probs, null).max()) if null is not None else float(probs.max())
            if score > best_score:
                best_probs, best_score = probs, score
        if best_probs is None:
            return EMPTY

        self.avg = best_probs if self.avg is None else EMA_KEEP * self.avg + (1 - EMA_KEEP) * best_probs
        avg = self.avg
        order = np.argsort(avg)[::-1]
        ranked = [(labels[i], float(avg[i])) for i in order if i != null]
        candidates = [{"text": w, "confidence": round(p, 2)} for w, p in ranked[:4]]
        top = int(order[0])

        # ยังไม่มั่นใจพอ / ไม่ได้ทำท่า: แสดงคำใกล้เคียงไว้ดู แต่ไม่นับเป็นคำ
        second = ranked[1][1] if len(ranked) > 1 else 0.0
        clear_lead = LOW_PROB is not None and avg[top] >= LOW_PROB and avg[top] >= MARGIN_RATIO * second
        if top == null or (avg[top] < WORD_PROB and not clear_lead):
            self.candidate, self.hits = None, 0
            text, conf = (ranked[0] if ranked and ranked[0][1] >= SHOW_PROB else ("", 0.0))
            return {"text": text, "confidence": round(conf, 2), "candidates": candidates[1:4] if text else candidates[:3],
                    "word": None, "pending": bool(text)}

        self.hits = self.hits + 1 if self.candidate == top else 1
        self.candidate = top
        word = labels[top]
        need = WORD_HOLD if avg[top] >= WORD_PROB else LEAD_HOLD
        result = {"text": word, "confidence": round(float(avg[top]), 2), "candidates": candidates[1:4], "word": None,
                  "pending": self.hits < need}
        if self.hits < need:
            return result

        # ได้คำ: ส่ง word ครั้งเดียว แล้วตัดท่าเก่าทิ้ง (คำถัดไปเริ่มนับใหม่จากท่าล่าสุด)
        last, at = self.last_word
        if not (last == word and ts - at < REPEAT_BLOCK_MS):
            result["word"] = word
        self.last_word = (word, ts)
        while self.frames and ts - self.frames[0][0] > KEEP_AFTER_WORD_MS:
            self.frames.popleft()
        self._reset_votes()
        return {**result, "pending": False}
