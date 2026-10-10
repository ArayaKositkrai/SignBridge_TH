import os
import threading
import time
from collections import deque

from fastapi import HTTPException, Request

# อยู่หลัง reverse proxy (เช่น nginx) ที่ใส่ X-Forwarded-For ให้: ตั้ง TRUST_PROXY=1 ไม่งั้นไม่เชื่อ header นี้ (ปลอมได้)
TRUST_PROXY = os.getenv("TRUST_PROXY", "") == "1"
# จำนวนคีย์สูงสุดที่จำไว้ (เกินแล้วล้างคีย์ที่หมดอายุ กันหน่วยความจำโต)
MAX_KEYS = 50_000


# IP ของผู้เรียก (เชื่อ X-Forwarded-For เฉพาะเมื่อตั้ง TRUST_PROXY=1)
def client_ip(request: Request) -> str:
    if TRUST_PROXY:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ตัวจำกัดจำนวนครั้งแบบหน้าต่างเลื่อน (เก็บในหน่วยความจำของ process นี้: พอสำหรับเซิร์ฟเวอร์เดียว)
class RateLimiter:
    # limit = จำนวนครั้งสูงสุดภายใน window วินาที
    def __init__(self, limit: int, window: float):
        self.limit = limit
        self.window = window
        self.hits: dict[str, deque[float]] = {}
        self.lock = threading.Lock()

    # ล้างเวลาที่เก่ากว่าหน้าต่าง คืนรายการเวลาของคีย์นี้
    def _recent(self, key: str, now: float) -> deque[float]:
        q = self.hits.setdefault(key, deque())
        while q and now - q[0] > self.window:
            q.popleft()
        return q

    # ล้างคีย์ที่ไม่มีการเรียกในหน้าต่างแล้ว (เมื่อจำนวนคีย์มากเกิน)
    def _prune(self, now: float) -> None:
        if len(self.hits) <= MAX_KEYS:
            return
        for key in [k for k, q in self.hits.items() if not q or now - q[-1] > self.window]:
            del self.hits[key]

    # วินาทีที่ต้องรอก่อนเรียกได้อีก (0 = เรียกได้)
    def retry_after(self, key: str) -> int:
        now = time.monotonic()
        with self.lock:
            q = self._recent(key, now)
            return 0 if len(q) < self.limit else int(self.window - (now - q[0])) + 1

    # นับการเรียกหนึ่งครั้ง
    def record(self, key: str) -> None:
        now = time.monotonic()
        with self.lock:
            self._recent(key, now).append(now)
            self._prune(now)

    # เช็กแล้วนับในครั้งเดียว: เกินกำหนดโยน 429 พร้อมบอกเวลาที่ต้องรอ
    def hit(self, key: str, message: str = "เรียกใช้บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่") -> None:
        wait = self.retry_after(key)
        if wait:
            raise HTTPException(status_code=429, detail=message, headers={"Retry-After": str(wait)})
        self.record(key)


# ล็อกอิน/สมัครสมาชิก: ไม่เกิน 10 ครั้งต่อนาทีต่อ IP (แต่ละครั้งใช้ scrypt หนัก จึงต้องจำกัด)
auth_limiter = RateLimiter(limit=10, window=60)
# log จากหน้าเว็บ: ไม่เกิน 30 ครั้งต่อนาทีต่อ IP
log_limiter = RateLimiter(limit=30, window=60)


# dependency: จำกัดการเรียก API ล็อกอิน/สมัครสมาชิกต่อ IP
def limit_auth(request: Request) -> None:
    auth_limiter.hit(client_ip(request), "ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอ 1 นาทีแล้วลองใหม่")


# dependency: จำกัดการส่ง log จากหน้าเว็บต่อ IP
def limit_logs(request: Request) -> None:
    log_limiter.hit(client_ip(request))
