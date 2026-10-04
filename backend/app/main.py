import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import emergency, sign_to_text, text_to_sign
from app.api.routes import admin, contributor, logs
from app.services import activity_log

# สร้างแอป FastAPI หลักของ backend
app = FastAPI(title="SignBridge TH API")

# โดเมนหน้าเว็บที่อนุญาตให้เรียก API ได้ (CORS) อ่านจาก env CORS_ORIGINS
origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ลงทะเบียน routes ของแต่ละฟีเจอร์
app.include_router(sign_to_text.router)
app.include_router(text_to_sign.router)
app.include_router(emergency.router)
app.include_router(contributor.router)
app.include_router(admin.router)
app.include_router(logs.router)

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
        activity_log.add(
            actor=activity_log.actor_for(path),
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
    return {"status": "ok"}
