# รันจากโฟลเดอร์ ml/src:  python fix_save_npz.py
from pathlib import Path
p = Path("train.py"); s = p.read_text(encoding="utf-8")
if "def save_npz_atomic" in s: raise SystemExit("แก้ไว้แล้ว")
if s.count("\ndef main():") != 1: raise SystemExit("หา def main ไม่เจอ (ไฟล์ต่างจากที่คาด)")
fn = '''
# บันทึก .npz แบบอะตอมิก: เขียนไฟล์ชั่วคราวก่อนแล้วค่อยเปลี่ยนชื่อ กันไฟล์โมเดลเสียถ้าโปรแกรมหยุดกลางคัน
def save_npz_atomic(path, **arrays):
    path = Path(path)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "wb") as f:
        np.savez(f, **arrays)
    os.replace(tmp, path)

'''
s = s.replace("\ndef main():", fn + "\ndef main():", 1)
p.write_text(s, encoding="utf-8"); print("เพิ่ม save_npz_atomic แล้ว")
