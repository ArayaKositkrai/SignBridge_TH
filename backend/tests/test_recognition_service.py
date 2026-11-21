"""ทดสอบตัวแปลภาษามือ (Recognizer) ด้วยโมเดลจำลอง ไม่ต้องต่อ database หรือโหลดไฟล์โมเดลจริง

รัน:  cd backend && python -m unittest discover -s tests -v
"""
import sys
import types
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# ป้ายคำของโมเดลจำลอง (คลาสแรก = ไม่ทำท่า)
LABELS = ["ไม่ทำท่า", "สวัสดี", "ขอบคุณ", "ช่วยด้วย"]
# ความน่าจะเป็นที่โมเดลจำลองตอบตอนเห็นมือ / ไม่เห็นมือ (ตั้งค่าในแต่ละเทสต์)
_probs = {"hands": np.array([0.1, 0.6, 0.2, 0.1]), "idle": np.array([0.85, 0.05, 0.05, 0.05])}


# feature จำลอง: เก็บแค่ว่าเฟรมนั้นเห็นมือไหม (1 = เห็น)
class _FakeFeatures:
    # คืน 1 เมื่อมีมือข้างใดข้างหนึ่ง
    def from_mediapipe(self, pose, left, right):
        return np.array([1.0 if (left or right) else 0.0])

    # ใบหน้าไม่ใช้ในเทสต์
    def face_from_mediapipe(self, face):
        return np.zeros(1)


# โมเดลจำลอง: ตอบตามเฟรมล่าสุดว่าเห็นมือหรือไม่
class _FakeModel:
    labels = LABELS
    threshold = 0.5
    version = "test"

    # ความน่าจะเป็นของแต่ละคำ
    def proba(self, seq, aspect, face):
        return _probs["hands"] if seq[-1][0] > 0 else _probs["idle"]


# แทนโมดูล classifier จริง (ที่ต้องต่อ database) ด้วยของจำลองก่อน import ตัวแปล
_fake = types.ModuleType("app.ml.classifier")
_fake.features = lambda: _FakeFeatures()
_fake.get_model = lambda version="active": _FakeModel()
sys.modules["app.ml.classifier"] = _fake

from app.services.recognition_service import HANDS_GONE_MS, Recognizer  # noqa: E402

HAND = [[0.0, 0.0, 0.0]] * 21
STEP_MS = 50


# ป้อนเฟรมต่อกัน n เฟรม (เห็นมือหรือไม่) คืนรายการคำที่ได้ และเวลาล่าสุด
def feed(r: Recognizer, n: int, hands: bool, t: float = 0.0) -> tuple[list[str], float]:
    words = []
    for _ in range(n):
        t += STEP_MS
        out = r.push(t, [], HAND if hands else [], [], 1.0)
        if out.get("word"):
            words.append(out["word"])
    return words, t


# ทดสอบการตัดสินว่าได้คำ
class RecognizerTest(unittest.TestCase):
    # ตั้งค่าความน่าจะเป็นกลับเป็นค่าเริ่มต้นทุกเทสต์
    def setUp(self):
        _probs["hands"] = np.array([0.1, 0.6, 0.2, 0.1])
        _probs["idle"] = np.array([0.85, 0.05, 0.05, 0.05])

    # มั่นใจผ่านเกณฑ์: ได้คำครั้งเดียว ไม่ซ้ำแม้ทำท่าค้าง
    def test_confident_sign_gives_one_word(self):
        words, _ = feed(Recognizer(), 20, hands=True)
        self.assertEqual(words, ["สวัสดี"])

    # มั่นใจสูงมาก: ขึ้นคำทันทีตั้งแต่รอบทายแรก (ไม่ต้องรอชนะติดกัน)
    def test_strong_sign_is_fast(self):
        _probs["hands"] = np.array([0.05, 0.85, 0.05, 0.05])
        r = Recognizer()
        t, first = 0.0, None
        for _ in range(20):
            t += STEP_MS
            if r.push(t, [], HAND, [], 1.0).get("word") and first is None:
                first = t
        self.assertIsNotNone(first)
        self.assertLessEqual(first, 300)

    # ยังไม่มั่นใจพอระหว่างทำท่า แต่นำห่างพอ: ลดมือแล้วต้องได้คำ (รวมช่วงที่ยังส่งเฟรมไม่มีมือก่อนครบเวลา)
    def test_hands_down_flushes_pending_word(self):
        _probs["hands"] = np.array([0.18, 0.42, 0.2, 0.2])
        r = Recognizer()
        during, t = feed(r, 20, hands=True)
        self.assertEqual(during, [])
        after, _ = feed(r, HANDS_GONE_MS // STEP_MS + 5, hands=False, t=t)
        self.assertEqual(after, ["สวัสดี"])

    # ลดมือหลังขึ้นคำไปแล้ว: ต้องไม่ขึ้นคำเดิมซ้ำ
    def test_hands_down_does_not_repeat_last_word(self):
        r = Recognizer()
        during, t = feed(r, 60, hands=True)  # ทำท่าค้างนานเกินเวลากันคำซ้ำ
        after, _ = feed(r, HANDS_GONE_MS // STEP_MS + 5, hands=False, t=t)
        self.assertEqual(during, ["สวัสดี"])
        self.assertEqual(after, [])

    # คำนำไม่ห่างพอ: ลดมือแล้วไม่เดาคำ
    def test_unclear_sign_gives_nothing(self):
        _probs["hands"] = np.array([0.2, 0.34, 0.33, 0.13])
        r = Recognizer()
        during, t = feed(r, 20, hands=True)
        after, _ = feed(r, HANDS_GONE_MS // STEP_MS + 5, hands=False, t=t)
        self.assertEqual(during + after, [])


if __name__ == "__main__":
    unittest.main()
