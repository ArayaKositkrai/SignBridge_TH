import logging

from sqlalchemy import text

from app.db.session import engine

# คอลัมน์ที่เพิ่มภายหลังในตาราง training_runs (เหมือน backend/sql/002_training_runs_progress.sql และ ml/src/db.py)
TRAINING_RUNS_COLUMNS_SQL = """
ALTER TABLE training_runs
    ADD COLUMN IF NOT EXISTS log text,
    ADD COLUMN IF NOT EXISTS progress jsonb,
    ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
    ADD COLUMN IF NOT EXISTS host text,
    ADD COLUMN IF NOT EXISTS error text
"""


# เพิ่มคอลัมน์ที่โค้ดต้องใช้ถ้ายังไม่มี (รันซ้ำได้) ล้มเหลวก็ให้เซิร์ฟเวอร์เปิดต่อได้ แค่บันทึกคำเตือน
def ensure_schema() -> None:
    try:
        with engine.begin() as conn:
            conn.execute(text(TRAINING_RUNS_COLUMNS_SQL))
    except Exception as e:  # noqa: BLE001
        logging.getLogger(__name__).warning("ปรับตาราง training_runs ไม่สำเร็จ: %s", e)
