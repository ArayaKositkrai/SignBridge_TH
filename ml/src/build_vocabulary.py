"""สร้างคลังคำศัพท์ของระบบ (ml/configs/vocabulary.json) จากไฟล์ของทีม

ใช้:
    pip install openpyxl
    python build_vocabulary.py --tracker <SignBridge_TH_vocab_tracker.xlsx> --merged <tsl_merged_dataset.zip>

รวม 2 แหล่ง:
- ชีต "คำที่ต้องเก็บเอง" ใน tracker = คำที่ล่ามต้องอัดเอง (มีหมวด ระดับความสำคัญ ผู้รับผิดชอบ หมายเหตุ)
- tsl_merged_meta_th.csv ใน zip = คำจากชุดข้อมูล TSL-51 / TSL-ONE-S พร้อมจำนวนคลิปและผู้แสดงที่มีอยู่แล้ว
"""
import argparse
import csv
import io
import json
import zipfile
from collections import defaultdict
from pathlib import Path

# ไฟล์ผลลัพธ์ (อ้างจากตำแหน่งสคริปต์)
OUT_PATH = Path(__file__).resolve().parents[1] / "configs" / "vocabulary.json"
# ชื่อชีตคำที่ต้องอัดเอง
SELF_SHEET = "คำที่ต้องเก็บเอง"
# หมวดของคลาส "ไม่มีท่า" ที่ไม่นับเป็นคำ
NULL_CATEGORY = "ไม่มีท่า"
# ลำดับความสำคัญ (ใช้เรียง)
PRIORITY_ORDER = {"สูง": 0, "กลาง": 1, "ต่ำ": 2}


# อ่านคำที่ต้องอัดเองจากชีตใน tracker (หัวตารางอยู่แถวที่มีคำว่า "ลำดับ")
def read_self_words(tracker: Path) -> list[dict]:
    import openpyxl

    ws = openpyxl.load_workbook(tracker, data_only=True)[SELF_SHEET]
    rows = list(ws.iter_rows(values_only=True))
    start = next(i for i, r in enumerate(rows) if r and r[0] == "ลำดับ") + 1
    words = []
    for r in rows[start:]:
        if not r or not r[2]:
            continue
        _, category, word, priority, assigned, _status, note = (list(r) + [None] * 7)[:7]
        words.append(
            {
                "word": str(word).strip(),
                "category": category,
                "priority": priority,
                "assigned": assigned,
                "note": note,
            }
        )
    return words


# อ่านคำจากชุดข้อมูล TSL ที่รวมไว้ พร้อมนับคลิปและผู้แสดงต่อคำ
def read_dataset_words(merged_zip: Path) -> dict[str, dict]:
    with zipfile.ZipFile(merged_zip) as z:
        text = z.read("tsl_merged_meta_th.csv").decode("utf-8-sig")
    clips: dict[tuple, int] = defaultdict(int)
    signers: dict[tuple, set] = defaultdict(set)
    category: dict[str, str] = {}
    for row in csv.DictReader(io.StringIO(text)):
        if row["is_null_class"] == "True" or row["หมวด"] == NULL_CATEGORY:
            continue
        # ใช้ชื่อคำแบบไม่มีวงเล็บแบบท่า (word_th) ให้ตรงกับชื่อคลาสของโมเดล
        key = ((row["word_th"] or row["คำ"]).strip(), row["ชุดข้อมูล"])
        clips[key] += 1
        signers[key].add(row["signer_id"])
        category.setdefault(key[0], row["หมวด"])
    words: dict[str, dict] = {}
    for (word, source), n in clips.items():
        entry = words.setdefault(word, {"category": category[word], "external": {}})
        entry["external"][source] = {"clips": n, "signers": len(signers[(word, source)])}
    return words


# รวมสองแหล่งเป็นรายการเดียว: คำที่ต้องอัดเองขึ้นก่อน (เรียงตามความสำคัญ) ตามด้วยคำจากชุดข้อมูล
def build(tracker: Path, merged_zip: Path) -> list[dict]:
    dataset = read_dataset_words(merged_zip)
    items = []
    seen = set()
    self_words = sorted(read_self_words(tracker), key=lambda w: PRIORITY_ORDER.get(w["priority"], 9))
    for w in self_words:
        ext = dataset.get(w["word"], {}).get("external", {})
        items.append({**w, "to_record": True, "external": ext})
        seen.add(w["word"])
    for word, d in sorted(dataset.items(), key=lambda kv: (kv[1]["category"], kv[0])):
        if word in seen:
            continue
        items.append(
            {
                "word": word,
                "category": d["category"],
                "priority": None,
                "assigned": None,
                "note": None,
                "to_record": False,
                "external": d["external"],
            }
        )
    return items


# รับพาธไฟล์จาก command line แล้วเขียน vocabulary.json
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tracker", type=Path, required=True)
    ap.add_argument("--merged", type=Path, required=True)
    args = ap.parse_args()
    items = build(args.tracker, args.merged)
    OUT_PATH.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"เขียน {len(items)} คำ ({sum(i['to_record'] for i in items)} คำที่ต้องอัดเอง) -> {OUT_PATH}")


if __name__ == "__main__":
    main()
