import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Identity, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

# โมเดลของตารางที่มีอยู่แล้วใน database (โค้ดไม่ได้สร้างหรือแก้ตารางเอง)


# สร้าง id สั้น 8 ตัวอักษร (เหมือนที่ใช้ในไฟล์ JSON เดิม)
def short_id() -> str:
    return uuid.uuid4().hex[:8]


# ผู้ใช้ระบบ (เตรียมไว้สำหรับระบบ login ด้วย)
class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=short_id)
    first_name: Mapped[str] = mapped_column(Text)
    last_name: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text, unique=True)
    password_hash: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text, default="user", server_default=text("'user'"))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    phone: Mapped[str | None] = mapped_column(Text)
    disability_card_number: Mapped[str | None] = mapped_column(Text)
    disability_card_image: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime)


# บัญชี Google/LINE ที่ผูกกับผู้ใช้ (ผู้ใช้หนึ่งคนผูกได้ผู้ให้บริการละ 1 บัญชี)
class UserIdentity(Base):
    __tablename__ = "user_identities"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(Text)  # google | line
    provider_user_id: Mapped[str] = mapped_column(Text)
    provider_email: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime)
