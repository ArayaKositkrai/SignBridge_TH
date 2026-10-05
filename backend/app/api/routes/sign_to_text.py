import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.recognition_service import Recognizer

# กลุ่ม route ของฟีเจอร์ภาษามือ -> ข้อความ
router = APIRouter()


# WebSocket รับ landmarks จากกล้องทีละเฟรม แล้วส่งคำที่แปลได้กลับไป (?version=draft = ทดสอบโมเดล draft)
@router.websocket("/ws/sign-to-text")
async def sign_to_text(ws: WebSocket):
    await ws.accept()
    # ตัวแปลประจำการเชื่อมต่อนี้ (แยกกันต่อผู้ใช้)
    version = "draft" if ws.query_params.get("version") == "draft" else "active"
    recognizer = Recognizer(version)
    try:
        # วนรับข้อความจากหน้าเว็บจนกว่าจะปิดการเชื่อมต่อ
        while True:
            try:
                msg = json.loads(await ws.receive_text())
            except json.JSONDecodeError:
                continue
            if msg.get("type") != "landmarks":
                continue
            try:
                aspect = float(msg.get("aspect") or 16 / 9)
                ts = float(msg.get("ts") or 0)
            except (TypeError, ValueError):
                continue
            # แปลจากลำตัว มือซ้ายขวา และจุดสำคัญของใบหน้า แล้วส่งผลกลับ
            result = recognizer.push(
                ts, msg.get("pose") or [], msg.get("left_hand") or [], msg.get("right_hand") or [], aspect,
                msg.get("face") or [],
            )
            await ws.send_json({"type": "result", **result})
    except WebSocketDisconnect:
        pass
