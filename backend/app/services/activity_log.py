import os
import sqlite3
import threading
from datetime import datetime, timedelta
from pathlib import Path

# โฟลเดอร์เก็บข้อมูลที่ระบบเขียนเอง (เปลี่ยนได้ผ่าน env DATA_DIR)
DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
# ไฟล์ฐานข้อมูล log (SQLite มากับ Python ไม่ต้องติดตั้งเพิ่ม)
DB_PATH = DATA_DIR / "activity_log.db"
# เก็บ log ย้อนหลังกี่วัน
KEEP_DAYS = 180
# ประเภทของ log: กดปุ่มบนหน้าเว็บ / เรียกฟังก์ชันที่ backend / เปิดหน้า
KINDS = ("ปุ่ม", "ฟังก์ชัน", "เปิดหน้า")
# ผู้ทำ (ยังไม่มีล็อกอิน จึงดูจากพื้นที่ที่ใช้งาน)
ACTORS = ("แอดมิน", "ล่าม", "ผู้ใช้")
# คอลัมน์ที่เก็บ
COLUMNS = ("ts", "actor", "kind", "action", "detail", "page", "method", "path", "status", "device", "ip")

# กันการเขียนพร้อมกันจากหลายคำขอ
_lock = threading.Lock()
# การเชื่อมต่อฐานข้อมูล (เปิดครั้งเดียว)
_conn: sqlite3.Connection | None = None


# เปิดฐานข้อมูลและสร้างตารางถ้ายังไม่มี
def _db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, action TEXT NOT NULL,
                detail TEXT, page TEXT, method TEXT, path TEXT, status INTEGER, device TEXT, ip TEXT
            );
            CREATE INDEX IF NOT EXISTS logs_ts ON logs(ts);
            CREATE INDEX IF NOT EXISTS logs_actor ON logs(actor);
            """
        )
    return _conn


# หาผู้ทำจากพาธของหน้าเว็บหรือ API: แอดมิน / ล่าม / ผู้ใช้
def actor_for(path: str) -> str:
    if path.startswith(("/admin", "/api/admin")):
        return "แอดมิน"
    if path.startswith(("/contributor", "/api/contributor")):
        return "ล่าม"
    return "ผู้ใช้"


# ตัดข้อความให้ไม่เกินความยาวที่กำหนด (ว่าง = None)
def _clip(value, n: int):
    if value is None:
        return None
    text = str(value).strip()
    return text[:n] or None


# บันทึก log หนึ่งรายการ (เวลาปัจจุบันถ้าไม่ระบุ)
def add(*, actor: str, kind: str, action: str, detail=None, page=None, method=None, path=None,
        status=None, device=None, ip=None, ts: str | None = None) -> None:
    row = (
        ts or datetime.now().isoformat(timespec="seconds"),
        actor if actor in ACTORS else "ผู้ใช้",
        kind if kind in KINDS else "ปุ่ม",
        _clip(action, 120) or "-",
        _clip(detail, 200),
        _clip(page, 120),
        _clip(method, 10),
        _clip(path, 200),
        status,
        _clip(device, 40),
        _clip(ip, 64),
    )
    with _lock:
        db = _db()
        db.execute(f"INSERT INTO logs ({', '.join(COLUMNS)}) VALUES ({', '.join('?' * len(COLUMNS))})", row)
        db.commit()


# ค้นหา log ตามตัวกรอง คืน (รายการเรียงจากใหม่ไปเก่า, จำนวนทั้งหมดที่ตรงตัวกรอง)
def query(actor=None, kind=None, q=None, date_from=None, date_to=None, limit=50, offset=0):
    where, args = [], []
    if actor:
        where.append("actor = ?")
        args.append(actor)
    if kind:
        where.append("kind = ?")
        args.append(kind)
    if q:
        where.append("(action LIKE ? OR detail LIKE ? OR page LIKE ? OR path LIKE ? OR device LIKE ? OR ip LIKE ?)")
        args += [f"%{q}%"] * 6
    if date_from:
        where.append("ts >= ?")
        args.append(date_from)
    if date_to:
        where.append("ts < ?")
        args.append(date_to)
    sql_where = f"WHERE {' AND '.join(where)}" if where else ""
    with _lock:
        db = _db()
        total = db.execute(f"SELECT COUNT(*) FROM logs {sql_where}", args).fetchone()[0]
        rows = db.execute(
            f"SELECT * FROM logs {sql_where} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?", [*args, limit, offset]
        ).fetchall()
    return [dict(r) for r in rows], total


# นับจำนวน log ของวันนี้แยกตามผู้ทำ (แสดงสรุปบนหน้า Log)
def today_counts() -> dict[str, int]:
    start = datetime.now().strftime("%Y-%m-%dT00:00:00")
    with _lock:
        rows = _db().execute("SELECT actor, COUNT(*) FROM logs WHERE ts >= ? GROUP BY actor", (start,)).fetchall()
    return {a: n for a, n in rows}


# ลบ log ที่เก่ากว่า KEEP_DAYS วัน
def prune(days: int = KEEP_DAYS) -> None:
    cutoff = (datetime.now() - timedelta(days=days)).isoformat(timespec="seconds")
    with _lock:
        db = _db()
        db.execute("DELETE FROM logs WHERE ts < ?", (cutoff,))
        db.commit()
