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

    # ชื่อเวอร์ชันสั้น เช่น v0.0.2
    @property
    def version(self) -> str:
        stem = self.path.stem
        return stem[stem.find("_v") + 1 :] if "_v" in stem else stem

    # ทำนายจาก skeleton (T,48,2) และจุดใบหน้า (T,47,2) คืนรายการ (คำ, ความน่าจะเป็น) เรียงจากมากไปน้อย หรือ None ถ้าข้อมูลไม่พอ
    def predict(self, seq: np.ndarray, aspect: float, face: np.ndarray | None = None) -> list[tuple[str, float]] | None:
        feats = features().clip_features(seq, aspect, face)
        if feats is None:
            return None
        probs = features().predict_proba(self.weights, feats)
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
