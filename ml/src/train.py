"""เทรนโมเดลแปลภาษามือจาก skeleton แล้วบันทึกเป็นเวอร์ชัน draft

ข้อมูลที่ใช้:
- ml/data/processed/tsl_skeleton.npz  (นำเข้าด้วย import_tsl.py) เฉพาะคำที่ words.in_train_set ใน database
- คลิปที่ล่ามอัดผ่านระบบ: ตาราง samples + ไฟล์ .npz ใน Supabase Storage (คำที่มีคลิปถึงจำนวนขั้นต่ำ)
ผลลัพธ์: ไฟล์ ml/models/model_signBridge_vX.Y.Z.npz + แถวในตาราง models (status = draft) และ model_words

ขั้นตอน: แปลงเป็น feature (features.py) → แบ่งชุดทดสอบตามผู้แสดง (คนที่ทดสอบไม่อยู่ในชุดเทรน)
→ เทรน CNN 1 มิติ วัดความแม่นยำ → เทรนใหม่ด้วยข้อมูลทั้งหมด → บันทึกน้ำหนักเป็น .npz (backend ใช้แค่ numpy)
"""
import argparse
import os
import random
import re
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

import numpy as np
from psycopg.types.json import Jsonb
import torch
from torch import nn

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402
import features as F  # noqa: E402
from run_tracker import RunTracker  # noqa: E402

# โฟลเดอร์ ml (อ้างจากตำแหน่งไฟล์นี้)
ML_DIR = Path(__file__).resolve().parents[1]
# ชุดข้อมูล TSL ที่นำเข้าแล้ว
TSL_PATH = ML_DIR / "data" / "processed" / "tsl_skeleton.npz"
# โฟลเดอร์เก็บไฟล์โมเดล
MODELS_PATH = ML_DIR / "models"
# ชื่อไฟล์โมเดลแบบมีเลขเวอร์ชัน
MODEL_NAME = "model_signBridge_v{}.{}.{}.npz"
# รูปแบบสำหรับอ่านเลขเวอร์ชันจากชื่อไฟล์ (ทุกนามสกุล)
VERSION_RE = re.compile(r"^model_signBridge_v(\d+)\.(\d+)\.(\d+)\.\w+$")
# ชื่อคลาสของคลิปที่ไม่ได้ทำท่า
NULL_LABEL = "ไม่ทำท่า"
# สัดส่วนผู้แสดงที่กันไว้ทดสอบ
VAL_SIGNER_RATIO = 0.2
# ค่าการเทรน
EPOCHS = 80
BATCH = 64
LR = 2e-3
SEED = 7


# หาเลขเวอร์ชันถัดไป: ยังไม่มี = 0.0.0, มีแล้ว = เลขท้ายของเวอร์ชันล่าสุด + 1
# (ดูทั้งในตาราง models และไฟล์ในเครื่อง กันชื่อซ้ำ)
def next_version(conn) -> tuple[int, int, int]:
    names = [r[0] for r in conn.execute("SELECT file FROM models")] + [p.name for p in MODELS_PATH.iterdir()]
    found = [tuple(int(x) for x in m.groups()) for n in names if (m := VERSION_RE.match(n))]
    if not found:
        return (0, 0, 0)
    major, minor, patch = max(found)
    return (major, minor, patch + 1)


# ตัวบันทึกความคืบหน้าลงตาราง training_runs (หน้าแอดมินอ่าน) — None = ยังไม่ได้เริ่ม
_run: RunTracker | None = None


# พิมพ์ข้อความทันที และเก็บลง log ของการเทรนใน database ให้หน้าแอดมินเห็น
def log(msg: str):
    print(msg, flush=True)
    if _run:
        _run.log(msg)


# รายงานความคืบหน้า (ขั้น/รอบ/ค่า loss/ความแม่นยำ) ให้หน้าแอดมิน
def progress(**values):
    if _run:
        _run.progress(**values)


# บันทึก npz ลงไฟล์ชั่วคราวก่อนแล้วค่อยเปลี่ยนชื่อ (หยุดกลางคันจะไม่เหลือไฟล์ครึ่ง ๆ ที่เปิดไม่ได้)
def save_npz_atomic(path: Path, compressed: bool = False, **arrays) -> None:
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "wb") as f:
        (np.savez_compressed if compressed else np.savez)(f, **arrays)
    os.replace(tmp, path)


# ดึงชุด TSL ที่แบ่งเป็นไฟล์ย่อยใน Storage (datasets/tsl_skeleton/) มารวมเป็น tsl_skeleton.npz (สร้างด้วย import_tsl_storage.py --upload)
def _fetch_tsl_from_storage():
    import hashlib
    import io
    import json

    base = "datasets/tsl_skeleton"
    index = json.loads(db.download(f"{base}/index.json"))
    parts = []
    for name, sha in zip(index["parts"], index["sha256"]):
        raw = db.download(f"{base}/{name}")
        if hashlib.sha256(raw).hexdigest() != sha:
            raise RuntimeError(f"{name} ไม่ตรงกับ SHA-256 (ไฟล์เสีย)")
        parts.append(dict(np.load(io.BytesIO(raw), allow_pickle=False)))
    offs, shift = [np.zeros(1, dtype=np.int64)], 0
    for p in parts:
        offs.append(p["offsets"][1:] + shift)
        shift += int(p["offsets"][-1])
    merged = {k: np.concatenate([p[k] for p in parts]) for k in ("points", "label", "signer", "source", "sample_id", "aspect")}
    merged["offsets"] = np.concatenate(offs)
    TSL_PATH.parent.mkdir(parents=True, exist_ok=True)
    save_npz_atomic(TSL_PATH, compressed=True, **merged)
    log(f"ดาวน์โหลดชุด TSL จาก Storage แล้ว ({len(merged['label'])} คลิป จาก {len(parts)} ไฟล์ย่อย)")


# โหลดคลิปจากชุดข้อมูล TSL เฉพาะคำที่เลือก
def load_tsl(words: set[str], include_null: bool):
    if not TSL_PATH.is_file():
        # ไม่มีในเครื่อง: ลองดึงสำเนาที่เพื่อน/โน้ตบุ๊กอัปไว้ใน Storage (สร้างด้วย import_tsl_storage.py --upload)
        try:
            _fetch_tsl_from_storage()
        except Exception as e:
            log(f"ไม่พบ tsl_skeleton.npz ทั้งในเครื่องและใน Storage ({e}) (รัน import_tsl_storage.py หรือ import_tsl.py ก่อน) — ใช้เฉพาะคลิปที่ล่ามอัด")
            return []
    # อ่านแต่ละอาร์เรย์ออกมาครั้งเดียว (อ่านจาก NpzFile ในลูปจะคลายไฟล์บีบอัดใหม่ทุกครั้ง ช้ามาก)
    with np.load(TSL_PATH, allow_pickle=False) as d:
        pts, off, labels = d["points"], d["offsets"], d["label"]
        aspects, signers, sources = d["aspect"], d["signer"], d["source"]
    out = []
    for i, label in enumerate(labels):
        label = str(label)
        if label in words or (include_null and label == NULL_LABEL):
            # ชุดข้อมูล TSL ไม่มีจุดใบหน้า (face = None)
            out.append((pts[off[i] : off[i + 1]], float(aspects[i]), label, str(signers[i]), str(sources[i]), None))
    return out


# โหลดคลิปที่ล่ามอัดผ่านระบบจาก database + Storage (เฉพาะคำที่มีคลิปพอ)
def load_recorded(conn, min_clips: int):
    out = []
    skipped = []
    for c in db.recorded_samples(conn, min_clips, on_skip=lambda sid, why: skipped.append(f"{sid} ({why})")):
        out.append((c["points"], c["aspect"], c["word"], "ล่าม:" + (c["signer"] or "ไม่ระบุ"), "ล่าม", c["face"]))
    if out:
        log(f"คลิปที่ล่ามอัด {len(out)} คลิป")
    if skipped and skipped[0].startswith("ทั้งหมด "):
        # ไม่มี Storage key: ข้ามคลิปของล่ามทุกคลิป (on_skip ส่งมาครั้งเดียวในรูป "ทั้งหมด N คลิป (เหตุผล)")
        log(f"ไม่ได้ใช้คลิปที่ล่ามอัด{skipped[0].removeprefix('ทั้งหมด')}")
    elif skipped:
        more = " …" if len(skipped) > 10 else ""
        log(f"ข้ามคลิปที่อ่านไม่ได้ {len(skipped)} คลิป: {', '.join(skipped[:10])}{more}")
    return out


# CNN 1 มิติ: conv → pool → conv → pool → conv → (mean+max) → ชั้นจำแนก (ต้องตรงกับ features.predict_proba)
class SignCNN(nn.Module):
    # สร้างชั้นต่าง ๆ ตามจำนวน feature และจำนวนคำ
    def __init__(self, n_feat: int, n_class: int):
        super().__init__()
        self.conv0 = nn.Conv1d(n_feat, 128, 5, padding=2)
        self.conv1 = nn.Conv1d(128, 128, 5, padding=2)
        self.conv2 = nn.Conv1d(128, 192, 3, padding=1)
        self.drop = nn.Dropout(0.3)
        self.fc = nn.Linear(384, n_class)

    # x: (batch, เฟรม, feature) ที่ normalize แล้ว
    def forward(self, x):
        h = x.transpose(1, 2)
        h = nn.functional.max_pool1d(torch.relu(self.conv0(h)), 2)
        h = nn.functional.max_pool1d(torch.relu(self.conv1(self.drop(h))), 2)
        h = torch.relu(self.conv2(self.drop(h)))
        pooled = torch.cat([h.mean(2), h.amax(2)], 1)
        return self.fc(self.drop(pooled))


# สุ่มแปลงท่า: ยืดแกนนอน (ชดเชยสัดส่วนภาพที่ประมาณ) หมุน ย่อขยาย เลื่อน สั่น และยืด/หดเวลา แล้วคำนวณความเร็วใหม่
def augment(x: torch.Tensor) -> torch.Tensor:
    b, t, _ = x.shape
    n2 = F.N_POINTS * 2
    pos = x[:, :, :n2].reshape(b, t, F.N_POINTS, 2)
    present = x[:, :, n2 : n2 + 2]
    # ส่วนสีหน้า: ค่า 8 + เห็นหน้า 1 (ความเร็วคำนวณใหม่ท้ายฟังก์ชัน)
    f0 = 2 * n2 + 2
    face = x[:, :, f0 : f0 + F.N_FACE_FEAT].clone()
    face_seen = x[:, :, f0 + F.N_FACE_FEAT : f0 + F.N_FACE_FEAT + 1]
    # สีหน้าแต่ละคนต่างกันเล็กน้อย: สุ่มยืด/หดและเพิ่ม noise เฉพาะเฟรมที่เห็นหน้า
    face = (face * torch.empty(b, 1, F.N_FACE_FEAT).uniform_(0.9, 1.1) + torch.randn_like(face) * 0.01) * face_seen
    sx = torch.empty(b, 1, 1).uniform_(0.8, 1.25)
    ang = torch.empty(b).uniform_(-0.17, 0.17)
    scale = torch.empty(b, 1, 1, 1).uniform_(0.9, 1.1)
    cos, sin = torch.cos(ang), torch.sin(ang)
    rot = torch.stack([torch.stack([cos, -sin], -1), torch.stack([sin, cos], -1)], -2)  # (b,2,2)
    pos = pos.clone()
    pos[..., 0] *= sx
    pos = torch.einsum("btpc,bdc->btpd", pos, rot) * scale
    pos = pos + torch.empty(b, 1, 1, 2).uniform_(-0.1, 0.1) + torch.randn_like(pos) * 0.01
    # มือที่ไม่ปรากฏต้องเป็นศูนย์เหมือนตอนแปลจริง
    pos[:, :, F.LH] *= present[:, :, 0, None, None]
    pos[:, :, F.RH] *= present[:, :, 1, None, None]
    pos = pos.reshape(b, t, n2)
    # ยืด/หดเวลา: ตัดหัวท้ายแบบสุ่มแล้วยืดกลับเป็น t เฟรม (ประมาณค่าเชิงเส้นทั้ง batch พร้อมกัน)
    seq = torch.cat([pos, present, face, face_seen], 2)
    a = torch.randint(0, t // 8 + 1, (b, 1)).float()
    e = (t - 1) - torch.randint(0, t // 8 + 1, (b, 1)).float()
    where = a + (e - a) * torch.linspace(0, 1, t)
    lo = where.floor().long().clamp(0, t - 1)
    hi = (lo + 1).clamp(max=t - 1)
    w = (where - lo.float()).unsqueeze(2)
    pick = lambda idx: torch.gather(seq, 1, idx.unsqueeze(2).expand(-1, -1, seq.shape[2]))
    seq = pick(lo) * (1 - w) + pick(hi) * w
    pos, present = seq[:, :, :n2], (seq[:, :, n2 : n2 + 2] > 0.5).float()
    face_seen = (seq[:, :, -1:] > 0.5).float()
    face = seq[:, :, n2 + 2 : -1] * face_seen
    vel = torch.diff(pos, dim=1, prepend=pos[:, :1])
    face_vel = torch.diff(face, dim=1, prepend=face[:, :1])
    return torch.cat([pos, present, vel, face, face_seen, face_vel], 2)


# เทรนโมเดลหนึ่งรอบ คืนโมเดลที่เทรนแล้ว
#   stage = ชื่อขั้นที่รายงานให้หน้าแอดมิน (validate = เทรนเพื่อวัดผล, final = เทรนจริง)
def fit(X, y, n_class, mean, std, epochs=EPOCHS, report=None, stage="final"):
    torch.manual_seed(SEED)
    random.seed(SEED)
    model = SignCNN(X.shape[2], n_class)
    opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=1e-3)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=LR, total_steps=epochs * ((len(X) + BATCH - 1) // BATCH))
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.1)
    Xt, yt = torch.tensor(X), torch.tensor(y)
    m, s = torch.tensor(mean), torch.tensor(std)
    for ep in range(epochs):
        model.train()
        perm = torch.randperm(len(Xt))
        total = 0.0
        for i in range(0, len(Xt), BATCH):
            idx = perm[i : i + BATCH]
            xb = (augment(Xt[idx]) - m) / s
            loss = loss_fn(model(xb), yt[idx])
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            total += loss.item() * len(idx)
        progress(stage=stage, epoch=ep + 1, epochs=epochs, loss=round(total / len(Xt), 4))
        if report and (ep + 1) % 10 == 0:
            report(ep + 1, total / len(Xt), model)
    return model


# วัดความแม่นยำ: ถูกอันดับ 1, อยู่ใน 3 อันดับแรก และความแม่นยำรายคำ
def evaluate(model, X, y, mean, std, labels):
    model.eval()
    with torch.no_grad():
        logits = model((torch.tensor(X) - torch.tensor(mean)) / torch.tensor(std))
    top3 = logits.topk(3, 1).indices.numpy()
    pred = top3[:, 0]
    per = {labels[c]: round(float((pred[y == c] == c).mean()), 3) for c in np.unique(y)}
    return float((pred == y).mean()), float((top3 == y[:, None]).any(1).mean()), per


# ดึงน้ำหนักจากโมเดล torch เป็น dict ของ numpy (ชื่อเดียวกับที่ features.predict_proba ใช้)
def export_weights(model, mean, std) -> dict:
    w = {k: v.detach().numpy().astype(np.float32) for k, v in model.state_dict().items()}
    w["mean"], w["std"] = mean.astype(np.float32), std.astype(np.float32)
    return w


# เทรนทั้งหมด: โหลดข้อมูล → แบ่งตามผู้แสดง → เทรน/วัดผล → เทรนด้วยข้อมูลทั้งหมด → บันทึกเวอร์ชัน draft
def main():
    t0 = time.time()
    torch.set_num_threads(max(1, (os.cpu_count() or 2) - 1))
    conn = db.connect()
    cfg = db.train_settings()
    words = db.train_words(conn)
    log("--- เริ่มเทรนโมเดลแปลภาษามือ ---")
    progress(stage="load")

    clips = load_tsl(words, cfg.get("include_null_class", True)) + load_recorded(conn, cfg.get("min_recorded_clips", 5))
    feats, labels_raw, signers, sources = [], [], [], []
    n_face = 0
    for seq, aspect, label, signer, source, face in clips:
        f = F.clip_features(seq, aspect, face)
        n_face += face is not None and not np.isnan(face).all()
        if f is not None:
            feats.append(f)
            labels_raw.append(label)
            signers.append(signer)
            sources.append(source)
    if not feats:
        raise SystemExit("ไม่มีข้อมูลสำหรับเทรน")
    labels = sorted(set(labels_raw))
    X = np.stack(feats)
    y = np.array([labels.index(l) for l in labels_raw])
    counts = Counter(labels_raw)
    log(f"ข้อมูล {len(X)} คลิป · {len(labels)} คลาส · แหล่ง {dict(Counter(sources))} · มีใบหน้า {n_face} คลิป")
    missing = sorted(words - set(labels))
    if missing:
        log(f"คำที่ไม่มีข้อมูล (ข้าม): {', '.join(missing)}")

    # แบ่งชุดทดสอบตามผู้แสดง แยกทีละชุดข้อมูล (ทุกชุดมีคนทดสอบอย่างน้อย 1 คน)
    # คลิปของล่ามยังมีน้อย จึงใช้เทรนทั้งหมด
    rng = np.random.default_rng(SEED)
    val_signers = set()
    for src in sorted(set(sources) - {"ล่าม"}):
        pool = sorted({s for s, x in zip(signers, sources) if x == src})
        if len(pool) >= 2:
            val_signers |= set(rng.choice(pool, max(1, round(len(pool) * VAL_SIGNER_RATIO)), replace=False))
    is_val = np.array([s in val_signers for s in signers])
    metrics = {}
    if is_val.any() and (~is_val).any():
        mean, std = X[~is_val].reshape(-1, X.shape[2]).mean(0), X[~is_val].reshape(-1, X.shape[2]).std(0) + 1e-6
        log(f"ทดสอบกับผู้แสดงที่ไม่อยู่ในชุดเทรน {len(val_signers)} คน ({is_val.sum()} คลิป)")

        # รายงานผลทุก 10 รอบ
        def report(ep, loss, model):
            acc, top3, _ = evaluate(model, X[is_val], y[is_val], mean, std, labels)
            log(f"  รอบ {ep:3d}  loss {loss:.3f}  ถูก {acc:.1%}  ติด 3 อันดับ {top3:.1%}")
            progress(stage="validate", val_accuracy=round(acc, 4), val_top3=round(top3, 4))

        model = fit(X[~is_val], y[~is_val], len(labels), mean, std, report=report, stage="validate")
        acc, top3, per = evaluate(model, X[is_val], y[is_val], mean, std, labels)
        metrics = {"val_accuracy": round(acc, 4), "val_top3": round(top3, 4), "val_per_word": per, "val_clips": int(is_val.sum())}
        log(f"ผลบนผู้แสดงใหม่: ถูก {acc:.1%} · ติด 3 อันดับ {top3:.1%}")
        worst = sorted(per.items(), key=lambda kv: kv[1])[:5]
        log("คำที่ทายพลาดบ่อย: " + ", ".join(f"{k} {v:.0%}" for k, v in worst))

    # เทรนใหม่ด้วยข้อมูลทั้งหมดสำหรับใช้งานจริง
    log("เทรนรอบสุดท้ายด้วยข้อมูลทั้งหมด…")
    mean, std = X.reshape(-1, X.shape[2]).mean(0), X.reshape(-1, X.shape[2]).std(0) + 1e-6
    model = fit(X, y, len(labels), mean, std, stage="final")
    weights = export_weights(model, mean, std)
    progress(stage="save", val_accuracy=metrics.get("val_accuracy"), val_top3=metrics.get("val_top3"))

    # ตรวจว่าตัวคำนวณแบบ numpy ให้ผลเท่ากับ torch
    model.eval()
    with torch.no_grad():
        ref = torch.softmax(model((torch.tensor(X[:5]) - torch.tensor(mean)) / torch.tensor(std)), 1).numpy()
    got = np.stack([F.predict_proba(weights, x) for x in X[:5]])
    if not np.allclose(ref, got, atol=1e-4):
        raise SystemExit("ผลจาก numpy ไม่ตรงกับ torch")

    MODELS_PATH.mkdir(parents=True, exist_ok=True)
    version = next_version(conn)
    name = MODEL_NAME.format(*version)
    path = MODELS_PATH / name
    save_npz_atomic(path, labels=np.array(labels), feature_version=np.array(F.FEATURE_VERSION), **weights)
    seconds = round(time.time() - t0, 1)

    # บันทึกเป็นเวอร์ชัน draft (draft เดิมกลายเป็น archived) พร้อมคำที่รู้จักและผลรายคำ
    #   บันทึกลง database ไม่สำเร็จ = ลบไฟล์โมเดลทิ้ง ไม่ให้เหลือไฟล์ที่ไม่มีใครอ้างถึง
    per_word = metrics.get("val_per_word", {})
    try:
        with conn.transaction():
            conn.execute("UPDATE models SET status = 'archived' WHERE status = 'draft'")
            model_id = conn.execute(
                """
                INSERT INTO models (version, file, status, trained_at, samples, feature_version, val_accuracy,
                                    val_top3, val_clips, train_seconds, sources, bytes)
                VALUES (%s, %s, 'draft', %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
                """,
                (
                    "v{}.{}.{}".format(*version), name, datetime.now().astimezone(), int(len(X)), str(F.FEATURE_VERSION),
                    metrics.get("val_accuracy"), metrics.get("val_top3"), metrics.get("val_clips"), seconds,
                    Jsonb(dict(Counter(sources))), path.stat().st_size,
                ),
            ).fetchone()[0]
            for label in labels:
                if label == NULL_LABEL:
                    continue  # คลาส "ไม่ทำท่า" ไม่ใช่คำ (อยู่ในไฟล์โมเดลอย่างเดียว)
                conn.execute(
                    "INSERT INTO model_words (model_id, word_id, train_clips, val_accuracy) VALUES (%s, %s, %s, %s)",
                    (model_id, db.word_id(conn, label), counts[label], per_word.get(label)),
                )
    except Exception:
        path.unlink(missing_ok=True)
        raise
    finally:
        conn.close()
    log(f"--- เทรนเสร็จ: {name} ({seconds} วินาที) ---")
    return model_id


# เริ่มเทรนพร้อมบันทึกความคืบหน้า/ผลลงตาราง training_runs (หน้าแอดมินแสดงผลจากตารางนี้)
def run():
    global _run
    parser = argparse.ArgumentParser(description="เทรนโมเดลแปลภาษามือ (ผลเป็นเวอร์ชัน draft ให้แอดมินเผยแพร่)")
    parser.add_argument("--force", action="store_true", help="เทรนแม้มีการเทรนอื่นที่ยังรันอยู่")
    args = parser.parse_args()
    _run = RunTracker(force=args.force)
    try:
        model_id = main()
    except KeyboardInterrupt:
        _run.finish("failed", error="ถูกยกเลิก (Ctrl+C)")
        raise
    except SystemExit as e:
        _run.finish("failed", error=str(e.code) if e.code not in (None, 0) else "หยุดก่อนเทรนเสร็จ")
        raise
    except Exception as e:
        _run.finish("failed", error=f"{type(e).__name__}: {e}")
        raise
    _run.finish("succeeded", model_id=model_id)


if __name__ == "__main__":
    run()
