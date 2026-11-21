import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
import jwt
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from app.core.config import (
    ADMIN_EMAILS,
    AUTH_SECRET,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    LINE_CHANNEL_ID,
    LINE_CHANNEL_SECRET,
    PUBLIC_API_URL,
    SESSION_DAYS,
)
from app.db.models import EmergencyPhrase, User, UserIdentity
from app.db.session import SessionLocal
from app.services.user_service import mask_card

if not AUTH_SECRET:
    raise RuntimeError("ยังไม่ได้ตั้งค่า AUTH_SECRET (ดูไฟล์ .env ที่รากโปรเจกต์)")

# ค่าของ scrypt สำหรับแฮชรหัสผ่าน (n=2^14 ใช้หน่วยความจำ 16 MB ต่อครั้ง)
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**14, 8, 1
# อายุของ state ตอนไปล็อกอินที่ Google/LINE
OAUTH_STATE_MINUTES = 10


# error ตอนล็อกอิน/สมัคร พร้อมข้อความที่ส่งกลับไปให้หน้าเว็บ
class AuthError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


# บันทึกลง database แปลงกรณีข้อมูลซ้ำ (เช่นสมัครอีเมลเดียวกันพร้อมกันสองหน้าต่าง) เป็นข้อความที่อ่านรู้เรื่อง
#   คนที่บันทึกก่อนได้บัญชี อีกคนได้ข้อความ message แทน error 500
def _commit_unique(db, message: str) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise AuthError(message, 409)


# ---------- รหัสผ่าน ----------


# แฮชรหัสผ่าน เก็บเป็น scrypt$n$r$p$salt$hash
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P)
    b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${b64(salt)}${b64(digest)}"


# เช็กรหัสผ่านกับแฮชที่เก็บไว้
def verify_password(password: str, stored: str | None) -> bool:
    try:
        algo, n, r, p, salt, digest = (stored or "").split("$")
        if algo != "scrypt":
            return False
        actual = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p)
        )
        return hmac.compare_digest(actual, base64.b64decode(digest))
    except ValueError:
        return False


# ---------- session ----------


# สร้าง token ของ session (เก็บแค่ id ผู้ใช้ บทบาทอ่านจาก database ทุกครั้ง)
def create_session(user_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    return jwt.encode({"sub": user_id, "exp": exp, "typ": "session"}, AUTH_SECRET, algorithm="HS256")


# อ่าน token ของ session คืน id ผู้ใช้ หรือ None ถ้าไม่ถูกต้อง/หมดอายุ
def read_session(token: str | None) -> str | None:
    if not token:
        return None
    try:
        data = jwt.decode(token, AUTH_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    return data.get("sub") if data.get("typ") == "session" else None


# ---------- ผู้ใช้ ----------


# ข้อมูลผู้ใช้ที่ส่งให้หน้าเว็บ (ไม่มีรหัสผ่าน)
def public_user(user: User, providers: list[str] | None = None) -> dict:
    return {
        "id": user.id,
        "name": " ".join(filter(None, [user.first_name, user.last_name])),
        "first_name": user.first_name,
        "last_name": user.last_name,
        "email": user.email,
        "role": user.role,
        "has_password": bool(user.password_hash),
        "providers": providers or [],
        # ข้อมูลส่วนตัวในหน้าโปรไฟล์ (เลขบัตรปิดบางหลัก ส่งเลขเต็มเฉพาะตอนเปิดหน้าโปรไฟล์ /api/profile)
        "phone": user.phone,
        "disability_card_masked": mask_card(user.disability_card_number),
        "has_card_image": bool(user.disability_card_image),
    }


# ดึงผู้ใช้ที่ยังใช้งานอยู่ตาม id พร้อมรายชื่อบัญชีที่ผูกไว้
def get_active_user(user_id: str) -> dict | None:
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user is None or not user.active:
            return None
        providers = db.scalars(select(UserIdentity.provider).where(UserIdentity.user_id == user.id)).all()
        return public_user(user, list(providers))


# หาผู้ใช้จากอีเมล (ไม่สนตัวพิมพ์เล็กใหญ่)
def _find_by_email(db, email: str) -> User | None:
    return db.scalar(select(User).where(func.lower(User.email) == email.lower()))


# อีเมลที่อยู่ใน ADMIN_EMAILS ได้เป็นแอดมินอัตโนมัติ
# ใช้เฉพาะอีเมลที่ผู้ให้บริการยืนยันแล้ว (Google) เพราะการสมัครด้วยรหัสผ่านไม่ได้ยืนยันอีเมล
# ใครก็สมัครด้วยอีเมลของแอดมินได้
def _promote_if_admin_email(user: User, verified_email: str | None) -> None:
    if verified_email and verified_email in ADMIN_EMAILS:
        user.role = "admin"


# สมัครสมาชิกด้วยอีเมล/รหัสผ่าน คืน id ผู้ใช้ใหม่
def register(first_name: str, last_name: str | None, email: str, password: str) -> str:
    with SessionLocal() as db:
        if _find_by_email(db, email):
            raise AuthError("อีเมลนี้ถูกใช้สมัครแล้ว", 409)
        user = User(
            first_name=first_name,
            last_name=last_name or None,
            email=email.strip().lower(),
            password_hash=hash_password(password),
            role="user",
            last_login_at=func.now(),
        )
        db.add(user)
        _commit_unique(db, "อีเมลนี้ถูกใช้สมัครแล้ว")
        return user.id


# ล็อกอินด้วยอีเมล/รหัสผ่าน คืน id ผู้ใช้
def login(email: str, password: str) -> str:
    with SessionLocal() as db:
        user = _find_by_email(db, email)
        # เช็กรหัสผ่านทุกครั้งแม้ไม่พบผู้ใช้ เพื่อไม่ให้เดาได้จากเวลาตอบกลับว่ามีอีเมลนี้หรือไม่
        ok = verify_password(password, user.password_hash if user else None)
        if user is None or not ok:
            if user is None:
                hash_password(password)
            raise AuthError("อีเมลหรือรหัสผ่านไม่ถูกต้อง", 401)
        if not user.active:
            raise AuthError("บัญชีนี้ถูกปิดการใช้งาน", 403)
        user.last_login_at = func.now()
        db.commit()
        return user.id


# ---------- Google / LINE ----------


# ตั้งค่าของผู้ให้บริการแต่ละเจ้า
PROVIDERS = {
    "google": {
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "scope": "openid email profile",
    },
    "line": {
        "client_id": LINE_CHANNEL_ID,
        "client_secret": LINE_CHANNEL_SECRET,
        "authorize_url": "https://access.line.me/oauth2/v2.1/authorize",
        "token_url": "https://api.line.me/oauth2/v2.1/token",
        "scope": "openid profile email",
    },
}


# ชื่อที่แสดงให้ผู้ใช้เห็น
PROVIDER_NAMES = {"google": "Google", "line": "LINE"}


# ผู้ให้บริการที่ตั้งค่า client id/secret ไว้แล้ว
def enabled_providers() -> list[str]:
    return [name for name, p in PROVIDERS.items() if p["client_id"] and p["client_secret"]]


# URL ที่ Google/LINE จะส่งผู้ใช้กลับมา (ต้องลงทะเบียนไว้ใน console ของแต่ละเจ้า)
def redirect_uri(provider: str) -> str:
    return f"{PUBLIC_API_URL}/api/auth/{provider}/callback"


# สร้าง URL ไปหน้าล็อกอินของผู้ให้บริการ พร้อม state ที่เซ็นไว้ (เก็บใน cookie)
# link_user_id = ผูกบัญชีนี้เข้ากับผู้ใช้ที่ล็อกอินอยู่ แทนการล็อกอิน
def oauth_start(provider: str, return_to: str, link_user_id: str | None = None) -> tuple[str, str]:
    cfg = PROVIDERS[provider]
    state = secrets.token_urlsafe(24)
    params = {
        "response_type": "code",
        "client_id": cfg["client_id"],
        "redirect_uri": redirect_uri(provider),
        "scope": cfg["scope"],
        "state": state,
    }
    if provider == "google":
        params["prompt"] = "select_account"
    exp = datetime.now(timezone.utc) + timedelta(minutes=OAUTH_STATE_MINUTES)
    cookie = jwt.encode(
        {
            "state": state,
            "provider": provider,
            "return_to": return_to,
            "link": link_user_id,
            "exp": exp,
            "typ": "oauth",
        },
        AUTH_SECRET,
        algorithm="HS256",
    )
    return f"{cfg['authorize_url']}?{urlencode(params)}", cookie


# อ่าน state ที่เก็บไว้ใน cookie คืน dict หรือ None ถ้าไม่ถูกต้อง
def read_oauth_cookie(token: str | None) -> dict | None:
    if not token:
        return None
    try:
        data = jwt.decode(token, AUTH_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    return data if data.get("typ") == "oauth" else None


# แลก code เป็นข้อมูลโปรไฟล์: {sub, email, email_verified, first_name, last_name}
def _fetch_profile(provider: str, code: str) -> dict:
    cfg = PROVIDERS[provider]
    with httpx.Client(timeout=10) as client:
        token_res = client.post(
            cfg["token_url"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri(provider),
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
            },
        )
        if token_res.status_code != 200:
            raise AuthError("ล็อกอินไม่สำเร็จ (แลก token ไม่ได้)", 502)
        tokens = token_res.json()

        if provider == "google":
            res = client.get(
                "https://openidconnect.googleapis.com/v1/userinfo",
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
            )
            if res.status_code != 200:
                raise AuthError("ล็อกอินไม่สำเร็จ (อ่านโปรไฟล์ Google ไม่ได้)", 502)
            info = res.json()
            return {
                "sub": info["sub"],
                "email": info.get("email"),
                "email_verified": bool(info.get("email_verified")),
                "first_name": info.get("given_name") or info.get("name") or "ผู้ใช้ Google",
                "last_name": info.get("family_name"),
            }

        # LINE: ให้ LINE ตรวจ id_token แล้วคืนข้อมูลผู้ใช้
        res = client.post(
            "https://api.line.me/oauth2/v2.1/verify",
            data={"id_token": tokens.get("id_token", ""), "client_id": cfg["client_id"]},
        )
        if res.status_code != 200:
            raise AuthError("ล็อกอินไม่สำเร็จ (ตรวจ id_token ของ LINE ไม่ผ่าน)", 502)
        info = res.json()
        return {
            "sub": info["sub"],
            "email": info.get("email"),
            # LINE ไม่บอกว่ายืนยันอีเมลแล้วหรือยัง จึงไม่ใช้ผูกกับบัญชีเดิม
            "email_verified": False,
            "first_name": info.get("name") or "ผู้ใช้ LINE",
            "last_name": None,
        }


# ล็อกอินด้วย Google/LINE คืน id ผู้ใช้
# เคยผูกบัญชีไว้แล้ว → ใช้ผู้ใช้เดิม / ยังไม่เคย → สร้างผู้ใช้ใหม่
# ไม่ผูกกับบัญชีเดิมที่อีเมลตรงกันอัตโนมัติ เพราะอีเมลของบัญชีรหัสผ่านไม่ได้ยืนยัน
# (คนอื่นอาจสมัครดักอีเมลนั้นไว้ก่อน แล้วได้บัญชีของเจ้าของจริงไปเมื่อเจ้าของล็อกอินด้วย Google)
def oauth_login(provider: str, code: str) -> str:
    profile = _fetch_profile(provider, code)
    email = (profile["email"] or "").strip().lower() or None
    verified_email = email if profile["email_verified"] else None
    with SessionLocal() as db:
        identity = db.scalar(
            select(UserIdentity).where(
                UserIdentity.provider == provider, UserIdentity.provider_user_id == profile["sub"]
            )
        )
        # ล่ามที่แอดมินเพิ่มเองและใส่อีเมลไว้ (ไม่มีรหัสผ่าน ยังไม่ผูกบัญชีใด) + Google/LINE ยืนยันอีเมลนั้นแล้ว
        #   = เจ้าของตัวจริง ผูกเข้าบัญชีเดิม (คลิปและการตั้งค่าชุดเทสของล่ามคนนั้นอยู่บัญชีเดียวกัน)
        existing = None if identity or not verified_email else _find_by_email(db, verified_email)
        claimable = (
            existing is not None
            and not existing.password_hash
            and not db.scalar(select(UserIdentity.id).where(UserIdentity.user_id == existing.id).limit(1))
        )
        if identity:
            user = db.get(User, identity.user_id)
        elif claimable:
            user = existing
            identity = UserIdentity(
                user_id=user.id, provider=provider, provider_user_id=profile["sub"], provider_email=email
            )
            db.add(identity)
        else:
            if verified_email and existing:
                raise AuthError("อีเมลนี้มีบัญชีอยู่แล้ว ให้ล็อกอินด้วยรหัสผ่าน แล้วกด \"ผูกบัญชี Google\" ที่เมนูผู้ใช้", 409)
            user = User(
                first_name=profile["first_name"][:50],
                last_name=profile["last_name"],
                email=verified_email,
                role="user",
            )
            db.add(user)
            try:
                db.flush()
            except IntegrityError:
                db.rollback()
                raise AuthError("อีเมลนี้มีบัญชีอยู่แล้ว ให้ล็อกอินด้วยรหัสผ่าน แล้วกด \"ผูกบัญชี\" ที่เมนูผู้ใช้", 409)
            identity = UserIdentity(
                user_id=user.id, provider=provider, provider_user_id=profile["sub"], provider_email=email
            )
            db.add(identity)

        if not user.active:
            raise AuthError("บัญชีนี้ถูกปิดการใช้งาน", 403)
        _promote_if_admin_email(user, verified_email)
        identity.last_used_at = func.now()
        user.last_login_at = func.now()
        _commit_unique(db, "มีการเข้าสู่ระบบบัญชีนี้พร้อมกันจากอีกหน้าต่าง กรุณาลองอีกครั้ง")
        return user.id


# ผูกบัญชี Google/LINE เข้ากับผู้ใช้ที่ล็อกอินอยู่ (ปลอดภัย เพราะรู้แน่ว่าเป็นเจ้าของบัญชีทั้งสองฝั่ง)
def link_identity(provider: str, code: str, user_id: str) -> None:
    profile = _fetch_profile(provider, code)
    email = (profile["email"] or "").strip().lower() or None
    name = PROVIDER_NAMES.get(provider, provider)
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user is None or not user.active:
            raise AuthError("ไม่พบผู้ใช้", 404)
        identity = db.scalar(
            select(UserIdentity).where(
                UserIdentity.provider == provider, UserIdentity.provider_user_id == profile["sub"]
            )
        )
        if identity and identity.user_id == user.id:
            raise AuthError(f"บัญชี {name} นี้เชื่อมกับบัญชีของคุณไปแล้ว", 409)
        if identity:
            other = db.get(User, identity.user_id)
            other_ids = db.scalars(select(UserIdentity.id).where(UserIdentity.user_id == other.id)).all()
            # บัญชีอื่นที่เข้าได้ด้วยบัญชีนี้ทางเดียว (เช่นเคยล็อกอิน LINE ก่อนสมัครอีเมล) = เจ้าของคนเดียวกัน
            #   ย้ายบัญชีที่ผูก + ปุ่มฉุกเฉินมาไว้ที่ผู้ใช้นี้ (บัญชีเก่ายังอยู่ แต่เข้าสู่ระบบไม่ได้แล้ว)
            if other.password_hash or len(other_ids) > 1 or other.role != "user":
                raise AuthError(f"บัญชี {name} นี้เชื่อมกับบัญชีอื่นไปแล้ว", 409)
            if db.scalar(
                select(UserIdentity.id).where(UserIdentity.user_id == user.id, UserIdentity.provider == provider)
            ):
                raise AuthError(f"คุณเชื่อมบัญชี {name} อื่นไปแล้ว เลิกเชื่อมอันเดิมก่อน", 409)
            identity.user_id = user.id
            db.execute(update(EmergencyPhrase).where(EmergencyPhrase.user_id == other.id).values(user_id=user.id))
        if identity is None:
            if db.scalar(
                select(UserIdentity.id).where(UserIdentity.user_id == user.id, UserIdentity.provider == provider)
            ):
                raise AuthError(f"คุณเชื่อมบัญชี {name} อื่นไปแล้ว เลิกเชื่อมอันเดิมก่อน", 409)
            identity = UserIdentity(
                user_id=user.id, provider=provider, provider_user_id=profile["sub"], provider_email=email
            )
            db.add(identity)
        identity.last_used_at = func.now()
        _commit_unique(db, f"บัญชี {name} นี้เชื่อมไปแล้ว กรุณารีเฟรชหน้าเว็บ")
