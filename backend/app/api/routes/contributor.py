import os
import json
import subprocess
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pathlib import Path

router = APIRouter()

CONFIG_PATH = Path("../../ml/configs/model_config.json")
RAW_DATA_PATH = Path("../../ml/data/raw")

def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def save_config(data):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

@router.post("/upload-video")
async def upload_video(word: str = Form(...), file: UploadFile = File(...)):
    # สร้างโฟลเดอร์สำหรับคำศัพท์ถ้ายังไม่มี
    word_dir = RAW_DATA_PATH / word
    word_dir.mkdir(parents=True, exist_ok=True)
    
    file_path = word_dir / file.filename
    with open(file_path, "wb") as buffer:
        buffer.write(await file.read())
    
    # อนาคต: ใส่โค้ดเรียก OpenCV + MediaPipe สกัด Landmarks จากวิดีโอที่นี่
    return {"message": f"อัปโหลดวิดีโอสำหรับคำว่า '{word}' สำเร็จ", "path": str(file_path)}

@router.post("/save-landmarks")
async def save_landmarks(word: str, data: list):
    word_dir = RAW_DATA_PATH / word
    word_dir.mkdir(parents=True, exist_ok=True)
    
    # บันทึก Landmarks เป็น JSON (หรือ .npy)
    file_path = word_dir / f"sequence_{len(os.listdir(word_dir)) + 1}.json"
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f)
        
    return {"message": "บันทึกข้อมูลท่าทางเรียบร้อย"}

@router.post("/train")
async def train_model():
    try:
        # สั่งรันสคริปต์เทรนโมเดลในโฟลเดอร์ ml
        # สคริปต์นี้เมื่อรันเสร็จต้องเซฟไฟล์ .h5 ใหม่ และอัปเดตค่า draft_version ใน model_config.json
        subprocess.Popen(["python", "../../ml/src/train_lstm.py"])
        return {"message": "กำลังฝึกสอนโมเดลในพื้นหลัง (Background)..."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/publish")
async def publish_model():
    config = load_config()
    if not config.get("draft_version"):
        raise HTTPException(status_code=400, detail="ไม่มีโมเดลเวอร์ชัน Draft ให้เผยแพร่")
    
    # สลับ Draft เป็น Active
    config["active_version"] = config["draft_version"]
    config["draft_version"] = None
    save_config(config)
    
    return {"message": f"เผยแพร่โมเดล {config['active_version']} สำเร็จ"}
