import csv
import io
import re
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field

from app.api.deps import current_user, require_admin
from app.services import activity_log

# กลุ่ม route ของ log การใช้งาน: รับ event จากหน้าเว็บ และให้แอดมินดู/ดาวน์โหลด
router = APIRouter(tags=["logs"])

# รูปแบบเวลาที่รับจากหน้าเว็บ (เวลาท้องถิ่นของเครื่องผู้ใช้ ตอนกดปุ่มจริง)
TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$")
# จำนวนแถวสูงสุดต่อหน้า และสูงสุดตอนดาวน์โหลด CSV
MAX_PAGE = 200
MAX_EXPORT = 50_000

# ชื่อการกระทำภาษาไทยของ API แต่ละตัว (METHOD + route) ใช้ตอนบันทึกอัตโนมัติ
ACTION_NAMES = {
    "POST /api/emergency-phrases": "เพิ่มปุ่ม AAC",
    "PATCH /api/emergency-phrases/{phrase_id}": "แก้ไขปุ่ม AAC",
    "DELETE /api/emergency-phrases/{phrase_id}": "ลบปุ่ม AAC",
    "POST /api/text-to-sign": "แปลข้อความเป็นภาษามือ",
    "POST /api/contributor/samples": "บันทึกคลิป",
    "POST /api/contributor/landmarks": "บันทึก skeleton",
    "DELETE /api/contributor/samples/{word}/{sample_id}": "ลบคลิป",
    "POST /api/admin/users": "เพิ่มผู้ใช้",
    "PATCH /api/admin/users/{user_id}": "แก้ไขผู้ใช้",
    "DELETE /api/admin/users/{user_id}": "ลบผู้ใช้",
    "POST /api/admin/train": "สั่งเทรนโมเดล",
    "POST /api/admin/publish": "เผยแพร่โมเดล",
    "POST /api/admin/models/active": "เปลี่ยนเวอร์ชันโมเดลที่ใช้",
}


# event หนึ่งรายการจากหน้าเว็บ (เก็บแค่ชื่อปุ่ม/การกระทำ ไม่เก็บข้อความที่ผู้ใช้พิมพ์)
class EventIn(BaseModel):
    action: str = Field(min_length=1, max_length=120)
    detail: str | None = Field(default=None, max_length=200)
    page: str = Field(default="/", max_length=120)
    kind: Literal["ปุ่ม", "เปิดหน้า"] = "ปุ่ม"
    ts: str | None = Field(default=None, max_length=32)


# ชุด event ที่หน้าเว็บส่งมาพร้อมกัน
class EventsIn(BaseModel):
    events: list[EventIn] = Field(min_length=1, max_length=50)
    device: str | None = Field(default=None, max_length=40)


# หารหัสเครื่องและ IP ของผู้เรียก
def client_info(request: Request) -> tuple[str | None, str | None]:
    return request.headers.get("x-device-id"), request.client.host if request.client else None


# รับ event การกดปุ่ม/เปิดหน้าจากหน้าเว็บ (ผู้ทำดูจากหน้าที่ใช้งาน)
@router.post("/api/logs/events", status_code=204)
def add_events(body: EventsIn, request: Request, user: dict | None = Depends(current_user)):
    device, ip = client_info(request)
    device = device or body.device  # sendBeacon ตอนปิดหน้าแนบ header ไม่ได้ จึงส่งมาใน body
    for e in body.events:
        activity_log.add(
            actor=activity_log.actor_for(e.page, user), user_id=user["id"] if user else None, kind=e.kind, action=e.action, detail=e.detail,
            page=e.page, device=device, ip=ip, ts=e.ts if e.ts and TS_RE.match(e.ts) else None,
        )
    return Response(status_code=204)


# ตัวกรองที่ใช้ร่วมกันระหว่างดูรายการและดาวน์โหลด
def _filters(actor, kind, q, date_from, date_to) -> dict:
    return {"actor": actor or None, "kind": kind or None, "q": (q or "").strip() or None,
            "date_from": date_from or None, "date_to": date_to or None}


# รายการ log สำหรับแอดมิน (กรองตามผู้ทำ ประเภท คำค้น ช่วงวันที่ และแบ่งหน้า)
@router.get("/api/admin/logs", dependencies=[Depends(require_admin)])
def list_logs(
    actor: str | None = None, kind: str | None = None, q: str | None = None,
    date_from: str | None = None, date_to: str | None = None,
    limit: int = Query(50, ge=1, le=MAX_PAGE), offset: int = Query(0, ge=0),
):
    items, total = activity_log.query(**_filters(actor, kind, q, date_from, date_to), limit=limit, offset=offset)
    return {"items": items, "total": total, "today": activity_log.today_counts()}


# ดาวน์โหลด log ตามตัวกรองเป็นไฟล์ CSV (เปิดใน Excel ภาษาไทยได้)
@router.get("/api/admin/logs/export.csv", dependencies=[Depends(require_admin)])
def export_logs(
    actor: str | None = None, kind: str | None = None, q: str | None = None,
    date_from: str | None = None, date_to: str | None = None,
):
    items, _ = activity_log.query(**_filters(actor, kind, q, date_from, date_to), limit=MAX_EXPORT)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["วันที่เวลา", "ใคร", "ประเภท", "ทำอะไร", "รายละเอียด", "หน้า", "ฟังก์ชัน", "สถานะ", "เครื่อง", "IP"])
    for r in items:
        func = f"{r['method']} {r['path']}" if r["method"] else ""
        writer.writerow([r["ts"], r["actor"], r["kind"], r["action"], r["detail"] or "", r["page"] or "",
                         func, r["status"] or "", r["device"] or "", r["ip"] or ""])
    return Response(
        "﻿" + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="signbridge_logs.csv"'},
    )
