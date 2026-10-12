# รันจากโฟลเดอร์ ml/src:  python fix_fit_stage.py
from pathlib import Path
p = Path("train.py"); s = p.read_text(encoding="utf-8")
a = "def fit(X, y, n_class, mean, std, epochs=EPOCHS, report=None):"
b = "def fit(X, y, n_class, mean, std, epochs=EPOCHS, report=None, stage=None):"
if b in s: raise SystemExit("แก้ไว้แล้ว")
if s.count(a) != 1: raise SystemExit("หาบรรทัด def fit ไม่เจอ (ไฟล์ต่างจากที่คาด)")
p.write_text(s.replace(a, b), encoding="utf-8"); print("แก้ fit() แล้ว")
