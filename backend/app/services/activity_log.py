# บันทึกและค้นหา log การใช้งาน (กดปุ่ม เปิดหน้า เรียก API) ใช้ในหน้าแอดมิน → บันทึกการใช้งาน

from datetime import datetime, timedelta

from sqlalchemy import delete, func, or_, select

from app.db.models import ActivityLog, User
from app.db.session import SessionLocal

# เก็บ log ย้อนหลังกี่วัน
KEEP_DAYS = 180
# ประเภทของ log: กดปุ่มบนหน้าเว็บ / เรียกฟังก์ชันที่ backend / เปิดหน้า
KINDS = ("ปุ่ม", "ฟังก์ชัน", "เปิดหน้า")
# ผู้ทำ: ตามบทบาทของคนที่ล็อกอิน (ไม่ได้ล็อกอิน = ดูจากพื้นที่ที่ใช้งาน)
ACTORS = ("แอดมิน", "ล่าม", "ผู้ใช้")
ROLE_ACTORS = {"admin": "แอดมิน", "contributor": "ล่าม", "user": "ผู้ใช้"}
# คอลัมน์ที่ส่งให้หน้าเว็บ / CSV (ไม่ส่ง IP และรหัสเครื่องออกไป: เก็บไว้ใน database เพื่อตรวจสอบความปลอดภัยเท่านั้น)
COLUMNS = ("ts", "actor", "kind", "action", "detail", "page", "method", "path", "status")


# หาผู้ทำ: ล็อกอินอยู่ = ตามบทบาท / ไม่ได้ล็อกอิน = ผู้ใช้ทั่วไป (path เก็บไว้ในพารามิเตอร์เพื่อให้เรียกแบบเดิมได้)
def actor_for(path: str, user: dict | None = None) -> str:
    # ไม่ได้ล็อกอิน = ผู้ใช้ทั่วไปเสมอ (ไม่เดาจากหน้า/path เพราะหน้าเว็บส่งค่าอะไรมาก็ได้ ปลอมเป็นแอดมินได้)
    if user:
        return ROLE_ACTORS.get(user["role"], "ผู้ใช้")
    return "ผู้ใช้"


# เวลาจากหน้าเว็บ/ตัวกรองไม่มี timezone ถือเป็นเวลาท้องถิ่นของเซิร์ฟเวอร์ (database เก็บแบบมี timezone)
def _local(value: datetime) -> datetime:
    return value.astimezone()


# ตัดข้อความให้ไม่เกินความยาวที่กำหนด (ว่าง = None)
def _clip(value, n: int):
    if value is None:
        return None
    text = str(value).strip()
    return text[:n] or None


# บันทึก log หนึ่งรายการ (เวลาปัจจุบันถ้าไม่ระบุ; ts เป็นข้อความ ISO เวลาท้องถิ่น)
def add(*, actor: str, kind: str, action: str, detail=None, page=None, method=None, path=None,
        status=None, device=None, ip=None, ts: str | None = None, user_id: str | None = None) -> None:
    row = ActivityLog(
        ts=_local(datetime.fromisoformat(ts) if ts else datetime.now().replace(microsecond=0)),
        user_id=user_id,
        actor=actor if actor in ACTORS else "ผู้ใช้",
        kind=kind if kind in KINDS else "ปุ่ม",
        action=_clip(action, 120) or "-",
        detail=_clip(detail, 200),
        page=_clip(page, 120),
        method=_clip(method, 10),
        path=_clip(path, 200),
        status=status,
        device=_clip(device, 40),
        ip=_clip(ip, 64),
    )
    with SessionLocal() as db:
        db.add(row)
        db.commit()


# แปลงแถวเป็น dict สำหรับหน้าเว็บ (ts เป็นข้อความเหมือนเดิม + ชื่อผู้ใช้ถ้าล็อกอิน)
def _to_dict(log: ActivityLog, user_name: str | None) -> dict:
    data = {c: getattr(log, c) for c in COLUMNS}
    data["id"] = log.id
    # ส่งเป็นเวลาท้องถิ่นไม่มี timezone รูปแบบเดียวกับ log เดิม (หน้าเว็บตัดวันที่/เวลาจากข้อความ)
    data["ts"] = log.ts.astimezone().replace(tzinfo=None).isoformat(timespec="seconds")
    data["user_id"] = log.user_id
    data["user_name"] = user_name or None
    return data


# อ่านเวลาจากตัวกรอง (รูปแบบผิด = ไม่กรอง)
def _parse_ts(value: str | None) -> datetime | None:
    try:
        return _local(datetime.fromisoformat(value)) if value else None
    except ValueError:
        return None


# ค้นหา log ตามตัวกรอง คืน (รายการเรียงจากใหม่ไปเก่า, จำนวนทั้งหมดที่ตรงตัวกรอง)
#   hide_pages = ไม่เอา log "เปิดหน้า" (มีเยอะมาก บังการกระทำที่สำคัญ) / failed = เฉพาะที่ไม่สำเร็จ
def query(actor=None, kind=None, q=None, date_from=None, date_to=None, limit=50, offset=0, hide_pages=False, failed=False):
    where = []
    if actor:
        where.append(ActivityLog.actor == actor)
    if kind:
        where.append(ActivityLog.kind == kind)
    elif hide_pages:
        where.append(ActivityLog.kind != "เปิดหน้า")
    if failed:
        where.append(ActivityLog.status >= 400)
    if q:
        like = f"%{q}%"
        cols = (ActivityLog.action, ActivityLog.detail, ActivityLog.page, User.first_name, User.last_name, User.email)
        where.append(or_(*(c.ilike(like) for c in cols)))
    if start := _parse_ts(date_from):
        where.append(ActivityLog.ts >= start)
    if end := _parse_ts(date_to):
        where.append(ActivityLog.ts < end)

    base = select(ActivityLog, func.concat_ws(" ", User.first_name, User.last_name)).outerjoin(User, User.id == ActivityLog.user_id).where(*where)
    with SessionLocal() as db:
        total = db.scalar(select(func.count()).select_from(base.subquery()))
        rows = db.execute(
            base.order_by(ActivityLog.ts.desc(), ActivityLog.id.desc()).limit(limit).offset(offset)
        ).all()
    return [_to_dict(log, name) for log, name in rows], total


# นับจำนวน log ของวันนี้แยกตามผู้ทำ (แสดงสรุปบนหน้า Log)
def today_counts() -> dict[str, int]:
    start = _local(datetime.now().replace(hour=0, minute=0, second=0, microsecond=0))
    with SessionLocal() as db:
        rows = db.execute(
            select(ActivityLog.actor, func.count()).where(ActivityLog.ts >= start).group_by(ActivityLog.actor)
        ).all()
    return {a: n for a, n in rows}


# สรุปของวันนี้สำหรับหน้า Log: จำนวนที่ไม่สำเร็จ และจำนวนผู้ใช้ (ที่ล็อกอิน) ที่ใช้งาน
def today_summary() -> dict[str, int]:
    start = _local(datetime.now().replace(hour=0, minute=0, second=0, microsecond=0))
    with SessionLocal() as db:
        failed = db.scalar(select(func.count()).where(ActivityLog.ts >= start, ActivityLog.status >= 400)) or 0
        users = db.scalar(select(func.count(func.distinct(ActivityLog.user_id))).where(ActivityLog.ts >= start)) or 0
    return {"failed": failed, "users": users}


# ลบ log ที่เก่ากว่า KEEP_DAYS วัน
def prune(days: int = KEEP_DAYS) -> None:
    cutoff = _local(datetime.now()) - timedelta(days=days)
    with SessionLocal() as db:
        db.execute(delete(ActivityLog).where(ActivityLog.ts < cutoff))
        db.commit()
