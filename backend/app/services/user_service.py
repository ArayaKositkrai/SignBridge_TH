import json
import os
import threading
import uuid
from datetime import datetime
from pathlib import Path

# โฟลเดอร์เก็บข้อมูลที่ระบบเขียนเอง (เปลี่ยนได้ผ่าน env DATA_DIR)
DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
# ไฟล์เก็บรายชื่อผู้ใช้
STORE = DATA_DIR / "users.json"
# บทบาทที่ใช้ได้: แอดมิน ล่าม (อัดคลิป) ผู้ใช้ทั่วไป
ROLES = ("admin", "contributor", "user")

# กันการเขียนไฟล์พร้อมกันจากหลายคำขอ
_lock = threading.Lock()


# error เมื่อชื่อผู้ใช้ซ้ำ
class DuplicateName(Exception):
    pass


# อ่านรายชื่อผู้ใช้จากไฟล์ (ไม่มีไฟล์หรือไฟล์เสียจะคืนรายการว่าง)
def _read() -> list[dict]:
    if not STORE.exists():
        return []
    try:
        return json.loads(STORE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []


# เขียนรายชื่อผู้ใช้ลงไฟล์แบบปลอดภัย (เขียนไฟล์ชั่วคราวแล้วแทนที่)
def _write(items: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STORE.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(STORE)


# ดึงผู้ใช้ทั้งหมด
def list_users() -> list[dict]:
    with _lock:
        return _read()


# เพิ่มผู้ใช้ใหม่ (ชื่อห้ามซ้ำ ไม่สนตัวพิมพ์เล็กใหญ่)
def add_user(name: str, role: str) -> dict:
    with _lock:
        items = _read()
        if any(u["name"].casefold() == name.casefold() for u in items):
            raise DuplicateName
        user = {
            "id": uuid.uuid4().hex[:8],
            "name": name,
            "role": role,
            "active": True,
            "created_at": datetime.now().isoformat(timespec="seconds"),
        }
        items.append(user)
        _write(items)
        return user


# แก้ไขบทบาทหรือสถานะใช้งานของผู้ใช้ คืน None ถ้าไม่พบ
def update_user(user_id: str, changes: dict) -> dict | None:
    with _lock:
        items = _read()
        for user in items:
            if user["id"] == user_id:
                user.update({k: v for k, v in changes.items() if v is not None})
                _write(items)
                return user
        return None


# ลบผู้ใช้ คืน False ถ้าไม่พบ
def delete_user(user_id: str) -> bool:
    with _lock:
        items = _read()
        kept = [u for u in items if u["id"] != user_id]
        if len(kept) == len(items):
            return False
        _write(kept)
        return True
