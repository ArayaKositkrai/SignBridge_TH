import importlib.util
import threading
from functools import lru_cache
from pathlib import Path

import numpy as np

from app.core.config import FEATURES_PATH
from app.ml.model_loader import get_active_model_path

# กันการโหลดโมเดลซ้อนกันจากหลายการเชื่อมต่อ
_lock = threading.Lock()
# โมเดลที่โหลดไว้แล้ว: พาธ -> (เวลาแก้ไขไฟล์, โมเดล)
_cache: dict[Path, tuple[float, "SignModel"]] = {}


# โหลดโมดูล features.py จากโฟลเดอร์ ml (ตัวเดียวกับที่ใช้ตอนเทรน จะได้แปลงข้อมูลเหมือนกันเป๊ะ)
@lru_cache(maxsize=1)
def features():
    spec = importlib.util.spec_from_file_location("signbridge_features", FEATURES_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# โมเดลแปลภาษามือหนึ่งเวอร์ชัน (น้ำหนักเป็น numpy ไม่ต้องใช้ torch)
class SignModel:
    # โหลดน้ำหนัก รายชื่อคำ และตรวจว่าเวอร์ชัน feature ตรงกับโค้ดปัจจุบัน
    def __init__(self, path: Path):
        data = np.load(path, allow_pickle=False)
        self.path = path
        self.labels = [str(x) for x in data["labels"]]
        self.weights = {k: data[k] for k in data.files if k not in ("labels", "feature_version")}
        if int(data["feature_version"]) != features().FEATURE_VERSION:
            raise ValueError("feature version mismatch")
        self.uses_face = self._trained_with_face()

    # โมเดลนี้เทรนด้วยคลิปที่เห็นใบหน้าไหม: ช่อง "เห็นหน้า" ของข้อมูลเทรนไม่เคยเปลี่ยน (std ≈ 0) = ไม่เคยเห็นหน้าเลย
    #   (ชุด TSL ไม่มีจุดใบหน้า) ถ้าส่งใบหน้าจริงให้โมเดลแบบนี้ ค่าจะพุ่งผิดปกติหลัง normalize แล้วทายไม่ออกเลย
    def _trained_with_face(self) -> bool:
        F = features()
        face_seen = F.N_POINTS * 4 + 2 + F.N_FACE_FEAT
        std = self.weights.get("std")
        return std is not None and std.shape[-1] > face_seen and float(std[face_seen]) > 1e-3

    # ชื่อเวอร์ชันสั้น เช่น v0.0.2
    @property
    def version(self) -> str:
        stem = self.path.stem
        return stem[stem.find("_v") + 1 :] if "_v" in stem else stem

    # ความน่าจะเป็นของทุกคำ (เรียงตาม self.labels) จาก skeleton (T,48,2) และจุดใบหน้า (T,47,2) หรือ None ถ้าข้อมูลไม่พอ
    def proba(self, seq: np.ndarray, aspect: float, face: np.ndarray | None = None) -> np.ndarray | None:
        # โมเดลที่ไม่เคยเห็นใบหน้าตอนเทรน: ไม่ส่งใบหน้าให้ (ทำเหมือนข้อมูลตอนเทรน)
        feats = features().clip_features(seq, aspect, face if self.uses_face else None)
        if feats is None:
            return None
        return features().predict_proba(self.weights, feats)

    # ทำนายแล้วคืนรายการ (คำ, ความน่าจะเป็น) เรียงจากมากไปน้อย หรือ None ถ้าข้อมูลไม่พอ
    def predict(self, seq: np.ndarray, aspect: float, face: np.ndarray | None = None) -> list[tuple[str, float]] | None:
        probs = self.proba(seq, aspect, face)
        if probs is None:
            return None
        order = np.argsort(probs)[::-1]
        return [(self.labels[i], float(probs[i])) for i in order]


# คืนโมเดลของเวอร์ชันที่ขอ (โหลดใหม่เมื่อไฟล์เปลี่ยน) หรือ None ถ้ายังไม่มีโมเดลที่ใช้ได้
def get_model(version: str = "active") -> SignModel | None:
    path = get_active_model_path(version)
    if path is None or path.suffix != ".npz" or not path.is_file():
        return None
    mtime = path.stat().st_mtime
    with _lock:
        cached = _cache.get(path)
        if cached and cached[0] == mtime:
            return cached[1]
        try:
            model = SignModel(path)
        except (OSError, ValueError, KeyError):
            return None
        _cache[path] = (mtime, model)
        return model
