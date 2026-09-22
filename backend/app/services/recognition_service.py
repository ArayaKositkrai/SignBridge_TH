import math
from collections import Counter, deque

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


# ตัวจำแนกท่าของการเชื่อมต่อหนึ่งครั้ง โหวตผลย้อนหลังหลายเฟรมให้นิ่งขึ้น
class Recognizer:
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
