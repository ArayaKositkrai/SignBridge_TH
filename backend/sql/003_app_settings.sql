-- ตั้งค่าของระบบที่แอดมินแก้จากหน้าเว็บ แล้ว train.py อ่านไปใช้ (เช่น test_split = ผู้แสดงที่กันไว้ทดสอบโมเดล)
-- รันซ้ำได้ (IF NOT EXISTS) — backend รันคำสั่งเดียวกันนี้เองตอนเริ่มอยู่แล้ว
CREATE TABLE IF NOT EXISTS app_settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
