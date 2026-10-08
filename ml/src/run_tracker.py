"""บันทึกความคืบหน้าการเทรนลงตาราง training_runs ให้หน้าแอดมินเห็น (log, ขั้น/รอบ, ความแม่นยำ, ผลลัพธ์)

train.py สร้างตัวนี้ตอนเริ่ม แล้วเรียก log()/progress()/finish() ระหว่างเทรน
ใช้การเชื่อมต่อ database แยกจากงานหลัก (บันทึกทันที ไม่ปนกับ transaction ตอนบันทึกโมเดล)
"""
import json
import os
import socket
import time
from collections import deque

import db

# จำนวนบรรทัด log ท้ายสุดที่เก็บในตาราง
LOG_LINES = 300
# เขียนลง database ห่างกันอย่างน้อยกี่วินาที (log และความคืบหน้าระหว่างรอบ)
FLUSH_EVERY_SEC = 3.0
# การเทรนอื่นที่รายงานล่าสุดภายในกี่วินาที ถือว่ายังรันอยู่ (กันเทรนซ้อน)
BUSY_SECONDS = 120


# ตัวบันทึกการเทรนหนึ่งครั้ง (หนึ่งแถวใน training_runs)
class RunTracker:
    # เปิดการเชื่อมต่อ เพิ่มคอลัมน์ที่ต้องใช้ ปิดงานที่ค้าง และกันการเทรนซ้อน (force = ข้ามการกัน)
    def __init__(self, force: bool = False):
        self.conn = db.connect()
        db.ensure_training_columns(self.conn)
        # งาน running ที่เงียบไปนาน (เครื่องดับ/ปิดหน้าต่าง) ปิดเป็น failed ไม่ให้ค้างเป็น "กำลังเทรน"
        self.conn.execute(
            """
            UPDATE training_runs SET status = 'failed', finished_at = now(),
                error = COALESCE(error, 'ขาดการติดต่อ (หยุดกลางคัน)')
            WHERE status = 'running' AND COALESCE(heartbeat_at, started_at) < now() - make_interval(secs => %s)
            """,
            (BUSY_SECONDS,),
        )
        busy = self.conn.execute(
            "SELECT host FROM training_runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1"
        ).fetchone()
        if busy and not force:
            self.conn.close()
            raise SystemExit(f"มีการเทรนที่กำลังรันอยู่ (เครื่อง {busy[0] or 'ไม่ทราบ'}) — รอให้เสร็จ หรือใส่ --force")
        self.lines: deque[str] = deque(maxlen=LOG_LINES)
        self.state: dict = {"stage": "load"}
        self.last_flush = 0.0
        self.run_id = self.conn.execute(
            """
            INSERT INTO training_runs (status, host, log, progress, heartbeat_at, started_by)
            VALUES ('running', %s, '', %s, now(), %s) RETURNING id
            """,
            # TRAIN_STARTED_BY = ผู้ใช้ที่กดเทรนจากหน้าเว็บ (รันจากเครื่องเอง = ไม่ทราบ)
            (socket.gethostname(), json.dumps(self.state), os.environ.get("TRAIN_STARTED_BY") or None),
        ).fetchone()[0]

    # เขียน log และความคืบหน้าลง database (force = เขียนทันทีไม่รอรอบ)
    def flush(self, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self.last_flush < FLUSH_EVERY_SEC:
            return
        self.last_flush = now
        try:
            self.conn.execute(
                "UPDATE training_runs SET log = %s, progress = %s, heartbeat_at = now() WHERE id = %s",
                ("\n".join(self.lines), json.dumps(self.state, ensure_ascii=False), self.run_id),
            )
        except Exception as e:  # noqa: BLE001 — database หลุดชั่วคราวต้องไม่ทำให้การเทรนล้ม
            print(f"(บันทึกความคืบหน้าไม่สำเร็จ: {e})", flush=True)

    # เพิ่มข้อความหนึ่งบรรทัดใน log
    def log(self, msg: str) -> None:
        self.lines.extend(msg.splitlines() or [""])
        self.flush()

    # อัปเดตความคืบหน้า เช่น stage="final", epoch=10, epochs=80, loss=0.5 (เปลี่ยนขั้น = เขียนทันที)
    def progress(self, **values) -> None:
        stage_changed = "stage" in values and values["stage"] != self.state.get("stage")
        if stage_changed:
            self.state = {}
        self.state.update({k: v for k, v in values.items() if v is not None})
        self.flush(force=stage_changed)

    # จบการเทรน: succeeded พร้อมโมเดลที่ได้ หรือ failed พร้อมข้อผิดพลาด
    def finish(self, status: str, model_id: int | None = None, error: str | None = None) -> None:
        self.state["stage"] = "done" if status == "succeeded" else "failed"
        self.flush(force=True)
        try:
            self.conn.execute(
                """
                UPDATE training_runs SET status = %s, finished_at = now(), return_code = %s, model_id = %s, error = %s
                WHERE id = %s
                """,
                (status, 0 if status == "succeeded" else 1, model_id, error, self.run_id),
            )
        finally:
            self.conn.close()
