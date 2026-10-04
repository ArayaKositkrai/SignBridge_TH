from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import emergency, sign_to_text, text_to_sign
from app.api.routes import admin, auth, contributor
from app.core.cors import ORIGIN_REGEX, ORIGINS
from app.db.session import ping

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


# หน้าแรกของ backend ใช้เช็กว่าเซิร์ฟเวอร์ทำงานอยู่
@app.get("/")
def root():
    return {"message": "Hello SignBridge TH"}


# health check สำหรับ Docker และการเช็กสถานะ
@app.get("/api/health")
def health():
    return {"status": "ok", "database": "ok" if ping() else "down"}
