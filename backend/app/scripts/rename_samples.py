"""ย้ายชื่อคลิปที่อัปไว้แล้วจากรูปแบบเก่า (20261001-143000-a1b2c3) เป็น W####_S###_C###

วิธีใช้ (ในโฟลเดอร์ backend):
  python -m app.scripts.rename_samples            # ซ้อม: แสดงแผนอย่างเดียว ไม่แก้อะไร + เขียน rename_plan.csv
  python -m app.scripts.rename_samples --apply    # ทำจริง (ย้ายไฟล์ใน Storage + แก้ตาราง samples ทีละคลิป)

ก่อนทำจริง: แจ้งเพื่อนในทีม (ใช้ฐานข้อมูล/Storage ร่วมกัน) และห้ามมีใครอัด/ลบคลิประหว่างรัน
ทำซ้ำได้อย่างปลอดภัย: คลิปที่ย้ายแล้วจะถูกข้าม, ไฟล์ที่ย้ายไปแล้วแต่ตารางยังไม่แก้จะถูกแก้ต่อให้
แตะเฉพาะคลิป source = record/upload ที่ชื่อเป็นแบบเก่า (คลิป TSL ที่นำเข้ามาไม่ถูกแตะ)
"""
import csv
import sys

from sqlalchemy import select

from app.db.models import Sample
from app.db.session import SessionLocal
from app.services import dataset_service as ds
from app.services import storage

LEGACY_RE = __import__("re").compile(f"^{ds.SAMPLE_ID_LEGACY}$")


# วางแผนชื่อใหม่ (ฟังก์ชันล้วน ไม่แตะฐานข้อมูล ทดสอบง่าย)
#   rows: [(id, word_id, contributor_id, created_at)] ของคลิปที่ยังใช้ชื่อเก่า  (เรียงตามเวลาอัดจะได้ C001 = คลิปแรก)
#   taken: รหัสที่มีอยู่แล้วทั้งหมดในตาราง (ใช้เริ่มนับต่อจากเลขสูงสุด ไม่ชน)
def plan_names(rows: list[tuple], taken: set[str]) -> list[tuple[str, str]]:
    counters: dict[tuple, int] = {}
    for tid in taken:
        m = ds.SAMPLE_ID_NEW_RE.match(tid)
        if m:
            k = (int(m[1]), int(m[2]))
            counters[k] = max(counters.get(k, 0), int(m[3]))
    plan = []
    for sid, word_id, contributor_id, _created in sorted(rows, key=lambda r: (str(r[3]), r[0])):
        key = (word_id, contributor_id or ds.UNKNOWN_SIGNER)
        counters[key] = counters.get(key, 0) + 1
        new = ds.make_sample_id(word_id, contributor_id, counters[key])
        assert new not in taken, f"รหัสชน {new}"
        taken.add(new)
        plan.append((sid, new))
    return plan


def main(apply: bool) -> None:
    with SessionLocal() as db:
        all_ids = set(db.scalars(select(Sample.id)).all())
        rows = [
            (s.id, s.word_id, s.contributor_id, s.created_at)
            for s in db.scalars(select(Sample).where(Sample.source.in_(["record", "upload"]))).all()
            if LEGACY_RE.match(s.id)
        ]
    plan = plan_names(rows, set(all_ids))
    by_old = {r[0]: r for r in rows}
    with open("rename_plan.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f); w.writerow(["old_id", "new_id", "old_file_path", "new_file_path"])
        for old, new in plan:
            wid = by_old[old][1]
            w.writerow([old, new, ds.storage_path(wid, old), ds.storage_path(wid, new)])
    print(f"คลิปที่ต้องเปลี่ยนชื่อ {len(plan)} คลิป (ทั้งหมดในตาราง {len(all_ids)}) — เขียนแผนไว้ที่ rename_plan.csv")
    for old, new in plan[:10]:
        print(f"  {old}  ->  {new}")
    if not apply:
        print("นี่คือโหมดซ้อม ยังไม่ได้แก้อะไร ถ้าแผนถูกต้องให้รันซ้ำพร้อม --apply")
        return

    done = failed = 0
    for old, new in plan:
        wid = by_old[old][1]
        src, dst = ds.storage_path(wid, old), ds.storage_path(wid, new)
        vsrc, vdst = ds.video_path(wid, old), ds.video_path(wid, new)
        moved = []
        try:
            if storage.move(src, dst):
                moved.append((src, dst))
            elif storage.download(dst) is None:
                raise RuntimeError(f"ไม่พบไฟล์ skeleton ทั้งต้นทางและปลายทาง ({src})")
            if storage.move(vsrc, vdst):
                moved.append((vsrc, vdst))
            with SessionLocal() as db:
                s = db.get(Sample, old)
                s.id, s.file_path = new, dst   # primary key เปลี่ยนด้วย UPDATE เดียว (ไม่มีตารางอื่นอ้าง samples.id)
                db.commit()
            done += 1
        except Exception as e:  # ย้ายไฟล์กลับ ไม่ให้ไฟล์กับตารางไม่ตรงกัน
            for a, b in reversed(moved):
                try:
                    storage.move(b, a)
                except Exception:
                    pass
            failed += 1
            print(f"  ✗ {old}: {e}")
    print(f"เสร็จ: เปลี่ยนสำเร็จ {done} / ล้มเหลว {failed} (ล้มเหลวรันซ้ำได้)")


if __name__ == "__main__":
    main("--apply" in sys.argv)
