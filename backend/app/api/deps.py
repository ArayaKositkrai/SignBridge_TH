from fastapi import Depends, HTTPException, Request

from app.services import auth_service

# ชื่อ cookie ที่เก็บ session
SESSION_COOKIE = "sb_session"


# ผู้ใช้ที่ล็อกอินอยู่ (None ถ้ายังไม่ล็อกอิน) บทบาทอ่านจาก database ทุกครั้ง
# แอดมินเปลี่ยนบทบาทหรือปิดบัญชีแล้วจะมีผลทันที
def current_user(request: Request) -> dict | None:
    user_id = auth_service.read_session(request.cookies.get(SESSION_COOKIE))
    return auth_service.get_active_user(user_id) if user_id else None


# บังคับให้ล็อกอินและมีบทบาทตามที่กำหนด
def require_roles(*roles: str):
    def check(user: dict | None = Depends(current_user)) -> dict:
        if user is None:
            raise HTTPException(status_code=401, detail="กรุณาเข้าสู่ระบบ")
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์ใช้งานส่วนนี้")
        return user

    return check


# ใช้กับ route: แอดมินเท่านั้น / แอดมินหรือล่าม / ใครก็ได้ที่ล็อกอิน
require_admin = require_roles("admin")
require_staff = require_roles("admin", "contributor")
require_login = require_roles("admin", "contributor", "user")
