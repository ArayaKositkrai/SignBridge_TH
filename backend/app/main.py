# จุดเริ่มของ backend (FastAPI): รวม router ทุกกลุ่ม ตั้ง CORS/log การเรียก API โหลดโมเดลรอไว้ และเสิร์ฟหน้าเว็บที่ build แล้ว

import inspect
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.routing import APIRoute

from app.api.deps import current_user
from app.api.routes import emergency, sign_to_text, text_to_sign
from app.api.routes import admin, auth, contributor, logs, profile
from app.core.cors import ORIGIN_REGEX, ORIGINS
from app.db.schema import ensure_schema
from app.db.session import ping
from app.services import activity_log


# โหลดโมเดลแปลภาษามือ (ทำใน thread แยก ไม่ให้เซิร์ฟเวอร์รอ) ไม่สำเร็จก็ไม่เป็นไร เดี๋ยวโหลดตอนมีคนใช้แทน
def _warm_model() -> None:
    try:
        sign_to_text.warm_model()
    except Exception:  # noqa: BLE001
        pass


# ตอนเซิร์ฟเวอร์เริ่มทำงานจริง (ครั้งเดียวต่อ worker ไม่ใช่ตอน import) ให้โหลดโมเดลรอไว้ในพื้นหลัง
@asynccontextmanager
async def lifespan(_app: FastAPI):
    threading.Thread(target=_warm_model, daemon=True).start()
    yield


# ตอนขึ้นเซิร์ฟเวอร์จริง: โฟลเดอร์หน้าเว็บที่ build แล้ว (frontend/dist) ให้ backend เสิร์ฟหน้าเว็บเองจากโดเมนเดียวกับ API
#   หน้าเว็บกับ API อยู่โดเมนเดียวกัน = cookie ล็อกอินใช้ได้ (samesite=lax) และไม่ต้องตั้ง CORS
#   ไม่ได้ตั้ง FRONTEND_DIST (รันในเครื่องแบบเดิม) = ไม่เสิร์ฟหน้าเว็บ ใช้ vite dev ที่พอร์ต 5173 ตามปกติ
_dist = os.getenv("FRONTEND_DIST", "")
FRONTEND_DIST = Path(_dist).resolve() if _dist and (Path(_dist) / "index.html").is_file() else None


# สร้างแอป FastAPI หลักของ backend
app = FastAPI(title="SignBridge TH API", lifespan=lifespan)

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
app.include_router(profile.router)

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


# หน้าแรกของ backend ใช้เช็กว่าเซิร์ฟเวอร์ทำงานอยู่ (ตอนเสิร์ฟหน้าเว็บด้วย = ส่งหน้าเว็บแทน)
@app.get("/")
def root():
    if FRONTEND_DIST:
        return FileResponse(FRONTEND_DIST / "index.html")
    return {"message": "Hello SignBridge TH"}


# health check สำหรับ Docker และการเช็กสถานะ
@app.get("/api/health")
def health():
    return {"status": "ok", "database": "ok" if ping() else "down"}


# ใช้คอมเมนต์ภาษาไทยเหนือแต่ละ route เป็นคำอธิบายในหน้า Swagger (ไม่ต้องเขียนซ้ำ)
for _route in app.routes:
    if isinstance(_route, APIRoute) and not _route.summary:
        _lines = [line.lstrip("# ").rstrip() for line in (inspect.getcomments(_route.endpoint) or "").splitlines()]
        if _lines:
            _route.summary = _lines[0]
            _route.description = _route.description or "\n\n".join(_lines[1:])

# หน้าเว็บ (ต้องอยู่ท้ายสุด ให้ route ของ API ทั้งหมดมาก่อน): ไฟล์ที่มีจริงส่งไฟล์นั้น นอกนั้นส่ง index.html ให้ React Router จัดการ
if FRONTEND_DIST:

    @app.get("/{full_path:path}", include_in_schema=False)
    def frontend(full_path: str):
        if full_path.startswith(("api/", "ws/")):
            raise HTTPException(status_code=404, detail="Not Found")
        file = (FRONTEND_DIST / full_path).resolve()
        if full_path and file.is_file() and FRONTEND_DIST in file.parents:
            return FileResponse(file)
        return FileResponse(FRONTEND_DIST / "index.html")
