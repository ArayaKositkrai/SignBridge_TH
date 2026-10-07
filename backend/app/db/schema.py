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

# ตารางตั้งค่าของระบบ (เหมือน backend/sql/003_app_settings.sql)
APP_SETTINGS_SQL = """
CREATE TABLE IF NOT EXISTS app_settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
)
"""


# เพิ่มตาราง/คอลัมน์ที่โค้ดต้องใช้ถ้ายังไม่มี (รันซ้ำได้) ล้มเหลวก็ให้เซิร์ฟเวอร์เปิดต่อได้ แค่บันทึกคำเตือน
def ensure_schema() -> None:
    for name, sql in (("training_runs", TRAINING_RUNS_COLUMNS_SQL), ("app_settings", APP_SETTINGS_SQL)):
        try:
            with engine.begin() as conn:
                conn.execute(text(sql))
        except Exception as e:  # noqa: BLE001
            logging.getLogger(__name__).warning("ปรับตาราง %s ไม่สำเร็จ: %s", name, e)
