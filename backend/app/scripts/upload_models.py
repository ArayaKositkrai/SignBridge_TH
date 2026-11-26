# สคริปต์อัปไฟล์โมเดลในเครื่องขึ้น Supabase Storage

import sys

from sqlalchemy import select

from app.core.config import MODELS_DIR
from app.db.models import Model
from app.db.session import SessionLocal
from app.services import model_store

# อัปไฟล์โมเดลในเครื่องนี้ (ml/models) ขึ้น Supabase Storage ให้ backend เครื่องอื่นดาวน์โหลดไปใช้ได้
# อัปเฉพาะโมเดลที่ลงทะเบียนในตาราง models แล้ว และยังไม่มีใน Storage (รันซ้ำได้)
# วิธีใช้ (ในโฟลเดอร์ backend): python -m app.scripts.upload_models
if __name__ == "__main__":
    with SessionLocal() as db:
        registered = {m.file: m.version for m in db.scalars(select(Model))}
    remote = model_store.remote_files()
    local = sorted(p.name for p in MODELS_DIR.glob("*.npz")) if MODELS_DIR.is_dir() else []

    uploaded, skipped = [], []
    for file in local:
        if file not in registered:
            skipped.append(f"{file} (ไม่มีในตาราง models)")
        elif file in remote:
            skipped.append(f"{file} (มีใน Storage แล้ว)")
        else:
            model_store.upload(file)
            uploaded.append(f"{registered[file]} ({file})")
            print(f"  อัปแล้ว: {registered[file]} ({file})")

    missing = sorted(set(registered) - set(local) - remote)
    print(f"อัปขึ้น Storage {len(uploaded)} ไฟล์ · ข้าม {len(skipped)} ไฟล์")
    for s in skipped:
        print(f"  ข้าม: {s}")
    if missing:
        print(f"ยังไม่มีไฟล์ทั้งในเครื่องนี้และใน Storage {len(missing)} เวอร์ชัน (ต้องรันคำสั่งนี้บนเครื่องที่เทรน):")
        for f in missing:
            print(f"  - {registered[f]} ({f})")
    sys.exit(0)
