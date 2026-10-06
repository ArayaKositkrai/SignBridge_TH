import json
import math
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from app.api.deps import SESSION_COOKIE
from app.services import auth_service
from app.services.recognition_service import Recognizer

# กลุ่ม route ของฟีเจอร์ภาษามือ -> ข้อความ
router = APIRouter()

# ขนาดข้อความสูงสุดที่รับต่อเฟรม (ไบต์) — เฟรมปกติ (ลำตัว + มือ + ใบหน้า 47 จุด) ราว 5-10 KB
MAX_MESSAGE_BYTES = 256 * 1024
# จำนวนจุดที่รับของแต่ละส่วน: (น้อยสุด, มากสุด) ที่ใช้ได้ (นอกช่วง = ถือว่าไม่เห็นส่วนนั้น)
POINT_LIMITS = {"pose": (17, 33), "left_hand": (21, 21), "right_hand": (21, 21), "face": (1, 478)}
# จำนวนข้อความสูงสุดต่อวินาทีต่อการเชื่อมต่อ (หน้าเว็บส่งทุก 100 ms = 10 ข้อความ/วินาที) เกินนี้ทิ้ง
MAX_MESSAGES_PER_SEC = 30
# สัดส่วนภาพที่รับได้ (กว้าง/สูง)
ASPECT_RANGE = (0.2, 5.0)
# บทบาทที่ใช้โมเดล draft ได้ (ทดสอบก่อนเผยแพร่)
DRAFT_ROLES = {"admin", "contributor"}


# ข้อมูลที่หน้าเว็บส่งมาไม่ถูกต้อง
class BadMessage(ValueError):
    pass


# ตรวจจุดหนึ่งจุด: [x, y, z] หรือ {"x","y","z"} ที่เป็นตัวเลขจำกัด คืน [x, y, z]
def _point(p) -> list[float]:
    if isinstance(p, dict):
        p = [p.get("x"), p.get("y"), p.get("z", 0)]
    if not isinstance(p, (list, tuple)) or not 2 <= len(p) <= 4:
        raise BadMessage("จุด landmark ไม่ถูกต้อง")
    out = []
    for v in p[:3]:
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise BadMessage("พิกัดต้องเป็นตัวเลข")
        out.append(float(v))
    return out if len(out) == 3 else [*out, 0.0]


# ตรวจรายการจุดของส่วนหนึ่ง (ลำตัว/มือ/ใบหน้า) จำนวนจุดไม่อยู่ในช่วงที่ใช้ได้ = ถือว่าไม่เห็น (รายการว่าง)
def _points(value, key: str) -> list[list[float]]:
    if value is None:
        return []
    lo, hi = POINT_LIMITS[key]
    if not isinstance(value, list) or len(value) > 478:
        raise BadMessage(f"ข้อมูล {key} ไม่ถูกต้อง")
    if not lo <= len(value) <= hi:
        return []
    return [_point(p) for p in value]


# แปลงข้อความจากหน้าเว็บเป็นข้อมูลเฟรมที่ตรวจแล้ว (โยน BadMessage ถ้าผิดรูปแบบ)
def parse_frame(raw: str) -> dict | None:
    if len(raw) > MAX_MESSAGE_BYTES:
        raise BadMessage("ข้อความใหญ่เกินไป")
    try:
        msg = json.loads(raw)
    except ValueError:
        raise BadMessage("ข้อความไม่ใช่ JSON")
    if not isinstance(msg, dict):
        raise BadMessage("ข้อความต้องเป็น object")
    if msg.get("type") != "landmarks":
        return None
    aspect = msg.get("aspect", 16 / 9)
    if isinstance(aspect, bool) or not isinstance(aspect, (int, float)) or not ASPECT_RANGE[0] <= aspect <= ASPECT_RANGE[1]:
        aspect = 16 / 9
    return {key: _points(msg.get(key), key) for key in POINT_LIMITS} | {"aspect": float(aspect)}


# เวอร์ชันโมเดลที่ใช้: draft เฉพาะแอดมิน/ล่ามที่ล็อกอิน (อ่าน cookie session ของ WebSocket) นอกนั้นใช้ active
def _version(ws: WebSocket) -> tuple[str, str | None]:
    if ws.query_params.get("version") != "draft":
        return "active", None
    user_id = auth_service.read_session(ws.cookies.get(SESSION_COOKIE))
    user = auth_service.get_active_user(user_id) if user_id else None
    if user and user["role"] in DRAFT_ROLES:
        return "draft", None
    return "active", "โมเดล draft ใช้ได้เฉพาะแอดมินหรือล่ามที่เข้าสู่ระบบ — ใช้โมเดลที่เผยแพร่แทน"


# WebSocket รับ landmarks จากกล้องทีละเฟรม แล้วส่งคำที่แปลได้กลับไป (?version=draft = ทดสอบโมเดล draft)
@router.websocket("/ws/sign-to-text")
async def sign_to_text(ws: WebSocket):
    await ws.accept()
    version, warning = await run_in_threadpool(_version, ws)
    if warning:
        await ws.send_json({"type": "error", "detail": warning})
    # ตัวแปลประจำการเชื่อมต่อนี้ (แยกกันต่อผู้ใช้)
    recognizer = Recognizer(version)
    window_start, count = time.monotonic(), 0
    try:
        # วนรับข้อความจากหน้าเว็บจนกว่าจะปิดการเชื่อมต่อ
        while True:
            raw = await ws.receive_text()
            now = time.monotonic()
            if now - window_start >= 1:
                window_start, count = now, 0
            count += 1
            if count > MAX_MESSAGES_PER_SEC:
                continue
            try:
                frame = parse_frame(raw)
            except BadMessage as e:
                await ws.send_json({"type": "error", "detail": str(e)})
                continue
            if frame is None:
                continue
            # แปลจากลำตัว มือซ้ายขวา และจุดสำคัญของใบหน้า (คำนวณนอก event loop ไม่ให้ผู้ใช้คนอื่นค้าง)
            result = await run_in_threadpool(
                recognizer.push, now * 1000, frame["pose"], frame["left_hand"], frame["right_hand"], frame["aspect"],
                frame["face"],
            )
            await ws.send_json({"type": "result", **result})
    except WebSocketDisconnect:
        pass
