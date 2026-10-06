from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from app.api.deps import current_user
from app.api.routes import emergency, sign_to_text, text_to_sign
from app.api.routes import admin, auth, contributor, logs
from app.core.cors import ORIGIN_REGEX, ORIGINS
from app.db.schema import ensure_schema
from app.db.session import ping
from app.services import activity_log

# สร้างแอป FastAPI หลักของ backend
app = FastAPI(title="SignBridge TH API")

# อนุญาตให้หน้าเว็บเรียก API ได้ (ดู app/core/cors.py) และส่ง cookie session มาด้วย
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_origin_regex=ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ลงทะเบียน routes ของแต่ละฟีเจอร์
app.include_router(auth.router)
app.include_router(sign_to_text.router)
app.include_router(text_to_sign.router)
app.include_router(emergency.router)
app.include_router(contributor.router)
app.include_router(admin.router)
app.include_router(logs.router)

# เพิ่มคอลัมน์ที่โค้ดใหม่ต้องใช้ (ถ้ายังไม่มี) ตอนเริ่มเซิร์ฟเวอร์
ensure_schema()

# ลบ log ที่เก่าเกินกำหนดตอนเริ่มเซิร์ฟเวอร์
try:
    activity_log.prune()
except Exception:  # noqa: BLE001 — log เสียต้องไม่ทำให้เซิร์ฟเวอร์เปิดไม่ได้
    pass

# method ที่ไม่บันทึก (อ่านข้อมูลเฉย ๆ หรือคำขอเช็ก CORS)
SKIP_LOG_METHODS = {"GET", "HEAD", "OPTIONS"}


# บันทึก log อัตโนมัติทุกครั้งที่มีการเรียกฟังก์ชันที่เปลี่ยนข้อมูล (เพิ่ม/แก้/ลบ/เทรน ฯลฯ) ไม่เก็บเนื้อหาที่ส่งมา
@app.middleware("http")
async def log_api_calls(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if request.method in SKIP_LOG_METHODS or not path.startswith("/api/") or path.startswith("/api/logs"):
        return response
    try:
        route = request.scope.get("route")
        template = getattr(route, "path", path)
        params = request.scope.get("path_params") or {}
        # อ่านผู้ใช้และเขียน log ต้องคุยกับ database จึงทำใน thread แยก ไม่ให้เซิร์ฟเวอร์ค้าง
        user = await run_in_threadpool(current_user, request)
        await run_in_threadpool(
            activity_log.add,
            actor=activity_log.actor_for(path, user),
            user_id=user["id"] if user else None,
            kind="ฟังก์ชัน",
            action=logs.ACTION_NAMES.get(f"{request.method} {template}", f"{request.method} {template}"),
            detail=", ".join(f"{v}" for v in params.values()) or None,
            page=request.headers.get("x-page"),
            method=request.method,
            path=template,
            status=response.status_code,
            device=request.headers.get("x-device-id"),
            ip=request.client.host if request.client else None,
        )
    except Exception:  # noqa: BLE001 — บันทึก log ไม่ได้ต้องไม่ทำให้คำขอล้ม
        pass
    return response


# หน้าแรกของ backend ใช้เช็กว่าเซิร์ฟเวอร์ทำงานอยู่
@app.get("/")
def root():
    return {"message": "Hello SignBridge TH"}


# health check สำหรับ Docker และการเช็กสถานะ
@app.get("/api/health")
def health():
    return {"status": "ok", "database": "ok" if ping() else "down"}
