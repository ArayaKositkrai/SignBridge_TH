import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Identity, Integer, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# บัญชี Google/LINE ที่ผูกกับผู้ใช้ (ผู้ใช้หนึ่งคนผูกได้ผู้ให้บริการละ 1 บัญชี)
class UserIdentity(Base):
    __tablename__ = "user_identities"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(Text)  # google | line
    provider_user_id: Mapped[str] = mapped_column(Text)
    provider_email: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ปุ่มสื่อสารฉุกเฉินที่ผู้ใช้เพิ่มเอง (แยกตามผู้ใช้ แต่ละคนเห็น/แก้ได้เฉพาะของตัวเอง)
class EmergencyPhrase(Base):
    __tablename__ = "emergency_phrases"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=short_id)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id", ondelete="CASCADE"))
    label: Mapped[str] = mapped_column(Text)
    speak: Mapped[str] = mapped_column(Text, default="")  # ว่าง = พูดตาม label
    icon: Mapped[str] = mapped_column(Text, default="star")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# log การใช้งาน
class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    user_id: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id", ondelete="SET NULL"))
    actor: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    action: Mapped[str] = mapped_column(Text)
    detail: Mapped[str | None] = mapped_column(Text)
    page: Mapped[str | None] = mapped_column(Text)
    method: Mapped[str | None] = mapped_column(Text)
    path: Mapped[str | None] = mapped_column(Text)
    status: Mapped[int | None] = mapped_column(Integer)
    device: Mapped[str | None] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(Text)


# คลังคำศัพท์ (รวมคำที่ต้องอัด คำของอวตาร และคำที่ใช้เทรน)
class Word(Base):
    __tablename__ = "words"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    word: Mapped[str] = mapped_column(Text, unique=True)
    gloss: Mapped[str | None] = mapped_column(Text)  # ชื่อท่าของอวตาร (null = ไม่มีใน Text->Sign)
    category: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[str | None] = mapped_column(Text)
    assigned_to: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(Text)
    to_record: Mapped[bool] = mapped_column(Boolean, default=False)
    clip_url: Mapped[str | None] = mapped_column(Text)
    in_train_set: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# จำนวนคลิปจากชุดข้อมูลภายนอกต่อคำ (source: tsl51 | tsl_one)
class WordExternalSource(Base):
    __tablename__ = "word_external_sources"

    word_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("words.id", ondelete="CASCADE"), primary_key=True)
    source: Mapped[str] = mapped_column(Text, primary_key=True)
    clips: Mapped[int] = mapped_column(Integer, default=0)
    contributors: Mapped[int] = mapped_column(Integer, default=0)


# คนที่ทำท่าในคลิป (ใช้แบ่งชุดเทสตามคน)
class Contributor(Base):
    __tablename__ = "contributors"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True)
    user_id: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id", ondelete="SET NULL"), unique=True)


# คลิป skeleton หนึ่งคลิป (ตัวไฟล์อยู่ใน Supabase Storage ที่ file_path)
class Sample(Base):
    __tablename__ = "samples"

    id: Mapped[str] = mapped_column(Text, primary_key=True)  # YYYYMMDD-HHMMSS-xxxxxx
    word_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("words.id", ondelete="CASCADE"))
    contributor_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("contributors.id", ondelete="SET NULL"))
    uploaded_by: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id", ondelete="SET NULL"))
    source: Mapped[str] = mapped_column(Text)  # record | upload | tsl51 | tsl_one
    source_ref: Mapped[str | None] = mapped_column(Text)
    file_path: Mapped[str] = mapped_column(Text, unique=True)
    format_version: Mapped[int] = mapped_column(Integer, default=1)
    frame_count: Mapped[int] = mapped_column(Integer)
    fps: Mapped[float | None] = mapped_column(Float)
    fps_estimated: Mapped[bool] = mapped_column(Boolean, default=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    pose_present_rate: Mapped[float | None] = mapped_column(Float)
    lh_present_rate: Mapped[float | None] = mapped_column(Float)
    rh_present_rate: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str] = mapped_column(Text, default="pending")  # pending | approved | rejected
    reviewed_by: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    split: Mapped[str] = mapped_column(Text, default="train")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# โมเดลแต่ละเวอร์ชัน (ไฟล์ .npz อยู่ในโฟลเดอร์ ml/models)
class Model(Base):
    __tablename__ = "models"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    version: Mapped[str] = mapped_column(Text, unique=True)
    file: Mapped[str] = mapped_column(Text, unique=True)
    status: Mapped[str] = mapped_column(Text, default="draft")  # active | draft | archived
    trained_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    samples: Mapped[int | None] = mapped_column(Integer)
    feature_version: Mapped[str | None] = mapped_column(Text)
    val_accuracy: Mapped[float | None] = mapped_column(Float)
    val_top3: Mapped[float | None] = mapped_column(Float)
    val_clips: Mapped[int | None] = mapped_column(Integer)
    train_seconds: Mapped[float | None] = mapped_column(Float)
    sources: Mapped[dict | None] = mapped_column(JSONB)
    bytes: Mapped[int | None] = mapped_column(BigInteger)
    # ตัวชี้วัด {"validation": ตอนเทรน, "test": Run Test} (train.py/evaluate.py เพิ่มคอลัมน์นี้เองถ้ายังไม่มี)
    metrics: Mapped[dict | None] = mapped_column(JSONB)


# ตั้งค่าของระบบแบบ key → JSON (เช่น test_split) ตารางสร้างโดย app/db/schema.py
class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# คำที่โมเดลแต่ละเวอร์ชันรู้จัก + ผลรายคำ
class ModelWord(Base):
    __tablename__ = "model_words"

    model_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("models.id", ondelete="CASCADE"), primary_key=True)
    word_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("words.id", ondelete="CASCADE"), primary_key=True)
    train_clips: Mapped[int | None] = mapped_column(Integer)
    val_accuracy: Mapped[float | None] = mapped_column(Float)


# ประวัติการสั่งเทรน
class TrainingRun(Base):
    __tablename__ = "training_runs"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    started_by: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id", ondelete="SET NULL"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(Text, default="running")  # running | succeeded | failed
    return_code: Mapped[int | None] = mapped_column(Integer)
    log_path: Mapped[str | None] = mapped_column(Text)
    model_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("models.id", ondelete="SET NULL"))
    # เขียนโดย ml/src/train.py ระหว่างเทรน: log ท้าย ๆ, ความคืบหน้า (ขั้น/รอบ/loss/ความแม่นยำ),
    # เวลาที่รายงานล่าสุด (ไว้ดูว่ายังรันอยู่ไหม), ชื่อเครื่องที่เทรน และข้อผิดพลาด
    log: Mapped[str | None] = mapped_column(Text)
    progress: Mapped[dict | None] = mapped_column(JSONB)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    host: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)


# ท่าอวตาร Text->Sign (คำละ 1 ท่า)
class Motion(Base):
    __tablename__ = "motions"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    word_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("words.id", ondelete="CASCADE"), unique=True)
    duration_ms: Mapped[int] = mapped_column(Integer)
    frames: Mapped[list] = mapped_column(JSONB)
    face: Mapped[list | None] = mapped_column(JSONB)
    source: Mapped[str] = mapped_column(Text, default="handmade")  # handmade | extracted
    source_dataset: Mapped[str | None] = mapped_column(Text)
    source_contributor: Mapped[str | None] = mapped_column(Text)
    source_clip: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
