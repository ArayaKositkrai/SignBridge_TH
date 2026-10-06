-- เก็บความคืบหน้าการเทรนในตาราง training_runs (ml/src/train.py เขียน, หน้าแอดมินอ่าน)
-- รันซ้ำได้ (IF NOT EXISTS) — backend และ train.py รันคำสั่งเดียวกันนี้เองตอนเริ่มอยู่แล้ว
ALTER TABLE training_runs
    ADD COLUMN IF NOT EXISTS log text,
    ADD COLUMN IF NOT EXISTS progress jsonb,
    ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
    ADD COLUMN IF NOT EXISTS host text,
    ADD COLUMN IF NOT EXISTS error text;
