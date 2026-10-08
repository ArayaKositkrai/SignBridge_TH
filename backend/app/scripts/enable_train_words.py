"""เปิดคำจากชุดข้อมูลภายนอก (เช่น THSL) ให้เว็บนำไปเทรน

เว็บเทรนเฉพาะคำที่ words.in_train_set = true และชื่อคำต้องตรงกับป้ายชื่อคลิปใน tsl_skeleton.npz เป๊ะ ๆ
สคริปต์นี้อ่านป้ายชื่อจาก Storage (v1/labels/web_clips.csv ที่โน้ตบุ๊กอัปไว้) แล้ว
  - เพิ่มคำที่ยังไม่มีในตาราง words
  - ตั้ง in_train_set = true ให้คำเหล่านั้น (ไม่แตะคำอื่น และไม่ปิดคำที่เปิดอยู่)

วิธีใช้ (ในโฟลเดอร์ backend):
  python -m app.scripts.enable_train_words                  # ซ้อม: แสดงสิ่งที่จะเปลี่ยน ไม่แก้อะไร
  python -m app.scripts.enable_train_words --apply          # ทำจริง
  python -m app.scripts.enable_train_words --source THSL --version v1 --apply
  python -m app.scripts.enable_train_words --source ALL --min-clips 10 --apply   # ทุกชุดข้อมูล เฉพาะคำที่มีคลิปตั้งแต่ 10
  python -m app.scripts.enable_train_words --words สวัสดี แม่ --apply   # ระบุคำเอง (ไม่อ่านจาก Storage)
ตารางนี้ใช้ร่วมกับเพื่อนในทีม จึงควรซ้อมก่อนเสมอ
"""
import argparse
import csv
import io

from sqlalchemy import select

from app.db.models import Word
from app.db.session import SessionLocal
from app.services import storage


# อ่านรายชื่อคำของชุดข้อมูล (source) จาก labels/web_clips.csv ใน Storage
# source = "ALL" -> ทุกชุดข้อมูล (TSL-51, TSL-ONE-S, THSL, ล่าม ...); min_clips = เอาเฉพาะคำที่มีคลิปอย่างน้อยเท่านี้
def words_from_storage(version: str, source: str, min_clips: int = 1) -> list[str]:
    raw = storage.download(f"{version}/labels/web_clips.csv")
    if raw is None:
        raise SystemExit(f"ไม่พบ {version}/labels/web_clips.csv ใน Storage — รันโน้ตบุ๊กส่วน 6 แล้วอัปก่อน")
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    count: dict[str, int] = {}
    for r in rows:
        w = r["label"].strip()
        if w and (source == "ALL" or r["source"] == source):
            count[w] = count.get(w, 0) + 1
    return sorted(w for w, n in count.items() if n >= min_clips)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default="THSL")
    ap.add_argument("--version", default="v1")
    ap.add_argument("--exclude", nargs="*", default=["ไม่ทำท่า"], help="คำที่ไม่เอา (ค่าเริ่มต้น: ไม่ทำท่า = คลาสท่านิ่ง ไม่ใช่คำศัพท์)")
    ap.add_argument("--min-clips", type=int, default=1, help="เอาเฉพาะคำที่มีคลิปอย่างน้อยเท่านี้ (ใช้กับอ่านจาก Storage)")
    ap.add_argument("--words", nargs="*", help="ระบุคำเอง แทนการอ่านจาก Storage")
    ap.add_argument("--apply", action="store_true", help="ทำจริง (ไม่ใส่ = ซ้อม)")
    args = ap.parse_args()

    words = sorted({w.strip() for w in args.words if w.strip()}) if args.words else words_from_storage(args.version, args.source, args.min_clips)
    words = [w for w in words if w not in set(args.exclude)]
    if not words:
        raise SystemExit("ไม่พบคำ")
    with SessionLocal() as db:
        have = {w.word: w for w in db.scalars(select(Word).where(Word.word.in_(words)))}
        new = [w for w in words if w not in have]
        turn_on = [w for w in words if w in have and not have[w].in_train_set]
        already = [w for w in words if w in have and have[w].in_train_set]
        print(f"คำทั้งหมด {len(words)}: เพิ่มใหม่ {len(new)} | เปิดเทรน {len(turn_on)} | เปิดอยู่แล้ว {len(already)}")
        for label, items in (("เพิ่มใหม่", new), ("เปิดเทรน", turn_on), ("เปิดอยู่แล้ว", already)):
            if items:
                print(f"  {label}: {', '.join(items)}")
        if not args.apply:
            print("นี่คือโหมดซ้อม ยังไม่ได้แก้อะไร ถ้าถูกต้องให้รันซ้ำพร้อม --apply")
            return
        for w in new:
            db.add(Word(word=w, in_train_set=True))
        for w in turn_on:
            have[w].in_train_set = True
        db.commit()
        print("เรียบร้อย")


if __name__ == "__main__":
    main()
