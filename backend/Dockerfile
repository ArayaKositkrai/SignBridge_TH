FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# torch (รุ่น CPU) สำหรับให้ปุ่มเทรนในหน้าแอดมินรัน ml/src/train.py ได้ในคอนเทนเนอร์นี้ (ตอนทำนายเว็บยังใช้แค่ numpy)
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
