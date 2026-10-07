# SignBridge TH

ระบบช่วยสื่อสารสองทางระหว่างผู้ใช้ภาษามือไทยกับผู้ที่ไม่ใช้ภาษามือ

| หน้า | URL | ทำอะไร |
|---|---|---|
| ภาษามือ → ข้อความ | `/` | เปิดกล้อง จับท่าด้วย MediaPipe ส่งจุด skeleton ไปให้ backend ทายคำ แล้วต่อเป็นประโยค (อ่านออกเสียงได้) |
| ข้อความ → ภาษามือ | `/text-to-sign` | พิมพ์หรือพูด → ตัดคำ → ตัวละคร 3D ทำท่าทีละคำ |
| ปุ่มฉุกเฉิน (AAC) | `/emergency` | ปุ่มวลีสำเร็จรูป กดแล้วพูดออกเสียงทันที ผู้ที่ล็อกอินเพิ่มปุ่มของตัวเองได้ |
| พื้นที่ล่าม | `/contributor` | ล่ามอัดหรืออัปโหลดคลิป (วิดีโอ / .npy / .npz) เก็บเป็นข้อมูลเทรน |
| แอดมิน | `/admin` | ภาพรวมข้อมูล ผู้ใช้ เลือกคำที่จะเทรน ดูผลเทรน เผยแพร่โมเดล และ log การใช้งาน |

---

## ข้อมูลอยู่ที่ไหน

```
Supabase Postgres (database)     ตารางทั้งหมด: ผู้ใช้, คำศัพท์ (words), ข้อมูลคลิป (samples),
                                  เวอร์ชันโมเดล (models), ท่าอวตาร (motions), log ฯลฯ
Supabase Storage (ไฟล์)           ไฟล์ของคลิปที่ล่ามอัด: skeleton .npz + วิดีโอ  (ต้องใช้ SUPABASE_SERVICE_ROLE_KEY)
ml/data/processed/tsl_skeleton.npz   skeleton ของชุดข้อมูล TSL ทั้งหมด (ไฟล์ในเครื่อง ~100 MB ไม่อยู่ใน git)
ml/models/*.npz                      ไฟล์โมเดลที่เทรนแล้ว (backend อ่านจากโฟลเดอร์นี้)
```

- **ตาราง `words`** คือคลังคำทั้งหมด สร้างจาก Excel ของทีม + รายชื่อคำของ TSL ด้วย `ml/src/build_vocabulary.py`
- **คำที่โมเดลรู้จัก** = คำที่ติ๊ก "เทรน" ในหน้าแอดมิน (`words.in_train_set`)
- **คำที่อวตารทำท่าได้** = คำที่มีแถวในตาราง `motions` (สร้างด้วย `ml/src/build_motions.py`)
- ตัวเลข "คลิปที่อัด" ในหน้าเว็บนับเฉพาะคลิปที่ล่ามอัดผ่านระบบ ไม่นับคลิป TSL

---

## เริ่มใช้งาน

### 1. เตรียมไฟล์ `.env`

คัดลอก `.env.example` เป็น `.env` ที่รากโปรเจกต์ แล้วใส่ค่า (ห้าม commit `.env`)

| ตัวแปร | จำเป็น | หาค่าจากไหน |
|---|---|---|
| `DATABASE_URL` | ✓ | Supabase → Project Settings → Database → Connection string |
| `AUTH_SECRET` | ✓ | สุ่มเอง: `python -c "import secrets; print(secrets.token_urlsafe(48))"` (ไม่มี = backend ไม่ยอมเปิด) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ สำหรับคลิปของล่าม | Supabase → Project Settings → API Keys → service_role (ห้ามแชร์ เข้าถึงข้อมูลได้ทั้งหมด) |
| `ADMIN_EMAILS` | | อีเมล Google ที่ล็อกอินแล้วได้เป็นแอดมินอัตโนมัติ คั่นด้วยจุลภาค |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | | ล็อกอินด้วย Google (ดูคำอธิบายใน `.env.example`) |
| `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` | | ล็อกอินด้วย LINE |
| `PUBLIC_API_URL`, `CORS_ORIGINS`, `COOKIE_SECURE`, `TRUST_PROXY`, `SESSION_DAYS` | | ใช้ตอนขึ้นเซิร์ฟเวอร์จริง (ดู `.env.example`) |

### 2. รันด้วย Docker (แนะนำ)

```bash
docker compose up --build
```

- หน้าเว็บ: http://localhost:5173
- API: http://localhost:8000 (ตรวจสถานะ: http://localhost:8000/api/health)
- แก้โค้ดแล้วรีโหลดเองทั้งสองฝั่ง (โฟลเดอร์ `backend/app`, `frontend/`, `ml/` ถูก mount เข้า container)

### 3. รันแบบไม่ใช้ Docker

Backend (Python 3.11 ขึ้นไป):

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Frontend (Node 20):

```bash
cd frontend
npm install
npm run dev                       # http://localhost:5173
npm run build                     # ตรวจ type + build สำหรับขึ้นเซิร์ฟเวอร์
```

### 4. ตั้งแอดมินคนแรก

สมัครที่หน้าเว็บก่อน แล้วสั่ง (ในโฟลเดอร์ `backend`):

```bash
python -m app.scripts.set_role you@example.com admin      # หรือ contributor = ล่าม
```

---

## งานข้อมูลและโมเดล (โฟลเดอร์ `ml/`)

ติดตั้งครั้งแรก (ใช้ venv เดียวกับ backend ได้): `pip install -r ml/requirements.txt` (มี torch ขนาดหลายร้อย MB)

| ขั้น | ทำอย่างไร |
|---|---|
| 1. เตรียมชุด TSL | `python ml/src/import_tsl_storage.py` (ดึงจาก Storage) หรือ `python ml/src/import_tsl.py --frames ... --meta ...` (จากไฟล์ในเครื่อง) → ได้ `ml/data/processed/tsl_skeleton.npz` |
| 2. คลังคำ | `python ml/src/build_vocabulary.py --tracker <Excel ของทีม> --merged <tsl_merged_dataset.zip>` (ทำครั้งเดียว/เมื่อ Excel เปลี่ยน) |
| 3. เลือกคำและชุดทดสอบ | หน้าเว็บ **แอดมิน → คลังคำศัพท์** → เปิดสวิตช์คอลัมน์ "เทรน" · **แอดมิน → โมเดล → ชุดทดสอบ** เลือกผู้แสดงที่กันไว้วัดผล (ไม่เลือก = สุ่ม 20%) หรือสลับรายคลิปในแผงของคำ |
| 4. เทรน | `cd ml/src && python train.py` (~1 นาที) — ระหว่างเทรนดูความคืบหน้าได้ที่หน้าแอดมิน ผลที่ได้เป็นเวอร์ชัน **Draft** |
| 5. ทดสอบและเผยแพร่ | หน้าแอดมิน → โมเดล → "ลองใช้ Draft" → ถ้าดีกว่าตัวเดิมกด "เผยแพร่" ผู้ใช้ทั่วไปถึงจะได้ใช้ |
| 6. ท่าอวตาร | `python ml/src/build_motions.py` สร้างท่าของตัวละครจากคลิปจริง (ทำใหม่เมื่อมีคลิปเพิ่ม) |

ข้อควรรู้
- เทรนบนเครื่องเดียวกับที่รัน backend (ไฟล์โมเดลถูกเขียนลง `ml/models/` ซึ่ง backend อ่าน) ถ้าเทรนเครื่องอื่นต้องคัดลอกไฟล์ `.npz` ไปไว้ที่ `ml/models/` ก่อนเผยแพร่
- คลิปที่ล่ามอัดถูกใช้เทรนเมื่อคำนั้นมีอย่างน้อย 5 คลิป (`ml/configs/train_words.json`)
- เปลี่ยนวิธีคำนวณ feature (`FEATURE_VERSION` ใน `ml/src/features.py`) แล้วต้องเทรนใหม่ โมเดลเก่าจะถูก backend ปฏิเสธ

---

## ไฟล์ไหนทำอะไร

### backend/ (FastAPI)

| ไฟล์ | หน้าที่ |
|---|---|
| `app/main.py` | สร้างแอป ตั้ง CORS ลงทะเบียน route บันทึก log ทุกการเรียก API ที่แก้ข้อมูล |
| `app/api/deps.py` | อ่าน cookie session → ผู้ใช้ปัจจุบัน และตัวตรวจสิทธิ์ (`require_admin`, `require_staff`, `require_login`) |
| `app/api/routes/auth.py` | สมัคร/ล็อกอินด้วยอีเมล, Google, LINE และผูกบัญชี |
| `app/api/routes/sign_to_text.py` | WebSocket `/ws/sign-to-text` รับ skeleton ทีละเฟรม ตอบคำที่แปลได้ (ตรวจรูปแบบข้อมูลและจำกัดความถี่) |
| `app/api/routes/text_to_sign.py` | แปลข้อความเป็นรายการท่า และรายการคำที่อวตารทำได้ |
| `app/api/routes/emergency.py` | ปุ่ม AAC ของแต่ละผู้ใช้ |
| `app/api/routes/contributor.py` | งานของล่าม: บันทึก/ดู/ลบคลิป คลังคำศัพท์ |
| `app/api/routes/admin.py` | แดชบอร์ด ผู้ใช้ คลังคำ (ติ๊กคำเทรน) เวอร์ชันโมเดล สถานะการเทรน เผยแพร่ |
| `app/api/routes/logs.py` | รับ log การกดปุ่มจากหน้าเว็บ และให้แอดมินดู/ดาวน์โหลด CSV |
| `app/core/config.py` | อ่านค่าจาก `.env` และพาธต่าง ๆ |
| `app/core/cors.py` | โดเมนที่อนุญาตให้เรียก API |
| `app/core/rate_limit.py` | จำกัดจำนวนครั้ง (ล็อกอิน/สมัคร/ส่ง log) ต่อ IP |
| `app/db/models.py` | โครงตารางทั้งหมด (SQLAlchemy) |
| `app/db/session.py` | การเชื่อมต่อ database |
| `app/db/schema.py` | เพิ่มคอลัมน์ที่โค้ดใหม่ต้องใช้ตอนเปิดเซิร์ฟเวอร์ (คู่กับ `backend/sql/`) |
| `app/services/auth_service.py` | รหัสผ่าน (scrypt) session (JWT) OAuth |
| `app/services/user_service.py` | จัดการผู้ใช้ + ตรวจรูปแบบเบอร์โทร/เลขบัตรคนพิการ |
| `app/services/card_image.py` | รูปบัตรคนพิการ (Storage แบบ private ดูได้เฉพาะเจ้าของ/แอดมิน ผ่าน backend) |
| `app/services/test_split.py` | ชุดทดสอบโมเดล: ผู้แสดงที่แอดมินเลือก (ตาราง `app_settings`) และรายคลิป (`samples.split`) |
| `app/services/recognition_service.py` | ตัวแปลภาษามือ: ทายจากหลายความยาวหน้าต่าง (1.2/1.7/2.2 วิ) เฉลี่ยความมั่นใจ แล้วตัดสินว่า "ได้คำ" (ส่ง `word` ครั้งเดียวต่อคำ) |
| `app/services/retrieval_service.py` | หาท่าของแต่ละคำ (ข้อความ → ภาษามือ) |
| `app/services/motion_library.py` | อ่านท่าอวตารจากตาราง `motions` |
| `app/services/dataset_service.py` | คลิปของล่าม: แปลง skeleton ↔ ไฟล์ .npz, สถิติ, คลังคำ |
| `app/services/storage.py` | อัปโหลด/ดาวน์โหลดไฟล์ใน Supabase Storage |
| `app/services/model_registry.py` | เวอร์ชันโมเดล (active / draft / archived) |
| `app/services/emergency_service.py` | ปุ่ม AAC ในฐานข้อมูล |
| `app/services/activity_log.py` | บันทึก/ค้น log การใช้งาน (เก็บ IP/รหัสเครื่องไว้ตรวจความปลอดภัย แต่ไม่ส่งออกหน้าเว็บ/CSV) |
| `app/api/routes/profile.py` | หน้าโปรไฟล์: แก้ข้อมูลตัวเอง รูปบัตร รหัสผ่าน เลิกเชื่อมบัญชี ลบบัญชี |
| `app/ml/classifier.py`, `model_loader.py` | โหลดไฟล์โมเดล `.npz` และทายคำด้วย numpy (backend ไม่ต้องมี torch) |
| `app/nlp/tokenizer.py` | ตัดคำภาษาไทยแบบหาคำที่ยาวที่สุดจากคลังคำ |
| `app/scripts/set_role.py` | ตั้งบทบาทผู้ใช้จากอีเมล |
| `app/scripts/export_registry.py` | ส่งออกรหัสคำ/ผู้แสดงเป็น CSV ให้โน้ตบุ๊ก |
| `app/scripts/rename_samples.py` | ย้ายชื่อคลิปรูปแบบเก่าเป็น `W####_S###_C###` |
| `sql/` | คำสั่ง SQL ที่เพิ่มคอลัมน์/ตาราง (รันซ้ำได้ backend รันให้เองตอนเปิด) |

### frontend/ (React + Vite + TypeScript + Tailwind)

| ไฟล์ / โฟลเดอร์ | หน้าที่ |
|---|---|
| `public/models/x-bot.fbx` | ตัวละคร 3D (Mixamo X Bot) |
| `src/app/` | จุดเริ่มแอป เส้นทางของแต่ละหน้า |
| `src/features/sign-to-text/` | หน้าภาษามือ → ข้อความ: กล้อง, วาด skeleton ทับภาพ, ส่ง WebSocket, แสดงผล |
| `src/features/text-to-sign/` | หน้าข้อความ → ภาษามือ: ช่องพิมพ์/พูด, ตัวละคร 3D (`Avatar3D.tsx`) และแบบ 2D สำรอง |
| `src/features/emergency-aac/` | หน้าปุ่มฉุกเฉิน |
| `src/features/contributor/` | พื้นที่ล่าม: อัดคลิป (`RecorderPanel`), ช่องเลือกคำ (`WordCombobox`), อ่านไฟล์ .npy/.npz (`parseLandmarkFile`), คลังคำ |
| `src/features/admin/` | หน้าแอดมิน: แดชบอร์ด · ผู้ใช้ (`UsersView`) · คลังคำศัพท์ (`VocabularyView`) · โมเดล + ชุดทดสอบ (`ModelsView`) · บันทึกการใช้งาน (`LogsView`) |
| `src/features/profile/` | หน้าโปรไฟล์ของผู้ใช้ทุกบทบาท (`/profile`) |
| `src/features/auth/` | หน้าล็อกอิน และสถานะผู้ใช้ |
| `src/components/ui/` | ชิ้นส่วนหน้าจอที่ใช้ร่วมกัน (ปุ่ม การ์ด ช่องค้นหา สวิตช์ แผงด้านข้าง กล่องยืนยัน ฯลฯ) |
| `src/lib/mediapipe/` | โหลด MediaPipe, ตรวจจับท่า (`holistic.ts`), วาด skeleton (`draw.ts`), ลดการสั่น (`smoothing.ts`) |
| `src/lib/avatar3d/` | ขยับตัวละคร 3D: โหลดโมเดล (`loadModel.ts`), IK แขน/ข้อมือ/นิ้ว และกันแขนทะลุตัว (`rig.ts`) |
| `src/lib/avatar/skeleton.ts` | ผสมท่าระหว่าง keyframe และตัวละคร 2D |
| `src/lib/apiClient.ts`, `activityLog.ts`, `tts.ts`, `format.ts` | เรียก API, ส่ง log, อ่านออกเสียง, จัดรูปแบบตัวเลข/วันที่ |
| `src/components/` | ส่วนประกอบหน้าจอที่ใช้ร่วมกัน (ปุ่ม การ์ด ไอคอน เมนู) |
| `src/config/` | ค่าตั้ง: ที่อยู่ API (`VITE_API_URL`, `VITE_WS_URL`), วลี/ไอคอน AAC |

### ml/

| ไฟล์ | หน้าที่ |
|---|---|
| `src/features.py` | แปลง skeleton เป็น feature ให้โมเดล — **ใช้ร่วมกันทั้งตอนเทรนและ backend** |
| `src/train.py` | เทรนโมเดล บันทึก `ml/models/model_signBridge_vX.Y.Z.npz` และรายงานความคืบหน้าลงฐานข้อมูล |
| `src/run_tracker.py` | บันทึก log/ความคืบหน้าการเทรนลงตาราง `training_runs` (หน้าแอดมินอ่าน) |
| `src/db.py` | เชื่อมฐานข้อมูลและ Storage สำหรับสคริปต์ใน `ml/` |
| `src/import_tsl.py`, `import_tsl_storage.py` | สร้าง `tsl_skeleton.npz` จากชุดข้อมูล TSL |
| `src/build_vocabulary.py` | นำ Excel + รายชื่อคำ TSL เข้าตาราง `words` |
| `src/build_motions.py` | สร้างท่าอวตารจากคลิปจริง ลงตาราง `motions` |
| `configs/train_words.json` | ตั้งค่าการเทรน (`include_null_class`, `min_recorded_clips`) |
| `data/processed/` | `tsl_skeleton.npz` |
| `models/` | ไฟล์โมเดลที่เทรนแล้ว |

ไฟล์ว่างที่ยังไม่ได้ใช้: `ml/src/evaluate.py`, `extract_landmarks.py`, `split.py`, `train_baseline.py`, `backend/app/core/logging.py`, `backend/app/ml/preprocessing.py`

---

## API

| Method | Path | สิทธิ์ |
|---|---|---|
| GET | `/api/health` | ทุกคน |
| GET | `/api/auth/me` · POST `/api/auth/register` · `/login` · `/logout` | ทุกคน |
| GET | `/api/auth/{google\|line}/start` · `/callback` | ทุกคน |
| WS | `/ws/sign-to-text` (`?version=draft` เฉพาะแอดมิน/ล่าม) | ทุกคน |
| POST | `/api/text-to-sign` · GET `/api/text-to-sign/words` | ทุกคน |
| GET/POST/PATCH/DELETE | `/api/emergency-phrases` | ดู: ทุกคน · แก้: ผู้ที่ล็อกอิน |
| GET/POST/DELETE | `/api/contributor/...` (words, vocabulary, samples, landmarks) | ล่าม/แอดมิน |
| GET/PATCH/DELETE | `/api/profile` · PUT/GET/DELETE `/api/profile/card-image` · POST `/api/profile/password` · DELETE `/api/profile/identities/{provider}` | ผู้ที่ล็อกอิน (ของตัวเอง) |
| GET | `/api/admin/users` | ล่าม (เห็นแค่ชื่อ) / แอดมิน (เต็ม) |
| POST/PATCH/DELETE | `/api/admin/users` · GET `/api/admin/users/{id}/card-image` | แอดมิน |
| GET/PUT | `/api/admin/test-split` · PATCH `/api/admin/samples/{id}` (เทรน/ทดสอบ) | แอดมิน |
| GET | `/api/admin/dashboard` · `/vocabulary` · `/models` · `/train/status` | แอดมิน |
| PATCH | `/api/admin/vocabulary/{word}` (ติ๊กคำเทรน) | แอดมิน |
| POST | `/api/admin/models/active` · `/api/admin/publish` | แอดมิน |
| POST | `/api/logs/events` · GET `/api/admin/logs` · `/api/admin/logs/export.csv` | ทุกคน / แอดมิน |

---

## ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| หน้าแปลขึ้น "ยังไม่มีโมเดลแปลภาษามือที่ใช้งาน" | ยังไม่ได้เผยแพร่โมเดล หรือโมเดลที่ใช้อยู่เก่ากว่า `FEATURE_VERSION` → เทรนใหม่แล้วกดเผยแพร่ |
| "ยังไม่ได้ตั้งค่า Supabase Storage (SUPABASE_SERVICE_ROLE_KEY ใน .env)" | ใส่ key ใน `.env` แล้ว restart backend (`docker compose restart backend`) |
| `ModuleNotFoundError: No module named 'numpy'` ตอนรัน `train.py` | ยังไม่ได้ลง package ใน venv ที่ใช้: `pip install -r ml/requirements.txt` |
| เผยแพร่แล้วขึ้น "ไม่พบไฟล์โมเดล" | ไฟล์ `.npz` ไม่อยู่ใน `ml/models/` ของเครื่องที่รัน backend |
| backend ไม่ยอมเปิด แจ้งเรื่อง `AUTH_SECRET` | ยังไม่ได้ใส่ `AUTH_SECRET` ใน `.env` |
| ล็อกอินไม่ได้ ขึ้น "บ่อยเกินไป" | ใส่รหัสผิด 5 ครั้งใน 15 นาที หรือเรียกเกิน 10 ครั้ง/นาที — รอแล้วลองใหม่ |
