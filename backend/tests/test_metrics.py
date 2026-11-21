"""ทดสอบการคำนวณตัวชี้วัดโมเดล (ml/src/metrics.py) ด้วยผลทายที่รู้คำตอบแน่นอน

รัน:  cd backend && python -m unittest discover -s tests -v
"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ml" / "src"))

import metrics  # noqa: E402

LABELS = ["ไม่ทำท่า", "สวัสดี", "ขอบคุณ"]


# แปลงคำที่ทาย + ความมั่นใจ เป็นแถวความน่าจะเป็น (ที่เหลือแบ่งให้คลาสอื่นเท่า ๆ กัน)
def row(pred: int, conf: float) -> list[float]:
    rest = (1 - conf) / (len(LABELS) - 1)
    return [conf if i == pred else rest for i in range(len(LABELS))]


# ทดสอบตัวชี้วัดรวมและตารางรายคำ
class MetricsTest(unittest.TestCase):
    # ชุดเทสเล็ก ๆ ที่นับผลได้ด้วยมือ
    def setUp(self):
        cases = [
            (1, 1, 0.9),  # ทำท่า สวัสดี → ขึ้น สวัสดี
            (1, 1, 0.9),
            (1, 0, 0.9),  # ทำท่า สวัสดี → ระบบคิดว่าไม่ทำท่า (เงียบ)
            (2, 2, 0.9),  # ทำท่า ขอบคุณ → ขึ้น ขอบคุณ
            (2, 0, 0.9),  # ทำท่า ขอบคุณ → เงียบ
            (2, 0, 0.9),
            (0, 0, 0.9),  # ไม่ทำท่า → เงียบ (ถูก)
            (0, 1, 0.9),  # ไม่ทำท่า → เผลอขึ้น สวัสดี
            (0, 1, 0.9),
            (0, 2, 0.9),  # ไม่ทำท่า → เผลอขึ้น ขอบคุณ
        ]
        self.y = np.array([c[0] for c in cases])
        self.probs = np.array([row(c[1], c[2]) for c in cases])
        self.m = metrics.compute(self.probs, self.y, LABELS)

    # ความแม่นยำรวม = ทายถูก 4 จาก 10 คลิป
    def test_accuracy(self):
        self.assertAlmostEqual(self.m["accuracy"], 0.4)

    # ตอนไม่ได้ทำท่า (4 คลิป): สวัสดี เผลอขึ้น 2 ครั้ง ขอบคุณ 1 ครั้ง เรียงจากบ่อยสุด
    def test_false_alarm_words(self):
        self.assertEqual(
            self.m["false_alarm_words"],
            [{"word": "สวัสดี", "count": 2, "rate": 0.5}, {"word": "ขอบคุณ", "count": 1, "rate": 0.25}],
        )

    # ทำท่าแล้วเงียบ: ขอบคุณ 2/3 คลิป สวัสดี 1/3 คลิป เรียงจากสัดส่วนมากสุด
    def test_dropped_words(self):
        self.assertEqual(
            self.m["dropped_words"],
            [
                {"word": "ขอบคุณ", "count": 2, "clips": 3, "rate": 0.667},
                {"word": "สวัสดี", "count": 1, "clips": 3, "rate": 0.333},
            ],
        )

    # ไม่มีคลิป "ไม่ทำท่า" ในชุดเทส: ตารางคำที่เผลอขึ้นต้องว่าง ไม่พัง
    def test_no_idle_clips(self):
        keep = self.y != 0
        m = metrics.compute(self.probs[keep], self.y[keep], LABELS)
        self.assertEqual(m["false_alarm_words"], [])
        self.assertIsNone(m["null_false_alarm"])


if __name__ == "__main__":
    unittest.main()
