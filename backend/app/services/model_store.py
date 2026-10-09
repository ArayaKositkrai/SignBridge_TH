import os
import threading
import time
from pathlib import Path

from fastapi import HTTPException

from app.core.config import MODELS_DIR
from app.services import storage

# ไฟล์โมเดลเก็บไว้ที่ Supabase Storage (models/<ชื่อไฟล์>) ด้วย — train.py อัปขึ้นไปหลังเทรนเสร็จ
# backend เครื่องไหนไม่มีไฟล์ในโฟลเดอร์ ml/models จะดาวน์โหลดมาเก็บไว้เอง (โหลดครั้งเดียว ครั้งต่อไปใช้ไฟล์ในเครื่อง)
PREFIX = "models"
# โมเดลที่ลบแล้ว (เก็บไว้กู้คืนได้ และกันการใช้ชื่อไฟล์ซ้ำ)
DELETED_PREFIX = "models/deleted"
# หาไฟล์ใน Storage ไม่เจอ/โหลดไม่สำเร็จ รอเท่านี้ก่อนลองใหม่ (กันยิง Storage ทุกเฟรมตอนแปลภาษามือ)
RETRY_SECONDS = 60
# จำรายชื่อไฟล์ใน Storage ไว้ช่วงสั้น ๆ (หน้ารายการโมเดลเรียกบ่อย)
LIST_CACHE_SECONDS = 30

_lock = threading.Lock()
_downloading: set[str] = set()
_failed_at: dict[str, float] = {}
_list_cache: dict = {"at": 0.0, "names": set()}


def storage_path(file: str) -> str:
    return f"{PREFIX}/{file}"


# ชื่อไฟล์ที่ปลอดภัย (กันการส่ง ../ มาเขียนไฟล์นอกโฟลเดอร์โมเดล)
def _check_name(file: str) -> str:
    if Path(file).name != file or not file.endswith(".npz"):
        raise ValueError(f"ชื่อไฟล์โมเดลไม่ถูกต้อง: {file}")
    return file


# ไฟล์โมเดลที่อยู่ใน Storage (ตั้งค่า Storage ไม่ครบหรืออ่านไม่ได้ = ว่าง)
def remote_files() -> set[str]:
    now = time.monotonic()
    if now - _list_cache["at"] > LIST_CACHE_SECONDS:
        try:
            _list_cache["names"] = storage.list_names(PREFIX)
        except HTTPException:
            _list_cache["names"] = set()
        _list_cache["at"] = now
    return _list_cache["names"]


# ดาวน์โหลดไฟล์โมเดลจาก Storage มาไว้ในเครื่อง (เขียนไฟล์ชั่วคราวแล้วเปลี่ยนชื่อ) คืน True ถ้าได้ไฟล์
def ensure_local(file: str) -> bool:
    path = MODELS_DIR / _check_name(file)
    if path.is_file():
        return True
    try:
        data = storage.download(storage_path(file))
    except HTTPException:
        data = None
    if not data:
        with _lock:
            _failed_at[file] = time.monotonic()
        return False
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".download")
    tmp.write_bytes(data)
    os.replace(tmp, path)
    return True


# เริ่มดาวน์โหลดในพื้นหลัง (ใช้ตอนแปลภาษามือ ไม่ให้การเชื่อมต่อค้างระหว่างรอไฟล์) ระหว่างนี้ระบบใช้ตัวนับนิ้วไปก่อน
def fetch_in_background(file: str) -> None:
    try:
        _check_name(file)
    except ValueError:
        return
    with _lock:
        if file in _downloading or time.monotonic() - _failed_at.get(file, -RETRY_SECONDS) < RETRY_SECONDS:
            return
        _downloading.add(file)

    def run() -> None:
        try:
            ensure_local(file)
        finally:
            with _lock:
                _downloading.discard(file)

    threading.Thread(target=run, daemon=True, name=f"fetch-model-{file}").start()


# ลบโมเดลออกจากที่ใช้งาน: ลบไฟล์ในเครื่องนี้ และย้ายไฟล์ใน Storage ไปไว้ที่ models/deleted/
#   ไม่ลบทิ้งจริงใน Storage: เก็บไว้กู้คืนได้ และกันการใช้ชื่อไฟล์ซ้ำ (train.py ดูชื่อในนี้ตอนตั้งเลขเวอร์ชัน
#   ถ้าใช้ชื่อเดิมซ้ำ CDN ของ Storage อาจส่งไฟล์ตัวเก่าที่ cache ไว้ให้เครื่องอื่นแทนตัวใหม่)
def remove(file: str) -> None:
    (MODELS_DIR / _check_name(file)).unlink(missing_ok=True)
    try:
        if not storage.move(storage_path(file), f"{DELETED_PREFIX}/{file}"):
            storage.remove([storage_path(file)])  # ย้ายไม่ได้ (เช่นมีชื่อซ้ำในถังลบ) ก็ลบทิ้ง
    except HTTPException as e:
        if e.status_code != 503:  # ยังไม่ตั้งค่า Storage = มีแค่ไฟล์ในเครื่อง ไม่ต้องทำอะไรต่อ
            raise
    _list_cache["at"] = 0.0


# อัปไฟล์โมเดลในเครื่องขึ้น Storage
def upload(file: str) -> None:
    storage.upload(storage_path(file), (MODELS_DIR / _check_name(file)).read_bytes())
    _list_cache["at"] = 0.0
