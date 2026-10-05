import time
from pathlib import Path

from app.core.config import MODELS_DIR
from app.services.model_registry import get_by_status

# จำผลการค้นหาไว้ช่วงสั้น ๆ (ถูกเรียกทุกเฟรมตอนแปลภาษามือ ไม่ควรถาม database ทุกครั้ง)
CACHE_SECONDS = 5
_cache: dict[str, tuple[float, Path | None]] = {}


# คืนพาธไฟล์โมเดลเวอร์ชันที่ใช้งานอยู่ (หรือ draft ถ้าขอ ไม่มี draft ใช้ active) คืน None ถ้ายังไม่มี
def get_active_model_path(version: str = "active") -> Path | None:
    now = time.monotonic()
    hit = _cache.get(version)
    if hit and now - hit[0] < CACHE_SECONDS:
        return hit[1]
    try:
        model = (get_by_status("draft") if version == "draft" else None) or get_by_status("active")
    except Exception:  # noqa: BLE001 — database ล่มต้องไม่ทำให้การแปลภาษามือพัง ใช้ค่าเดิมต่อ
        return hit[1] if hit else None
    path = MODELS_DIR / model.file if model else None
    _cache[version] = (now, path)
    return path


# ล้างค่าที่จำไว้ (เรียกหลังเปลี่ยนเวอร์ชันโมเดล)
def clear_cache() -> None:
    _cache.clear()
