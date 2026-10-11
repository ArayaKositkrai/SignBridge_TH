# คู่มืออัปโหลดข้อมูลใหม่ (เริ่มต้นใหม่ทั้งหมด)

อัปเดต 2026-10-11 · ตอนนี้ database เหลือแค่ `users` / `user_identities` และ Supabase Storage ว่างทั้งหมด

ลำดับงาน:

```
1. อัปชุดข้อมูล TSL ขึ้น Storage (v1/)          ← จากโน้ตบุ๊ก/Colab
2. สร้างไฟล์สำหรับเทรน (datasets/)               ← import_tsl_storage.py --upload
3. ใส่คลังคำ + เลือกคำที่จะเทรน                   ← หน้าแอดมิน หรือสคริปต์
4. เทรนโมเดล → เผยแพร่                           ← หน้าแอดมิน › โมเดล
5. สร้างท่าอวตาร (ข้อความ → ภาษามือ)              ← build_motions.py
```

---

## 0. เตรียมก่อนเริ่ม

ไฟล์ `.env` ที่รากโปรเจกต์ต้องมี (ขอจากเจ้าของโปรเจกต์ทางแชทส่วนตัว **ห้ามส่งในกลุ่ม ห้าม commit**):

```
DATABASE_URL=postgresql+psycopg://...
SUPABASE_SERVICE_ROLE_KEY=...
```

- `SUPABASE_URL` ไม่ต้องใส่ ระบบเดาจาก `DATABASE_URL` ให้เอง (รูปแบบ `https://<รหัสโปรเจกต์>.supabase.co`)
- bucket ชื่อ `signbridge-datasets` (แบบ private) มีอยู่แล้ว ไม่ต้องสร้าง

ลงแพ็กเกจ (ในเครื่องที่จะรันสคริปต์):

```bash
pip install -r backend/requirements.txt -r ml/requirements.txt pyarrow openpyxl
```

---

## 1. อัปชุดข้อมูล TSL ขึ้น Storage (โฟลเดอร์ `v1/`)

### ไฟล์ที่ต้องเตรียม

จัดไฟล์ไว้ในโฟลเดอร์ `out/` แบบนี้ (ชื่อไฟล์/โฟลเดอร์ใช้ **ภาษาอังกฤษเท่านั้น** Storage ไม่รับภาษาไทยในชื่อไฟล์):

```
out/
├── frames/
│   ├── part000.parquet      พิกัดทุกเฟรม (แบ่งเป็นหลายไฟล์ ไฟล์ละไม่เกิน 50 MB)
│   ├── part001.parquet
│   └── ...
└── labels/
    └── web_clips.csv        ป้ายชื่อของแต่ละคลิป
```

**`frames/*.parquet`** — หนึ่งแถว = หนึ่งเฟรม ต้องมีคอลัมน์:

| คอลัมน์ | ความหมาย |
|---|---|
| `sample_id` | รหัสคลิป (ตรงกับใน web_clips.csv) |
| `frame` | ลำดับเฟรม (0, 1, 2, …) |
| `l_shoulder_x`, `l_shoulder_y`, `r_shoulder_x`, … `r_wrist_y` | ไหล่ ศอก ข้อมือ ซ้าย/ขวา (12 คอลัมน์) |
| `lh_x0`, `lh_y0` … `lh_x20`, `lh_y20` | มือซ้าย 21 จุด (42 คอลัมน์) |
| `rh_x0`, `rh_y0` … `rh_x20`, `rh_y20` | มือขวา 21 จุด (42 คอลัมน์) |

- พิกัดเป็น x, y ในภาพ ค่า 0–1 จุดที่มองไม่เห็น = ว่าง (null)
- ซ้าย/ขวา = ข้างของ**คนทำท่า** (ไม่ใช่ข้างของภาพ)

**`labels/web_clips.csv`** — หนึ่งแถว = หนึ่งคลิป (UTF-8) ต้องมีคอลัมน์:

| คอลัมน์ | ความหมาย |
|---|---|
| `clip_id` | รหัสคลิป |
| `sample_id` | รหัสคลิปที่ใช้ใน parquet |
| `source` | ชื่อชุดข้อมูล เช่น `TSL-51`, `TSL-ONE-S`, `THSL` |
| `signer_id` | รหัสผู้แสดง (ใช้แบ่งชุดทดสอบตามคน — **สำคัญมาก** ห้ามว่าง) |
| `label` | คำ (ภาษาไทย ต้องตรงกับชื่อคำในคลังคำเป๊ะ ๆ) — คลิปที่ไม่ได้ทำท่าใช้ `ไม่ทำท่า` |
| `aspect` | (ไม่บังคับ) สัดส่วนภาพ กว้าง/สูง เช่น `1.777` ไม่ใส่ = ใช้ค่าประมาณตามชุดข้อมูล |

### อัปโหลด

ใช้โน้ตบุ๊กเดิมได้เลย หรือรันโค้ดนี้ใน Colab/เครื่อง (อัปทุกไฟล์ใน `out/` แล้วสร้าง `manifest.json` ที่มี SHA-256 ไว้ตรวจว่าไฟล์ไม่เสีย):

```python
import hashlib, json, os, pathlib, requests

SUPABASE_URL = "https://<รหัสโปรเจกต์>.supabase.co"
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]   # ใน Colab ใช้ Secrets อย่าพิมพ์ key ลงในโน้ตบุ๊ก
BUCKET, VERSION, SRC = "signbridge-datasets", "v1", pathlib.Path("out")
HEADERS = {"Authorization": f"Bearer {KEY}", "apikey": KEY}

def put(path: str, data: bytes, ctype: str) -> None:
    r = requests.post(f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}",
                      headers={**HEADERS, "Content-Type": ctype, "x-upsert": "true"}, data=data, timeout=300)
    r.raise_for_status()

files = []
for local in sorted(p for p in SRC.rglob("*") if p.is_file()):
    rel = local.relative_to(SRC).as_posix()
    data = local.read_bytes()
    assert len(data) < 50 * 1024 * 1024, f"{rel} ใหญ่เกิน 50 MB — แบ่งเป็นหลายไฟล์ก่อน"
    put(f"{VERSION}/{rel}", data, "text/csv" if rel.endswith(".csv") else "application/octet-stream")
    files.append({"path": f"{VERSION}/{rel}", "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
    print("อัปแล้ว", rel)

put(f"{VERSION}/manifest.json", json.dumps({"files": files}, ensure_ascii=False).encode(), "application/json")
print(f"เสร็จ {len(files)} ไฟล์ + manifest.json")
```

> แผนฟรีของ Supabase รับไฟล์ละไม่เกิน 50 MB — แบ่ง parquet เป็นหลายไฟล์ (เช่นไฟล์ละ ~40 MB)

---

## 2. สร้างไฟล์สำหรับเทรน (`datasets/`)

ที่รากโปรเจกต์:

```bash
python ml/src/import_tsl_storage.py --upload
```

- ดาวน์โหลด `v1/` → ตรวจ SHA-256 → รวมเป็น `ml/data/processed/tsl_skeleton.npz` ในเครื่อง
- `--upload` = อัปไฟล์ที่ได้ขึ้น `datasets/tsl_skeleton/` (แบ่งไฟล์ย่อยให้เอง) **ทำครั้งเดียว** แล้วเครื่องอื่นตอนเทรนจะดาวน์โหลดไปใช้เอง
- ถ้าขึ้นว่า SHA-256 ไม่ตรง = อัปไม่ครบหรือไฟล์เสีย → อัปขั้นที่ 1 ใหม่

---

## 3. ใส่คลังคำ และเลือกคำที่จะเทรน

**ใส่คลังคำ** (เลือกอย่างใดอย่างหนึ่ง):

- จากไฟล์ Excel ของทีม + ชุดข้อมูล:
  ```bash
  cd ml/src
  python build_vocabulary.py --tracker <SignBridge_TH_vocab_tracker.xlsx> --merged <tsl_merged_dataset.zip>
  ```
- จากคลังคำเดิมในโปรเจกต์ (`ml/configs/vocabulary.json` 259 คำ):
  ```bash
  cd backend
  python -m app.scripts.import_legacy_data
  ```

**เลือกคำที่จะเทรน** (เลือกอย่างใดอย่างหนึ่ง):

- ทุกคำที่มีในชุดข้อมูล (อ่านจาก `v1/labels/web_clips.csv` เพิ่มคำที่ยังไม่มีให้เอง):
  ```bash
  cd backend
  python -m app.scripts.enable_train_words --source ALL --min-clips 10          # ซ้อมดูก่อน ไม่แก้อะไร
  python -m app.scripts.enable_train_words --source ALL --min-clips 10 --apply  # ทำจริง
  ```
- หรือในเว็บ: **แอดมิน › คลังคำศัพท์ › เลือกเทรนทั้งหมด** (ใช้ร่วมกับตัวกรองได้)

---

## 4. เทรนโมเดล

1. **แอดมิน › โมเดล › แท็บชุดทดสอบ** — ไม่ต้องเลือกอะไรก็ได้ (ระบบสุ่มผู้แสดง ~20% ของแต่ละชุดข้อมูลให้)
   ถ้าเลือกเอง: เลือก**หลายคน จากทุกชุดข้อมูล** อย่าเลือกคนเดียว (ผลวัดจะเชื่อไม่ได้)
2. **แท็บการเทรน › เริ่มเทรน** (หรือรัน `cd ml/src && python train.py` บนเครื่องที่มี torch)
3. เทรนเสร็จได้เวอร์ชันใหม่เป็น **Draft** (ไฟล์โมเดลอัปขึ้น Storage `models/` ให้เอง)
4. ดู **ผลวัดโมเดล** (ทายถูก, F1, พูดผิดตอนไม่ทำท่า, คำที่สับสนกัน) → ถ้าดีกว่าตัวเดิม กด **เผยแพร่**

---

## 5. สร้างท่าอวตาร (ข้อความ → ภาษามือ)

หลังมีชุดข้อมูลแล้ว:

```bash
cd ml/src
python build_motions.py
```

สร้างท่าให้คำที่มีคลิป (คำที่อวตารใช้ + คำที่เทรน + คำที่ล่ามอัด) บันทึกลงตาราง `motions`

---

## คลิปที่ล่ามอัด

ล่ามอัดผ่านเว็บได้เลย (**พื้นที่ล่าม**) ไม่ต้องอัปเอง — ระบบเก็บ skeleton ไว้ที่ `raw_data/` และวิดีโอที่ `videos/` ใน Storage ให้เอง

---

## โครงสร้าง Storage หลังทำครบ

```
signbridge-datasets/
├── v1/                    ชุดข้อมูลดิบจากโน้ตบุ๊ก (ขั้นที่ 1)
│   ├── manifest.json
│   ├── frames/*.parquet
│   └── labels/web_clips.csv
├── datasets/tsl_skeleton/ ไฟล์สำหรับเทรน (ขั้นที่ 2: index.json + part*.npz)
├── models/                ไฟล์โมเดลแต่ละเวอร์ชัน (เทรนแล้วอัปเอง)
├── raw_data/{word_id}/    skeleton ของคลิปที่ล่ามอัด
└── videos/{word_id}/      วิดีโอของคลิปที่ล่ามอัด
```

## ปัญหาที่เจอบ่อย

| อาการ | วิธีแก้ |
|---|---|
| อัปแล้วได้ 400 / `Invalid key` | ชื่อไฟล์มีภาษาไทยหรืออักขระพิเศษ → ใช้ภาษาอังกฤษ |
| อัปแล้วได้ 413 | ไฟล์ใหญ่เกิน 50 MB → แบ่งไฟล์ |
| `manifest ไม่มี v1/labels/web_clips.csv` | ลืมอัป labels หรืออัป manifest ก่อนไฟล์อื่น → รันโค้ดขั้นที่ 1 ใหม่ |
| `ไม่มีข้อมูลสำหรับเทรน` | ยังไม่ได้เลือกคำไว้เทรน (ขั้นที่ 3) หรือ `label` ใน csv ไม่ตรงกับชื่อคำในคลัง |
| ผลวัด 0% หรือ 100% แปลก ๆ | ชุดทดสอบมีคนเดียว/คลิปน้อย → เลือกผู้แสดงในชุดทดสอบใหม่ (ขั้นที่ 4) |
