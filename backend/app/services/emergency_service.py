import json
import os
import threading
import uuid
from pathlib import Path

# โฟลเดอร์เก็บข้อมูลที่ผู้ใช้เพิ่มเอง (เปลี่ยนได้ผ่าน env DATA_DIR)
DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
STORE = DATA_DIR / "custom_phrases.json"
# จำนวนวลีที่เพิ่มเองได้สูงสุด
MAX_PHRASES = 30

# กันการเขียนไฟล์พร้อมกันจากหลายคำขอ
_lock = threading.Lock()


# error เมื่อเพิ่มวลีครบจำนวนสูงสุดแล้ว
class LimitReached(Exception):
    pass


# อ่านรายการวลีจากไฟล์ (ไม่มีไฟล์หรือไฟล์เสียจะคืนรายการว่าง)
def _read() -> list[dict]:
    if not STORE.exists():
        return []
    try:
        return json.loads(STORE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []


# เขียนรายการวลีลงไฟล์ โดยเขียนไฟล์ชั่วคราวก่อนแล้วค่อยแทนที่ กันไฟล์เสียกลางคัน
def _write(items: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STORE.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(STORE)


# ดึงวลีที่ผู้ใช้เพิ่มเองทั้งหมด
def list_phrases() -> list[dict]:
    with _lock:
        return _read()


# เพิ่มวลีใหม่ พร้อมสร้าง id ให้
def add_phrase(label: str, speak: str) -> dict:
    with _lock:
        items = _read()
        if len(items) >= MAX_PHRASES:
            raise LimitReached
        item = {"id": uuid.uuid4().hex[:8], "label": label, "speak": speak}
        items.append(item)
        _write(items)
        return item


# ลบวลีตาม id คืน False ถ้าไม่พบ
def delete_phrase(phrase_id: str) -> bool:
    with _lock:
        items = _read()
        kept = [p for p in items if p["id"] != phrase_id]
        if len(kept) == len(items):
            return False
        _write(kept)
        return True
