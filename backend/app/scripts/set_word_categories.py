"""เติมหมวด (words.category) จากไฟล์ CSV ที่ส่งออกจากโน้ตบุ๊ก (คอลัมน์ "คำ" และ "หมวด")

- อัปเดตเฉพาะคอลัมน์ category ของคำที่มีอยู่ในตาราง words แล้ว (ไม่เพิ่มคำใหม่ ไม่แตะ in_train_set / gloss / โมเดล)
- ค่าเริ่มต้นเติมเฉพาะคำที่ category ยังว่าง ถ้าอยากทับค่าเดิมให้ใส่ --overwrite

วิธีใช้ (วางไฟล์ไว้ในโฟลเดอร์ ml ของโปรเจกต์ แล้วรันที่โฟลเดอร์โปรเจกต์):
  docker compose exec backend python -m app.scripts.set_word_categories /ml/word_categories.csv           # ซ้อม
  docker compose exec backend python -m app.scripts.set_word_categories /ml/word_categories.csv --apply   # ทำจริง
ตารางนี้ใช้ร่วมกับเพื่อนในทีม จึงควรซ้อมก่อนเสมอ
"""
import argparse
import csv
from collections import Counter

from sqlalchemy import select

from app.db.models import Word
from app.db.session import SessionLocal


# อ่านไฟล์เป็น {คำ: หมวด} (คำซ้ำใช้ค่าแรก)
def read_categories(path: str) -> dict[str, str]:
    out: dict[str, str] = {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows or "คำ" not in rows[0] or "หมวด" not in rows[0]:
        raise SystemExit('ไฟล์ต้องมีคอลัมน์ "คำ" และ "หมวด"')
    for r in rows:
        word, cat = (r["คำ"] or "").strip(), (r["หมวด"] or "").strip()
        if word and cat and cat.lower() != "nan":
            out.setdefault(word, cat)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", help="ไฟล์ CSV (คอลัมน์ คำ, หมวด)")
    ap.add_argument("--apply", action="store_true", help="ทำจริง (ถ้าไม่ใส่ = ซ้อม)")
    ap.add_argument("--overwrite", action="store_true", help="ทับหมวดเดิมที่มีค่าอยู่แล้วด้วย")
    args = ap.parse_args()

    cats = read_categories(args.csv)
    with SessionLocal() as db:
        words = {w.word: w for w in db.scalars(select(Word))}
        todo = {w: c for w, c in cats.items() if w in words and (args.overwrite or not words[w].category)}
        keep = [w for w in cats if w in words and w not in todo]
        missing = [w for w in cats if w not in words]
        no_cat = [w for w in words if w not in cats]
        print(f"ในไฟล์ {len(cats)} คำ | จะเติม {len(todo)} | มีหมวดอยู่แล้วข้าม {len(keep)} | "
              f"ไม่มีในตาราง words {len(missing)} | คำในตารางที่ไม่มีหมวดในไฟล์ {len(no_cat)}")
        for cat, n in Counter(todo.values()).most_common():
            print(f"  {cat}: {n} คำ")
        if no_cat:
            print(f"  คำที่ยังไม่มีหมวด: {', '.join(no_cat[:30])}{' ...' if len(no_cat) > 30 else ''}")
        if not args.apply:
            print("นี่คือโหมดซ้อม ยังไม่ได้แก้อะไร ถ้าถูกต้องให้รันซ้ำพร้อม --apply")
            return
        for w, c in todo.items():
            words[w].category = c
        db.commit()
        print("เรียบร้อย")


if __name__ == "__main__":
    main()
