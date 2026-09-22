import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.recognition_service import Recognizer

# กลุ่ม route ของฟีเจอร์ภาษามือ -> ข้อความ
router = APIRouter()


# WebSocket รับ landmarks จากกล้องทีละเฟรม แล้วส่งคำที่แปลได้กลับไป
@router.websocket("/ws/sign-to-text")
async def sign_to_text(ws: WebSocket):
    await ws.accept()
    # ตัวจำแนกท่าประจำการเชื่อมต่อนี้ (แยกกันต่อผู้ใช้)
    recognizer = Recognizer()
    try:
        # วนรับข้อความจากหน้าเว็บจนกว่าจะปิดการเชื่อมต่อ
        while True:
            try:
                msg = json.loads(await ws.receive_text())
            except json.JSONDecodeError:
                continue
            if msg.get("type") != "landmarks":
                continue
            # จำแนกท่าจากมือซ้ายขวา แล้วส่งผลกลับ
            result = recognizer.predict(msg.get("left_hand", []), msg.get("right_hand", []))
            await ws.send_json({"type": "result", **result})
    except WebSocketDisconnect:
        pass
