# ไฟล์สำหรับขึ้นเซิร์ฟเวอร์จริง (เช่น Render): หน้าเว็บ + API อยู่ในคอนเทนเนอร์เดียว โดเมนเดียว
#   ตอนพัฒนาในเครื่องยังใช้ docker-compose.yml (backend/Dockerfile + frontend/Dockerfile) แบบเดิม
#   ไม่มี torch (ปุ่มเทรน/วัดผลในหน้าแอดมินจะบอกให้รันจากเครื่อง) — การแปลภาษามือใช้แค่ numpy
#   โมเดลไม่ได้อยู่ใน image: backend ดาวน์โหลดเวอร์ชันที่ใช้งานจาก Supabase Storage เองตอนเริ่ม

# ---------- 1) build หน้าเว็บ ----------
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# ไม่ตั้ง VITE_API_URL / VITE_WS_URL = เรียก API โดเมนเดียวกับหน้าเว็บ (ดู src/config/env.ts)
RUN npm run build

# ---------- 2) backend + หน้าเว็บที่ build แล้ว ----------
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TZ=Asia/Bangkok \
    ML_DIR=/app/ml FRONTEND_DIST=/app/frontend_dist
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
# backend ใช้ ml/src/features.py แปลง skeleton ตอนแปลภาษามือ และ ml/configs (ตั้งค่าการเทรน)
COPY ml/src ./ml/src
COPY ml/configs ./ml/configs
RUN mkdir -p ml/models ml/data/raw ml/data/processed
COPY --from=web /web/dist ./frontend_dist
EXPOSE 8000
# PORT ตั้งโดยผู้ให้บริการ (Render) ไม่มี = 8000 · --proxy-headers ให้รู้ว่าผู้ใช้เข้ามาทาง https
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
