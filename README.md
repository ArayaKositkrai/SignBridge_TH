# SignBridge TH

ระบบสื่อสารสองทางระหว่างผู้ใช้ภาษามือไทยกับผู้ไม่ใช้ภาษามือ ประกอบด้วย 3 ฟีเจอร์หลัก

| ฟีเจอร์ | การทำงาน |
|---|---|
| **Sign → Text** | เปิดกล้อง จับท่ามือด้วย MediaPipe Holistic ส่ง landmarks ผ่าน WebSocket ไปให้ backend จำแนกท่า แล้วแสดงเป็นข้อความ (และอ่านออกเสียงได้) |
| **Text → Sign** | พิมพ์หรือพูดเป็นข้อความ → ตัดคำ → เล่นเป็นท่าภาษามือด้วยตัวละคร 3D (ตอนนี้ตัดคำแบบ greedy match ธรรมดา ยังไม่ได้ใช้ PyThaiNLP ตามที่ตั้งใจไว้แต่แรก) |
| **Emergency AAC** | ปุ่มฉุกเฉินและวลีสำเร็จรูป กดแล้วพูดออกเสียงภาษาไทยทันที |

## โครงสร้างโปรเจค

```
signbridge-th/
├── frontend/            # เว็บแอป React + Vite + TypeScript
├── backend/             # API FastAPI (Python)
├── ml/                  # สคริปต์เตรียมข้อมูลและเทรนโมเดล
├── docs/                # เอกสารประกอบ
├── docker-compose.yml   # รัน frontend + backend พร้อมกัน
└── README.md
```

## frontend/

| ไฟล์ / โฟลเดอร์ | หน้าที่ |
|---|---|
| `public/models/x-bot.fbx` | โมเดล 3D "X Bot" (Mixamo) ที่เป็นตัวละครทำท่าภาษามือในหน้า Text → Sign |
| `public/sign-clips/` | คลิปวิดีโอภาษามือสำหรับฟีเจอร์ Text → Sign (ยังไม่มีคลิปจริง) |
| `src/main.tsx` | จุดเริ่มต้นของแอป |
| `src/app/App.tsx` | คอมโพเนนต์รากของแอป |
| `src/app/routes.tsx` | กำหนดเส้นทางหน้าเว็บ |
| `src/app/providers.tsx` | รวม context/provider ระดับแอป (BrowserRouter) |
| `src/features/sign-to-text/` | ฟีเจอร์ภาษามือ → ข้อความ |
| ↳ `SignToTextPage.tsx` | หน้าหลักของฟีเจอร์ |
| ↳ `components/` | CameraView (กล้อง), LandmarkOverlay (วาดจุด keypoint), ResultPanel (ผลลัพธ์) |
| ↳ `hooks/` | `useMediaPipe` (ตรวจจับท่าทางจากกล้อง), `useSignStream` (ส่ง WebSocket และต่อคำเป็นประโยค) |
| ↳ `services/signSocket.ts` | เชื่อมต่อ WebSocket ไป backend (ต่อใหม่เองเมื่อหลุด) |
| `src/features/text-to-sign/` | ฟีเจอร์ข้อความ/เสียง → ภาษามือ |
| ↳ `TextToSignPage.tsx` | หน้าหลักของฟีเจอร์ |
| ↳ `components/` | TextInput, VoiceInput, SignPlayer (ตัวเล่นคำต่อคำ), SkeletonAvatar (ตัวละคร 2D สำรอง), Avatar3D (ตัวละคร 3D หลัก) |
| ↳ `hooks/` | `useSpeechRecognition` (พูดเป็นข้อความ), `useSignPlayback` (คิวเล่นคำทีละคำ) |
| ↳ `services/textToSignApi.ts` | เรียก `POST /api/text-to-sign` |
| `src/features/emergency-aac/` | ฟีเจอร์ฉุกเฉิน/สื่อสารทดแทน |
| ↳ `EmergencyPage.tsx` | หน้าหลักของฟีเจอร์ |
| ↳ `components/` | EmergencyButton, PhraseGrid |
| ↳ `hooks/` | `useSpeak` (อ่านออกเสียง), `useCustomPhrases` (โหลด/เพิ่ม/ลบวลีที่ผู้ใช้เพิ่มเอง) |
| ↳ `services/emergencyApi.ts` | เรียก API วลีฉุกเฉินที่ backend |
| `src/components/ui/` | UI กลาง: Button, Card, Chip, Icon, Modal, PageTitle |
| `src/components/layout/` | Header, Navbar, PageLayout |
| `src/hooks/useCamera.ts` | เปิด/ปิด/สลับกล้อง |
| `src/lib/mediapipe/` | โหลด MediaPipe Holistic (`holistic.ts`) และวาดเส้น keypoint ลง canvas (`draw.ts`) |
| `src/lib/avatar/` | ตัวละคร 2D สำรอง: `skeleton.ts` (คำนวณท่ามือ/นิ้วจากข้อมูลท่าทาง), `render.ts` (วาดลง canvas) |
| `src/lib/avatar3d/` | ตัวละคร 3D หลัก: `loadModel.ts` (โหลด x-bot.fbx), `bones.ts` (ชื่อกระดูก Mixamo), `rig.ts` (หมุนกระดูกตามท่ามือ), `face.ts` (วาดหน้าการ์ตูนแปะบนหัวโมเดล เพราะโมเดลไม่มี blendshape) |
| `src/lib/tts.ts` | ห่อ `speechSynthesis` (th-TH) |
| `src/lib/apiClient.ts` | client สำหรับเรียก REST API |
| `src/config/env.ts` | URL ของ backend / MediaPipe / โมเดล 3D |
| `src/config/emergencyPhrases.ts` | วลีฉุกเฉินสำเร็จรูป 5 อัน + คำที่ใช้บ่อย |
| `src/types/` | TypeScript types กลาง |
| `src/styles/` | Tailwind และสไตล์ร่วม |
| `tsconfig.json` | ตั้งค่า TypeScript |
| `vite.config.ts` | ตั้งค่า Vite |
| `tailwind.config.js` | ธีมสี/ฟอนต์ |
| `package.json` | dependencies และ scripts |

## backend/

| ไฟล์ / โฟลเดอร์ | หน้าที่ |
|---|---|
| `app/main.py` | สร้างแอป FastAPI, ตั้งค่า CORS, ลงทะเบียน routes, มี `GET /` และ `GET /api/health` |
| `app/api/routes/sign_to_text.py` | WebSocket `/ws/sign-to-text` รับ landmarks ส่งผลจำแนกกลับ |
| `app/api/routes/text_to_sign.py` | `POST /api/text-to-sign` แปลงข้อความเป็นรายการคำ + ท่าทาง |
| `app/api/routes/emergency.py` | `GET/POST /api/emergency-phrases`, `DELETE /api/emergency-phrases/{id}` — จัดการเฉพาะวลีที่ผู้ใช้เพิ่มเอง (วลีสำเร็จรูป 5 อันฝังอยู่ฝั่ง frontend) |
| `app/services/recognition_service.py` | จำแนกท่ามือ — ตอนนี้เป็น **stub** นับจำนวนนิ้วที่ชู ยังไม่ใช่โมเดลจริง |
| `app/services/retrieval_service.py` | ค้นคำใน `vocabulary.json` แล้วแนบท่าทางจาก `motion_library.py` ให้ |
| `app/services/motion_library.py` | คลัง keyframe ท่ามือ/สีหน้าตัวอย่าง 12 คำ ให้ตัวละคร Text → Sign เล่น (เขียนมือเอง ไม่ใช่ท่ามาตรฐานภาษามือไทย) |
| `app/services/emergency_service.py` | อ่าน/เขียนวลีฉุกเฉินที่ผู้ใช้เพิ่มเอง ลงไฟล์ `data/custom_phrases.json` |
| `app/nlp/tokenizer.py` | ตัดคำแบบจับคู่ยาวสุดกับ `vocabulary.json` (**ยังไม่ได้ใช้ PyThaiNLP**) |
| `app/data/vocabulary.json` | คลังคำศัพท์ภาษามือที่ใช้จับคู่ตอนแปล |
| `app/data/custom_phrases.json` | วลีฉุกเฉินที่ผู้ใช้เพิ่มเอง (backend สร้างเองตอนรัน อยู่ใน `.gitignore`) |
| `tests/` | ยังไม่มี unit test |
| `Dockerfile` | สร้าง image ของ backend |
| `requirements.txt` | Python dependencies (`fastapi`, `uvicorn`) |

> ไฟล์เหล่านี้ยังเป็นโครงเปล่า (0 byte) รอการพัฒนาจริง ไม่ได้ผูกกับ route หรือถูกเรียกใช้ที่ไหน: `app/api/routes/vocabulary.py`, `app/api/routes/health.py` (health check จริงอยู่ใน `main.py`), `app/core/config.py`, `app/core/logging.py`, `app/schemas/`, `app/ml/preprocessing.py`, `app/ml/model_loader.py`, `app/ml/classifier.py`, `app/nlp/gloss_mapper.py`, `app/data/emergency_phrases.json`

## ml/

| ไฟล์ / โฟลเดอร์ | หน้าที่ |
|---|---|
| `data/` | ข้อมูลดิบและที่ประมวลผลแล้ว (อยู่ใน `.gitignore`) |
| `notebooks/` | EDA และการทดลอง |
| `src/extract_landmarks.py` | ดึง landmarks จากวิดีโอ |
| `src/split.py` | แบ่งข้อมูลแบบ signer-independent |
| `src/features.py` | สร้างฟีเจอร์จาก landmarks |
| `src/train_baseline.py` | เทรนโมเดล baseline (RF/SVM) |
| `src/train_lstm.py` | เทรนโมเดล LSTM |
| `src/evaluate.py` | ประเมินผลโมเดล |
| `models/` | ไฟล์โมเดลที่เทรนแล้ว (`.pkl` / `.pt`) |
| `configs/` | ไฟล์ตั้งค่าการเทรน |
| `requirements.txt` | Python dependencies ของงาน ML |

> ทุกไฟล์ในตารางนี้ยังเป็นโครงเปล่า (0 byte) ทั้งหมด ยังไม่มีใครเขียนโค้ดจริง — ตารางนี้บอกแผนที่ตั้งใจไว้ ไม่ใช่สถานะปัจจุบัน

## วิธีเปิดโปรเจค

> สถานะปัจจุบัน: หน้าบ้านครบ 3 หน้า (Tailwind CSS) และ backend มี `/ws/sign-to-text` กับ `POST /api/text-to-sign` แล้ว แต่การจำแนกท่าภาษามือยังเป็น **stub** (นับจำนวนนิ้วที่ชูเพื่อจำลองผล) จนกว่าจะเทรนโมเดลจริง และยังไม่มีคลิปภาษามือใน `public/sign-clips/` ตัวเล่น Text → Sign จึงแสดงเป็นโมเดล 3D "X Bot" ของ Mixamo (`frontend/public/models/x-bot.fbx`, เรนเดอร์ด้วย three.js ใน `frontend/src/lib/avatar3d/`) ขยับแขน มือ 5 นิ้ว และเอียงหัวตาม keyframe ใน `backend/app/services/motion_library.py` ซึ่งเป็น**ท่าตัวอย่างที่เขียนมือ ไม่ใช่ท่ามาตรฐานภาษามือไทย** และเป็นการหมุนกระดูกแบบ IK/heuristic โดยประมาณ ไม่ใช่ mocap จริง (ควรแทนที่ด้วยข้อมูลที่ดึงจากวิดีโอจริงผ่าน `ml/src/extract_landmarks.py`) โมเดล X Bot ไม่มี blendshape ใบหน้า จึงวาดหน้าการ์ตูน (แบบเดียวกับตัวโครงกระดูก 2D) ลงบน canvas แล้วแปะเป็น texture ไว้หน้ากระดูกหัวแทน (`frontend/src/lib/avatar3d/face.ts`) ถ้าโหลดโมเดล 3D ไม่สำเร็จ (เช่นไม่มีเน็ตตอนโหลดไฟล์ `.fbx` ครั้งแรก) จะตกไปใช้ตัวโครงกระดูก 2D (canvas) แทนโดยอัตโนมัติ
>
> วลีฉุกเฉินที่ผู้ใช้เพิ่มเองเก็บที่ `backend/app/data/custom_phrases.json` (อยู่ใน `.gitignore`, ตั้งโฟลเดอร์เก็บผ่าน env `DATA_DIR` ได้) ผ่าน `GET/POST /api/emergency-phrases` และ `DELETE /api/emergency-phrases/{id}`
>
> ครั้งแรกที่เปิดกล้อง เบราว์เซอร์ต้องมีอินเทอร์เน็ตเพื่อโหลด MediaPipe wasm (jsdelivr) และโมเดล Holistic (storage.googleapis.com)
>
> ถ้าแก้ `frontend/package.json` หรือ `backend/requirements.txt` ต้องรัน `docker compose up --build` ใหม่

### สิ่งที่ต้องมี
- Node.js 18+
- Python 3.10+
- Docker Desktop

### วิธีที่ 1: Docker

```bash
docker compose up --build
```

### วิธีที่ 2: รันแยกทีละส่วน

**Backend**

Windows (PowerShell / cmd):
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

macOS / Linux (bash / zsh):
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

เปิดเอกสาร API ที่ http://localhost:8000/docs

> ความต่างหลักระหว่าง Windows กับ Mac/Linux คือคำสั่งสร้าง/เปิดใช้งาน virtual environment (`python` vs `python3`, `.venv\Scripts\activate` vs `source .venv/bin/activate`) ส่วนคำสั่งอื่น ๆ ในเอกสารนี้ (`docker compose`, `npm install`, `npm run dev`, `pip install`) ใช้เหมือนกันทุกระบบปฏิบัติการ

**Frontend**
```bash
cd frontend
npm install
npm run dev
```
เปิดที่ http://localhost:5173

**ML (เทรนโมเดล)**
```bash
cd ml
pip install -r requirements.txt
python src/extract_landmarks.py
python src/train_baseline.py
python src/evaluate.py
```
นำไฟล์โมเดลใน `ml/models/` ไปวางให้ backend โหลดผ่าน `app/ml/model_loader.py`

> กล้องและไมโครโฟนบนเบราว์เซอร์ต้องใช้ `localhost` หรือ HTTPS เท่านั้น
