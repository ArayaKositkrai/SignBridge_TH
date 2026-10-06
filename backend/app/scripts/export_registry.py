"""ส่งออกทะเบียนรหัสคำ/ผู้แสดงจากฐานข้อมูล ให้โน้ตบุ๊กใช้รหัส W/S ตรงกับเว็บ

วิธีใช้ (ในโฟลเดอร์ backend):  python -m app.scripts.export_registry
ได้ words.csv (id,word) และ contributors.csv (id,name) — เอาไปวางในโฟลเดอร์ registry/ ข้างโน้ตบุ๊ก
ไม่มีข้อมูลส่วนตัวนอกจากชื่อที่ผู้แสดงกรอกเอง (ตรวจดูก่อนแชร์)
"""
import csv

from sqlalchemy import select

from app.db.models import Contributor, Word
from app.db.session import SessionLocal

if __name__ == "__main__":
    with SessionLocal() as db:
        for fn, cols, q in [
            ("words.csv", ["id", "word"], select(Word.id, Word.word).order_by(Word.id)),
            ("contributors.csv", ["id", "name"], select(Contributor.id, Contributor.name).order_by(Contributor.id)),
        ]:
            rows = db.execute(q).all()
            with open(fn, "w", newline="", encoding="utf-8-sig") as f:
                w = csv.writer(f); w.writerow(cols); w.writerows(rows)
            print(f"เขียน {fn}: {len(rows)} แถว")
