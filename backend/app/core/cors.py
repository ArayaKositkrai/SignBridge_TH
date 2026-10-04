import os
import re

import app.core.config  # noqa: F401  โหลด .env ก่อนอ่าน CORS_ORIGINS

# โดเมนหน้าเว็บที่อนุญาตให้เรียก API ได้ (CORS) อ่านจาก env CORS_ORIGINS
ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
# ตอน dev ยอมให้ localhost ทุกพอร์ต (Vite จะย้ายไป 5174 ถ้า 5173 ไม่ว่าง)
ORIGIN_REGEX = r"http://(localhost|127\.0\.0\.1)(:\d+)?"


# เช็กว่า origin นี้อยู่ในรายการที่อนุญาตหรือไม่ (ใช้กันการ redirect ไปเว็บอื่นด้วย)
def is_allowed_origin(origin: str) -> bool:
    return origin in ORIGINS or re.fullmatch(ORIGIN_REGEX, origin) is not None
