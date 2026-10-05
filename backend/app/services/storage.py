import httpx
from fastapi import HTTPException

from app.core.config import STORAGE_BUCKET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL

# คุยกับ Supabase Storage ผ่าน REST API ด้วย service role key (bucket เป็น private ดึงไฟล์ได้เฉพาะ backend)
TIMEOUT = 60


# ตรวจว่าตั้งค่า Storage แล้ว
def _check() -> None:
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        raise HTTPException(status_code=503, detail="ยังไม่ได้ตั้งค่า Supabase Storage (SUPABASE_SERVICE_ROLE_KEY ใน .env)")


def _headers() -> dict:
    return {"Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}", "apikey": SUPABASE_SERVICE_ROLE_KEY}


def _object_url(path: str) -> str:
    return f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/{path}"


# สร้าง bucket แบบ private ถ้ายังไม่มี
def ensure_bucket() -> None:
    _check()
    res = httpx.post(
        f"{SUPABASE_URL}/storage/v1/bucket",
        headers=_headers(),
        json={"id": STORAGE_BUCKET, "name": STORAGE_BUCKET, "public": False},
        timeout=TIMEOUT,
    )
    if res.status_code not in (200, 201) and "already exists" not in res.text.lower() and res.status_code != 409:
        raise HTTPException(status_code=502, detail=f"สร้าง bucket ไม่สำเร็จ ({res.status_code})")


# อัปโหลดไฟล์ (ทับของเดิมได้)
def upload(path: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    _check()
    res = httpx.post(
        _object_url(path),
        headers={**_headers(), "Content-Type": content_type, "x-upsert": "true"},
        content=data,
        timeout=TIMEOUT,
    )
    if res.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"อัปโหลดไฟล์ไป Storage ไม่สำเร็จ ({res.status_code})")


# ดาวน์โหลดไฟล์ คืน None ถ้าไม่พบ
def download(path: str) -> bytes | None:
    _check()
    res = httpx.get(_object_url(path), headers=_headers(), timeout=TIMEOUT)
    if res.status_code in (400, 404):
        return None
    if res.status_code != 200:
        raise HTTPException(status_code=502, detail=f"ดึงไฟล์จาก Storage ไม่สำเร็จ ({res.status_code})")
    return res.content


# ลบไฟล์ (ไม่พบก็ไม่ error)
def remove(paths: list[str]) -> None:
    if not paths:
        return
    _check()
    res = httpx.request(
        "DELETE",
        f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}",
        headers=_headers(),
        json={"prefixes": paths},
        timeout=TIMEOUT,
    )
    if res.status_code not in (200, 404):
        raise HTTPException(status_code=502, detail=f"ลบไฟล์ใน Storage ไม่สำเร็จ ({res.status_code})")


# รายชื่อไฟล์ในโฟลเดอร์ (ไม่รวมโฟลเดอร์ย่อย) คืนชื่อไฟล์อย่างเดียว
def list_names(prefix: str) -> set[str]:
    _check()
    res = httpx.post(
        f"{SUPABASE_URL}/storage/v1/object/list/{STORAGE_BUCKET}",
        headers=_headers(),
        json={"prefix": prefix, "limit": 1000},
        timeout=TIMEOUT,
    )
    if res.status_code != 200:
        raise HTTPException(status_code=502, detail=f"อ่านรายการไฟล์ใน Storage ไม่สำเร็จ ({res.status_code})")
    return {o["name"] for o in res.json() if o.get("id")}


# ลิงก์ชั่วคราวสำหรับเปิดไฟล์ตรงจาก Storage (bucket เป็น private) คืน None ถ้าไม่พบไฟล์
def signed_url(path: str, expires_in: int = 3600) -> str | None:
    _check()
    res = httpx.post(
        f"{SUPABASE_URL}/storage/v1/object/sign/{STORAGE_BUCKET}/{path}",
        headers=_headers(),
        json={"expiresIn": expires_in},
        timeout=TIMEOUT,
    )
    if res.status_code in (400, 404):
        return None
    if res.status_code != 200:
        raise HTTPException(status_code=502, detail=f"สร้างลิงก์ไฟล์ไม่สำเร็จ ({res.status_code})")
    return f"{SUPABASE_URL}/storage/v1{res.json()['signedURL']}"
