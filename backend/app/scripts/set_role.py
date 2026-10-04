import sys

from sqlalchemy import func, select

from app.db.models import User
from app.db.session import SessionLocal

# ตั้งบทบาทผู้ใช้จากอีเมล ใช้ตั้งแอดมินคนแรก
# วิธีใช้ (ในโฟลเดอร์ backend): python -m app.scripts.set_role you@example.com admin
if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[2] not in ("admin", "contributor", "user"):
        sys.exit("วิธีใช้: python -m app.scripts.set_role <อีเมล> <admin|contributor|user>")
    email, role = sys.argv[1].strip().lower(), sys.argv[2]
    with SessionLocal() as db:
        user = db.scalar(select(User).where(func.lower(User.email) == email))
        if user is None:
            sys.exit(f"ไม่พบผู้ใช้อีเมล {email} (ต้องสมัครที่หน้าเว็บก่อน)")
        user.role = role
        db.commit()
        print(f"ตั้ง {email} เป็น {role} แล้ว")
