import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import emergency, sign_to_text, text_to_sign
from app.api.routes import contributor

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


# หน้าแรกของ backend ใช้เช็กว่าเซิร์ฟเวอร์ทำงานอยู่
@app.get("/")
def root():
    return {"message": "Hello SignBridge TH"}


# health check สำหรับ Docker และการเช็กสถานะ
@app.get("/api/health")
def health():
    return {"status": "ok"}
