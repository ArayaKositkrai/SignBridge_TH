# รันจากโฟลเดอร์ ml/src:  python fix_clip_test.py
from pathlib import Path
p = Path("train.py"); s = p.read_text(encoding="utf-8")
if "clip_test.append" in s:
    raise SystemExit("แก้ไว้แล้ว")
edits = [
 ('str(d["source"][i]), None))', 'str(d["source"][i]), None, False))'),
 ('"ล่าม", c["face"]))', '"ล่าม", c["face"], c.get("split") == "test"))'),
 ('feats, labels_raw, signers, sources = [], [], [], []', 'feats, labels_raw, signers, sources, clip_test = [], [], [], [], []'),
 ('for seq, aspect, label, signer, source, face in clips:', 'for seq, aspect, label, signer, source, face, is_test in clips:'),
 ('            sources.append(source)\n', '            sources.append(source)\n            clip_test.append(bool(is_test))\n'),
]
for a, b in edits:
    if s.count(a) != 1:
        raise SystemExit(f"หาจุดแก้ไม่เจอหรือซ้ำ (ไฟล์ต่างจากที่คาด): {a[:50]}")
    s = s.replace(a, b)
p.write_text(s, encoding="utf-8"); print("แก้ train.py แล้ว 5 จุด")
