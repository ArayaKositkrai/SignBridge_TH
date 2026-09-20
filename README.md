# SignBridge TH

ระบบสื่อสารสองทางระหว่างผู้ใช้ภาษามือไทยกับผู้ไม่ใช้ภาษามือ ประกอบด้วย 3 ฟีเจอร์หลัก

| ฟีเจอร์ | การทำงาน |
|---|---|
| **Sign → Text** | เปิดกล้อง จับท่ามือด้วย MediaPipe Holistic ส่ง landmarks ผ่าน WebSocket ไปให้ backend จำแนกท่า แล้วแสดงเป็นข้อความ (และอ่านออกเสียงได้) |
| **Text → Sign** | พิมพ์หรือพูดเป็นข้อความ → ตัดคำ (PyThaiNLP) → แปลงเป็น gloss → เล่นคลิปภาษามือที่ตรงกัน |
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
| `public/sign-clips/` | คลิปภาษามือสำหรับฟีเจอร์ Text → Sign |
| `src/main.tsx` | จุดเริ่มต้นของแอป |
| `src/app/App.tsx` | คอมโพเนนต์รากของแอป |
| `src/app/routes.tsx` | กำหนดเส้นทางหน้าเว็บ |
| `src/app/providers.tsx` | รวม context/provider ระดับแอป |
| `src/features/sign-to-text/` | ฟีเจอร์ภาษามือ → ข้อความ |
| ↳ `SignToTextPage.tsx` | หน้าหลักของฟีเจอร์ |
| ↳ `components/` | CameraView (กล้อง), LandmarkOverlay (วาดจุดมือ), ResultPanel (ผลลัพธ์) |
| ↳ `hooks/` | `useMediaPipe` (ประมวลผล landmarks), `useSignStream` (สตรีมข้อมูล) |
| ↳ `services/signSocket.ts` | เชื่อมต่อ WebSocket ไป backend |
| `src/features/text-to-sign/` | ฟีเจอร์ข้อความ/เสียง → ภาษามือ |
| ↳ `TextToSignPage.tsx` | หน้าหลักของฟีเจอร์ |
| ↳ `components/` | TextInput, VoiceInput, SignPlayer (เล่นคลิป) |
| ↳ `hooks/` | `useSpeechRecognition` (พูดเป็นข้อความ), `useSignPlayback` (คิวเล่นคลิป) |
| ↳ `services/textToSignApi.ts` | เรียก `POST /api/text-to-sign` |
| `src/features/emergency-aac/` | ฟีเจอร์ฉุกเฉิน/สื่อสารทดแทน |
| ↳ `EmergencyPage.tsx` | หน้าหลักของฟีเจอร์ |
| ↳ `components/` | EmergencyButton, PhraseGrid |
| ↳ `hooks/` | `useSpeak` (อ่านออกเสียง) |
| `src/components/ui/` | UI กลาง: Button, Card, Modal |
| `src/components/layout/` | Header, Navbar, PageLayout |
| `src/hooks/` | hook กลาง เช่น `useCamera` |
| `src/lib/mediapipe/` | โหลดและตั้งค่า MediaPipe Holistic |
| `src/lib/tts.ts` | ห่อ `speechSynthesis` (th-TH) |
| `src/lib/apiClient.ts` | client สำหรับเรียก REST API |
| `src/types/` | TypeScript types กลาง |
| `src/config/` | ตัวแปร env และค่าคงที่ |
| `src/styles/` | สไตล์ทั้งหมด |
| `tsconfig.json` | ตั้งค่า TypeScript |
| `vite.config.ts` | ตั้งค่า Vite |
| `package.json` | dependencies และ scripts |

## backend/

| ไฟล์ / โฟลเดอร์ | หน้าที่ |
|---|---|
| `app/main.py` | สร้างแอป FastAPI และลงทะเบียน routes |
| `app/api/routes/sign_to_text.py` | WebSocket `/ws/sign-to-text` รับ landmarks ส่งผลจำแนกกลับ |
| `app/api/routes/text_to_sign.py` | `POST /api/text-to-sign` แปลงข้อความเป็นรายการคลิปภาษามือ |
| `app/api/routes/emergency.py` | `GET /api/emergency-phrases` |
| `app/api/routes/vocabulary.py` | `GET /api/vocabulary` |
| `app/api/routes/health.py` | health check |
| `app/core/config.py` | อ่านค่าตั้งค่า/env |
| `app/core/logging.py` | ตั้งค่า logging |
| `app/schemas/` | Pydantic models (request/response) |
| `app/services/recognition_service.py` | ตรรกะจำแนกท่าภาษามือ |
| `app/services/retrieval_service.py` | ค้นหาคลิปภาษามือจาก gloss |
| `app/services/emergency_service.py` | จัดการวลีฉุกเฉิน |
| `app/ml/preprocessing.py` | normalize และ padding ของ landmarks |
| `app/ml/model_loader.py` | โหลดโมเดลที่เทรนแล้ว |
| `app/ml/classifier.py` | ตัวจำแนก RF/SVM และ LSTM |
| `app/nlp/tokenizer.py` | ตัดคำไทยด้วย PyThaiNLP |
| `app/nlp/gloss_mapper.py` | แปลงข้อความเป็น gloss |
| `app/data/vocabulary.json` | คลังคำศัพท์ภาษามือ |
| `app/data/emergency_phrases.json` | วลีฉุกเฉิน |
| `tests/` | unit test |
| `Dockerfile` | สร้าง image ของ backend |
| `requirements.txt` | Python dependencies |

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

## วิธีเปิดโปรเจค

> ตอนนี้ไฟล์โค้ดยังเป็นไฟล์เปล่า (โครงสร้างเท่านั้น) คำสั่งด้านล่างใช้ได้เมื่อเขียนโค้ดและเติม dependencies แล้ว

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
