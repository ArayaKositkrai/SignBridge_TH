# API ล็อกอิน (/api/auth): สมัคร ล็อกอินด้วยอีเมล/Google/LINE ออกจากระบบ และดูผู้ใช้ปัจจุบัน

import re
from urllib.parse import quote, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, field_validator

from app.api.deps import SESSION_COOKIE, current_user
from app.core.config import COOKIE_SECURE, SESSION_DAYS
from app.core.cors import is_allowed_origin
from app.core.rate_limit import limit_auth
from app.services import auth_service
from app.services.auth_service import AuthError

# กลุ่ม route ของระบบล็อกอิน
router = APIRouter(prefix="/api/auth", tags=["auth"])

# cookie เก็บ state ระหว่างไปล็อกอินที่ Google/LINE
OAUTH_COOKIE = "sb_oauth"
# รูปแบบอีเมลแบบง่าย
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# เช็กและจัดรูปอีเมล
def _clean_email(v: str) -> str:
    v = v.strip().lower()
    if not EMAIL_RE.match(v):
        raise ValueError("อีเมลไม่ถูกต้อง")
    return v


# ข้อมูลที่รับตอนสมัครสมาชิก
class RegisterIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=50)
    last_name: str | None = Field(default=None, max_length=50)
    email: str = Field(max_length=254)
    password: str = Field(min_length=8, max_length=128)

    _email = field_validator("email")(_clean_email)

    # ไม่รับชื่อว่าง
    @field_validator("first_name")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v

    # นามสกุลว่าง = ไม่ระบุ
    @field_validator("last_name")
    @classmethod
    def strip_last(cls, v: str | None) -> str | None:
        return (v or "").strip() or None


# ข้อมูลที่รับตอนล็อกอิน
class LoginIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=1, max_length=128)

    _email = field_validator("email")(_clean_email)


# ใส่ cookie session ลงคำตอบ (httpOnly: JavaScript อ่านไม่ได้)
def _set_session(response: Response, user_id: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        auth_service.create_session(user_id),
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        path="/",
    )


# แปลง AuthError เป็น HTTP error
def _http(e: AuthError) -> HTTPException:
    return HTTPException(status_code=e.status, detail=e.message)


# ผู้ใช้ที่ล็อกอินอยู่ (user = null ถ้ายังไม่ล็อกอิน) และวิธีล็อกอินที่เปิดใช้
@router.get("/me")
def me(user: dict | None = Depends(current_user)):
    return {"user": user, "providers": auth_service.enabled_providers()}


# สมัครสมาชิกด้วยอีเมล/รหัสผ่าน แล้วล็อกอินให้ทันที
@router.post("/register", status_code=201, dependencies=[Depends(limit_auth)])
def register(body: RegisterIn, response: Response):
    try:
        user_id = auth_service.register(body.first_name, body.last_name, body.email, body.password)
    except AuthError as e:
        raise _http(e)
    _set_session(response, user_id)
    return {"user": auth_service.get_active_user(user_id)}


# ล็อกอินด้วยอีเมล/รหัสผ่าน (จำกัดจำนวนครั้งต่อ IP ด้วย limit_auth)
@router.post("/login", dependencies=[Depends(limit_auth)])
def login(body: LoginIn, response: Response):
    try:
        user_id = auth_service.login(body.email, body.password)
    except AuthError as e:
        raise _http(e)
    _set_session(response, user_id)
    return {"user": auth_service.get_active_user(user_id)}


# ออกจากระบบ
@router.post("/logout", status_code=204)
def logout():
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


# ไปหน้าล็อกอินของ Google/LINE (return_to = หน้าเว็บที่จะกลับไปหลังล็อกอิน)
# link=true = ผูกบัญชีเข้ากับผู้ใช้ที่ล็อกอินอยู่ (ใช้ล็อกอินด้วยบัญชีนั้นได้ครั้งต่อไป)
@router.get("/{provider}/start")
def oauth_start(provider: str, return_to: str, link: bool = False, user: dict | None = Depends(current_user)):
    if provider not in auth_service.enabled_providers():
        raise HTTPException(status_code=404, detail="ยังไม่ได้เปิดใช้การล็อกอินด้วยวิธีนี้")
    # กันการพาไปเว็บอื่น: ให้กลับได้เฉพาะหน้าเว็บที่อนุญาตใน CORS
    parts = urlsplit(return_to)
    if not is_allowed_origin(f"{parts.scheme}://{parts.netloc}"):
        raise HTTPException(status_code=400, detail="return_to ไม่ได้รับอนุญาต")
    if link and user is None:
        raise HTTPException(status_code=401, detail="กรุณาเข้าสู่ระบบก่อนผูกบัญชี")
    url, state_cookie = auth_service.oauth_start(provider, return_to, user["id"] if link else None)
    response = RedirectResponse(url, status_code=302)
    response.set_cookie(
        OAUTH_COOKIE, state_cookie, max_age=600, httponly=True, samesite="lax", secure=COOKIE_SECURE, path="/api/auth"
    )
    return response


# Google/LINE ส่งผู้ใช้กลับมาที่นี่ แลก code เป็นข้อมูลผู้ใช้ แล้วพากลับไปหน้าเว็บ
@router.get("/{provider}/callback")
def oauth_callback(
    provider: str,
    request: Request,
    code: str | None = None,
    state: str | None = None,
    user: dict | None = Depends(current_user),
):
    saved = auth_service.read_oauth_cookie(request.cookies.get(OAUTH_COOKIE))
    if saved is None or saved["provider"] != provider:
        raise HTTPException(status_code=400, detail="หมดเวลาล็อกอิน กรุณาลองใหม่")
    parts = urlsplit(saved["return_to"])
    login_page = f"{parts.scheme}://{parts.netloc}/login"

    # โหมดผูกบัญชี: กลับไปหน้าเดิมพร้อมผลลัพธ์ (ผู้ใช้ที่ล็อกอินต้องเป็นคนเดียวกับตอนเริ่ม)
    if saved.get("link"):
        sep = "&" if parts.query else "?"
        try:
            if not code or state != saved["state"] or user is None or user["id"] != saved["link"]:
                raise AuthError("ผูกบัญชีไม่สำเร็จ")
            auth_service.link_identity(provider, code, saved["link"])
            response = RedirectResponse(f"{saved['return_to']}{sep}auth_linked={provider}", status_code=302)
        except AuthError as e:
            response = RedirectResponse(f"{saved['return_to']}{sep}auth_error={quote(e.message)}", status_code=302)
    # ผู้ใช้กดยกเลิก หรือ state ไม่ตรง (อาจถูกปลอมคำขอ)
    elif not code or state != saved["state"]:
        response = RedirectResponse(f"{login_page}?error={quote('ล็อกอินไม่สำเร็จ')}", status_code=302)
    else:
        try:
            user_id = auth_service.oauth_login(provider, code)
            response = RedirectResponse(saved["return_to"], status_code=302)
            _set_session(response, user_id)
        except AuthError as e:
            response = RedirectResponse(f"{login_page}?error={quote(e.message)}", status_code=302)
    response.delete_cookie(OAUTH_COOKIE, path="/api/auth")
    return response
