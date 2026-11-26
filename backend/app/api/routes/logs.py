# API log การใช้งาน: รับ event จากหน้าเว็บ และให้แอดมินค้นหา/ดาวน์โหลด CSV

import csv
import io
import re
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field

from app.api.deps import current_user, require_admin
from app.core.rate_limit import client_ip, limit_logs
from app.services import activity_log

# กลุ่ม route ของ log การใช้งาน: รับ event จากหน้าเว็บ และให้แอดมินดู/ดาวน์โหลด
router = APIRouter(tags=["logs"])

# รูปแบบเวลาที่รับจากหน้าเว็บ (เวลาท้องถิ่นของเครื่องผู้ใช้ ตอนกดปุ่มจริง)
TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$")
# เวลาจากหน้าเว็บที่ห่างจากเวลาเซิร์ฟเวอร์เกินนี้ไม่เชื่อ (กันการย้อนเวลา/ตั้งเวลาล่วงหน้า) ใช้เวลาเซิร์ฟเวอร์แทน
MAX_CLOCK_SKEW = timedelta(minutes=10)
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
    "POST /api/admin/publish": "เผยแพร่โมเดล",
    "POST /api/admin/models/active": "เปลี่ยนเวอร์ชันโมเดลที่ใช้",
    "PATCH /api/admin/vocabulary/{word}": "เลือกคำไว้เทรน",
    "POST /api/admin/vocabulary": "เพิ่มคำในคลัง",
    "POST /api/admin/train": "เริ่มเทรนโมเดล",
    "POST /api/admin/train/cancel": "ยกเลิกการเทรน",
    "POST /api/admin/models/evaluate": "Run Test วัดผลทุกเวอร์ชัน",
    "DELETE /api/admin/models/{file}": "ลบโมเดล",
    "POST /api/admin/motions/build": "สร้างท่าอวตาร",
    "POST /api/admin/vocabulary/train-set": "เลือก/ยกเลิกคำไว้เทรนหลายคำ",
    "PUT /api/admin/users/{user_id}/split": "ตั้งล่ามเป็นชุดเทรน/ทดสอบ",
    "PATCH /api/admin/samples/{sample_id}": "สลับคลิปเทรน/ทดสอบ",
    "POST /api/auth/register": "สมัครสมาชิก",
    "POST /api/auth/login": "เข้าสู่ระบบ",
    "POST /api/auth/logout": "ออกจากระบบ",
    "PATCH /api/profile": "แก้ไขโปรไฟล์",
    "PUT /api/profile/card-image": "อัปโหลดรูปบัตรคนพิการ",
    "DELETE /api/profile/card-image": "ลบรูปบัตรคนพิการ",
    "POST /api/profile/password": "เปลี่ยนรหัสผ่าน",
    "DELETE /api/profile/identities/{provider}": "เลิกเชื่อมบัญชี",
    "DELETE /api/profile": "ลบบัญชีตัวเอง",
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
    return request.headers.get("x-device-id"), client_ip(request)


# เวลาที่หน้าเว็บส่งมา ใช้ได้เมื่อรูปแบบถูกและใกล้เวลาเซิร์ฟเวอร์ (คืน None = ใช้เวลาเซิร์ฟเวอร์)
def trusted_ts(ts: str | None) -> str | None:
    if not ts or not TS_RE.match(ts):
        return None
    try:
        sent = datetime.fromisoformat(ts)
    except ValueError:
        return None
    return ts if abs(datetime.now() - sent) <= MAX_CLOCK_SKEW else None


# รับ event การกดปุ่ม/เปิดหน้าจากหน้าเว็บ (จำกัดจำนวนครั้งต่อ IP)
#   ผู้ทำ (แอดมิน/ล่าม/ผู้ใช้) ดูจากผู้ใช้ที่ล็อกอินจริงเท่านั้น ไม่ดูจากหน้าที่หน้าเว็บบอกมา (ปลอมได้)
@router.post("/api/logs/events", status_code=204, dependencies=[Depends(limit_logs)])
def add_events(body: EventsIn, request: Request, user: dict | None = Depends(current_user)):
    device, ip = client_info(request)
    device = device or body.device  # sendBeacon ตอนปิดหน้าแนบ header ไม่ได้ จึงส่งมาใน body
    for e in body.events:
        activity_log.add(
            actor=activity_log.actor_for(e.page, user), user_id=user["id"] if user else None, kind=e.kind, action=e.action, detail=e.detail,
            page=e.page, device=device, ip=ip, ts=trusted_ts(e.ts),
        )
    return Response(status_code=204)


# ตัวกรองที่ใช้ร่วมกันระหว่างดูรายการและดาวน์โหลด
def _filters(actor, kind, q, date_from, date_to, hide_pages=False, failed=False) -> dict:
    return {"actor": actor or None, "kind": kind or None, "q": (q or "").strip() or None,
            "date_from": date_from or None, "date_to": date_to or None, "hide_pages": hide_pages, "failed": failed}


# รายการ log สำหรับแอดมิน (กรองตามผู้ทำ ประเภท คำค้น ช่วงวันที่ และแบ่งหน้า)
@router.get("/api/admin/logs", dependencies=[Depends(require_admin)])
def list_logs(
    actor: str | None = None, kind: str | None = None, q: str | None = None,
    date_from: str | None = None, date_to: str | None = None, hide_pages: bool = False, failed: bool = False,
    limit: int = Query(50, ge=1, le=MAX_PAGE), offset: int = Query(0, ge=0),
):
    items, total = activity_log.query(
        **_filters(actor, kind, q, date_from, date_to, hide_pages, failed), limit=limit, offset=offset
    )
    return {"items": items, "total": total, "today": activity_log.today_counts(), "today_summary": activity_log.today_summary()}


# ดาวน์โหลด log ตามตัวกรองเป็นไฟล์ CSV (เปิดใน Excel ภาษาไทยได้)
@router.get("/api/admin/logs/export.csv", dependencies=[Depends(require_admin)])
def export_logs(
    actor: str | None = None, kind: str | None = None, q: str | None = None,
    date_from: str | None = None, date_to: str | None = None, hide_pages: bool = False, failed: bool = False,
):
    items, _ = activity_log.query(**_filters(actor, kind, q, date_from, date_to, hide_pages, failed), limit=MAX_EXPORT)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["วันที่เวลา", "ผู้ใช้", "บทบาท", "ประเภท", "ทำอะไร", "รายละเอียด", "หน้า", "ผล"])
    for r in items:
        result = "" if r["status"] is None else ("สำเร็จ" if r["status"] < 400 else f"ไม่สำเร็จ ({r['status']})")
        writer.writerow([r["ts"], r["user_name"] or "", r["actor"], r["kind"], r["action"], r["detail"] or "",
                         r["page"] or "", result])
    return Response(
        "﻿" + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="signbridge_logs.csv"'},
    )
