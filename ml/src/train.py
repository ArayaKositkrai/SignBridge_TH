"""เทรนโมเดลแปลภาษามือจาก skeleton แล้วบันทึกเป็นเวอร์ชัน draft

ข้อมูลที่ใช้:
- ml/data/processed/tsl_skeleton.npz  (นำเข้าด้วย import_tsl.py) เฉพาะคำที่ words.in_train_set ใน database
- คลิปที่ล่ามอัดผ่านระบบ: ตาราง samples + ไฟล์ .npz ใน Supabase Storage (คำที่มีคลิปถึงจำนวนขั้นต่ำ)
ผลลัพธ์: ไฟล์ ml/models/model_signBridge_vX.Y.Z.npz + แถวในตาราง models (status = draft) และ model_words
        และอัปไฟล์โมเดลขึ้น Supabase Storage (models/) ให้ backend ทุกเครื่องดาวน์โหลดไปใช้ได้

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
import metrics as M  # noqa: E402
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
#   รวมไฟล์ใน Storage ทั้งที่ใช้อยู่และที่ลบแล้ว (models/deleted/) ไม่ให้ใช้เลขเวอร์ชันที่ลบไปซ้ำ
def next_version(conn) -> tuple[int, int, int]:
    names = [r[0] for r in conn.execute("SELECT file FROM models")] + [p.name for p in MODELS_PATH.iterdir()]
    try:
        names += list(db.list_names("models")) + list(db.list_names("models/deleted"))
    except Exception as e:  # noqa: BLE001 — อ่าน Storage ไม่ได้ ใช้แค่ข้อมูลในเครื่องและ database
        log(f"อ่านรายชื่อโมเดลใน Storage ไม่ได้ ({e})")
    found = [tuple(int(x) for x in m.groups()) for n in names if (m := VERSION_RE.match(n))]
    if not found:
        return (0, 0, 0)
    major, minor, patch = max(found)
    return (major, minor, patch + 1)


# ตัวบันทึกความคืบหน้าลงตาราง training_runs (หน้าแอดมิน → โมเดล → การเทรน อ่านจากตารางนี้) — None = ยังไม่ได้เริ่ม
_run: RunTracker | None = None
# ชื่อเวอร์ชันที่เพิ่งบันทึก (ไว้เขียนลงบันทึกการใช้งาน)
_LAST_VERSION: str | None = None


# พิมพ์ข้อความทันที และเก็บลง log ของการเทรนใน database ให้หน้าแอดมินเห็น
def log(msg: str):
    print(msg, flush=True)
    if _run:
        _run.log(msg)


# รายงานความคืบหน้า (ขั้น/รอบ/ค่า loss/ความแม่นยำ) ให้หน้าแอดมิน
def progress(**values):
    if _run:
        _run.progress(**values)


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
    np.savez_compressed(TSL_PATH, **merged)
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
    d = np.load(TSL_PATH, allow_pickle=False)
    pts, off = d["points"], d["offsets"]
    out = []
    for i, label in enumerate(d["label"]):
        label = str(label)
        if label in words or (include_null and label == NULL_LABEL):
            # ชุดข้อมูล TSL ไม่มีจุดใบหน้า (face = None)
            out.append((pts[off[i] : off[i + 1]], float(d["aspect"][i]), label, str(d["signer"][i]), str(d["source"][i]), None, False))
    return out


# โหลดคลิปที่ล่ามอัดผ่านระบบจาก database + Storage (เฉพาะคำที่มีคลิปพอ)
def load_recorded(conn, min_clips: int):
    out = []
    for c in db.recorded_samples(conn, min_clips):
        out.append((c["points"], c["aspect"], c["word"], "ล่าม:" + (c["signer"] or "ไม่ระบุ"), "ล่าม", c["face"], c.get("split") == "test"))
    if out:
        log(f"คลิปที่ล่ามอัด {len(out)} คลิป")
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
def fit(X, y, n_class, mean, std, epochs=EPOCHS, report=None, stage=None):
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
        progress(stage=stage or "final", epoch=ep + 1, epochs=epochs, loss=round(total / len(Xt), 4))
        if report and (ep + 1) % 10 == 0:
            report(ep + 1, total / len(Xt), model)
    return model


# วัดความแม่นยำ: ถูกอันดับ 1, อยู่ใน 3 อันดับแรก และความแม่นยำรายคำ
def evaluate(model, X, y, mean, std, labels):
    model.eval()
    with torch.no_grad():
        logits = model((torch.tensor(X) - torch.tensor(mean)) / torch.tensor(std))
    top3 = logits.topk(min(3, logits.shape[1]), 1).indices.numpy()  # คำน้อยกว่า 3 คำ = ใช้เท่าที่มี
    pred = top3[:, 0]
    per = {labels[c]: round(float((pred[y == c] == c).mean()), 3) for c in np.unique(y)}
    return float((pred == y).mean()), float((top3 == y[:, None]).any(1).mean()), per


# ความน่าจะเป็นของทุกคลาส (N, C) เป็น numpy สำหรับคำนวณตัวชี้วัด
def predict_probs(model, X, mean, std) -> np.ndarray:
    model.eval()
    with torch.no_grad():
        logits = model((torch.tensor(X) - torch.tensor(mean)) / torch.tensor(std))
    return torch.softmax(logits, 1).numpy()


# รหัสของชุดทดสอบ (ผู้แสดงที่กันไว้ + จำนวนคลิป) ใช้บอกว่าผลของแต่ละเวอร์ชันวัดด้วยชุดเดียวกันไหม
def test_set_id(val_signers: set[str], n_clips: int) -> str:
    import hashlib
    return hashlib.sha1(("|".join(sorted(val_signers)) + f"#{n_clips}").encode()).hexdigest()[:12]


# เลือกชุดทดสอบ (ใช้ร่วมกับ evaluate.py):
#   - คลิปที่อัดผ่านระบบ: ตามคนที่อัด — ตั้งที่ แอดมิน › ผู้ใช้ (ล่ามตัวจริง = ทดสอบ, คนในทีม = เทรน)
#     และคลิปที่แอดมินสลับเป็น "ทดสอบ" รายคลิปในหน้าคลังคำศัพท์
#   - ชุด TSL: สุ่มผู้แสดงประมาณ 20% ของแต่ละชุดข้อมูลเสมอ (seed คงที่ ได้คนเดิมถ้าข้อมูลไม่เปลี่ยน)
#   คืน (is_val ต่อคลิป, ผู้แสดงที่กันไว้, คำที่ทุกคลิปอยู่ในชุดทดสอบ)
def split_test(conn, signers, sources, clip_test, labels_raw, quiet: bool = False):
    recorded = {s for s, x in zip(signers, sources) if x == "ล่าม"}
    val_signers = db.test_signers(conn) & recorded
    n_recorded = len(val_signers)
    rng = np.random.default_rng(SEED)
    for src in sorted(set(sources) - {"ล่าม"}):
        pool = sorted({s for s, x in zip(signers, sources) if x == src})
        if len(pool) >= 2:
            val_signers |= set(rng.choice(pool, max(1, round(len(pool) * VAL_SIGNER_RATIO)), replace=False))
    if not quiet:
        log(f"ชุดทดสอบ: สุ่มผู้แสดง TSL {len(val_signers) - n_recorded} คน + คนที่อัดผ่านระบบที่ตั้งเป็นทดสอบ {n_recorded} คน"
            f" + กำหนดรายคลิป {sum(clip_test)} คลิป")
    is_val = np.array([s in val_signers or t for s, t in zip(signers, clip_test)])
    no_train = sorted({l for l, v in zip(labels_raw, is_val) if v} - {l for l, v in zip(labels_raw, is_val) if not v})
    return is_val, val_signers, no_train


# ดึงน้ำหนักจากโมเดล torch เป็น dict ของ numpy (ชื่อเดียวกับที่ features.predict_proba ใช้)
def export_weights(model, mean, std) -> dict:
    w = {k: v.detach().numpy().astype(np.float32) for k, v in model.state_dict().items()}
    w["mean"], w["std"] = mean.astype(np.float32), std.astype(np.float32)
    return w


# เทรนทั้งหมด: โหลดข้อมูล → แบ่งตามผู้แสดง → เทรน/วัดผล → เทรนด้วยข้อมูลทั้งหมด → บันทึกเวอร์ชัน draft
# บันทึก .npz แบบอะตอมิก: เขียนไฟล์ชั่วคราวก่อนแล้วค่อยเปลี่ยนชื่อ กันไฟล์โมเดลเสียถ้าโปรแกรมหยุดกลางคัน
def save_npz_atomic(path, **arrays):
    path = Path(path)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "wb") as f:
        np.savez(f, **arrays)
    os.replace(tmp, path)


def main():
    t0 = time.time()
    torch.set_num_threads(max(1, os.cpu_count() - 1))
    conn = db.connect()
    cfg = db.train_settings()
    words = db.train_words(conn)
    log("--- เริ่มเทรนโมเดลแปลภาษามือ ---")
    progress(stage="load")

    clips = load_tsl(words, cfg.get("include_null_class", True)) + load_recorded(conn, cfg.get("min_recorded_clips", 5))
    feats, labels_raw, signers, sources, clip_test = [], [], [], [], []
    n_face = 0
    for seq, aspect, label, signer, source, face, is_test in clips:
        f = F.clip_features(seq, aspect, face)
        n_face += face is not None and not np.isnan(face).all()
        if f is not None:
            feats.append(f)
            labels_raw.append(label)
            signers.append(signer)
            sources.append(source)
            clip_test.append(bool(is_test))
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

    is_val, val_signers, no_train = split_test(conn, signers, sources, clip_test, labels_raw)
    if no_train:
        log(f"คำเตือน: คำที่ทุกคลิปอยู่ในชุดทดสอบ (ไม่มีคลิปให้เทรนตอนวัดผล): {', '.join(no_train)}")
    metrics = {}
    full_metrics: dict = {}
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
        # ตัวชี้วัดละเอียด (precision/recall/F1 คำที่สับสนกัน เกณฑ์ความมั่นใจ แปลมั่วตอนไม่ได้ทำท่า) ดู metrics.py
        full_metrics = M.compute(predict_probs(model, X[is_val], mean, std), y[is_val], labels)
        full_metrics["test_set_id"] = test_set_id(val_signers, int(is_val.sum()))
        full_metrics["no_train_words"] = no_train
        fa = full_metrics["null_false_alarm"]
        log(f"Precision {full_metrics['precision']:.1%} · Recall {full_metrics['recall']:.1%} · F1 {full_metrics['f1']:.1%}"
            f" · เกณฑ์ความมั่นใจ {full_metrics['threshold']:.0%}"
            + (f" · แปลมั่วตอนไม่ได้ทำท่า {fa:.1%}" if fa is not None else ""))
        worst = sorted(per.items(), key=lambda kv: kv[1])[:5]
        log("คำที่ทายพลาดบ่อย: " + ", ".join(f"{k} {v:.0%}" for k, v in worst))

    # เทรนรอบสุดท้ายสำหรับใช้งานจริง: ไม่ใช้คลิปในชุดทดสอบ (held-out) ให้ Run Test วัดกับข้อมูลที่โมเดลไม่เคยเห็นจริง
    #   ตั้ง "final_train_on_all": true ใน train_words.json = เทรนด้วยข้อมูลทั้งหมดแบบเดิม (ได้ข้อมูลเพิ่ม แต่ Run Test จะเชื่อไม่ได้)
    final_all = bool(cfg.get("final_train_on_all", False)) or not is_val.any()
    train_mask = np.ones(len(X), bool) if final_all else ~is_val
    log("เทรนรอบสุดท้ายด้วยข้อมูลทั้งหมด…" if final_all else f"เทรนรอบสุดท้าย (ไม่รวมชุดทดสอบ {int(is_val.sum())} คลิป)…")
    Xf, yf = X[train_mask], y[train_mask]
    mean, std = Xf.reshape(-1, X.shape[2]).mean(0), Xf.reshape(-1, X.shape[2]).std(0) + 1e-6
    model = fit(Xf, yf, len(labels), mean, std, stage="final")
    if full_metrics:
        full_metrics["final_excludes_test"] = not final_all
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
    # threshold = เกณฑ์ความมั่นใจที่คำนวณจากชุดทดสอบ (ตัวแปลใช้ตัดสินว่าได้คำ) ไม่มีผลวัด = ค่าเริ่มต้น
    save_npz_atomic(path, labels=np.array(labels), feature_version=np.array(F.FEATURE_VERSION),
                    threshold=np.array(full_metrics.get("threshold", M.DEFAULT_THRESHOLD), dtype=np.float32), **weights)
    seconds = round(time.time() - t0, 1)

    # บันทึกเป็นเวอร์ชัน draft (draft เดิมกลายเป็น archived) พร้อมคำที่รู้จักและผลรายคำ
    per_word = metrics.get("val_per_word", {})
    try:
        db.ensure_model_columns(conn)
        with conn.transaction():
            conn.execute("UPDATE models SET status = 'archived' WHERE status = 'draft'")
            model_id = conn.execute(
                """
                INSERT INTO models (version, file, status, trained_at, samples, feature_version, val_accuracy,
                                    val_top3, val_clips, train_seconds, sources, bytes, metrics)
                VALUES (%s, %s, 'draft', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
                """,
                (
                    "v{}.{}.{}".format(*version), name, datetime.now().astimezone(), int(len(X)), str(F.FEATURE_VERSION),
                    metrics.get("val_accuracy"), metrics.get("val_top3"), metrics.get("val_clips"), seconds,
                    Jsonb(dict(Counter(sources))), path.stat().st_size,
                    Jsonb({"validation": full_metrics} if full_metrics else {}),
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

    # อัปไฟล์โมเดลขึ้น Storage (ไม่สำเร็จไม่ถือว่าเทรนล้ม ไฟล์ยังอยู่ในเครื่อง อัปทีหลังด้วย upload_models ได้)
    try:
        db.upload(db.model_storage_path(name), path.read_bytes())
        log(f"อัปไฟล์โมเดลขึ้น Storage แล้ว ({db.model_storage_path(name)})")
    except (Exception, SystemExit) as e:  # noqa: BLE001
        log(f"อัปไฟล์โมเดลขึ้น Storage ไม่สำเร็จ ({e}) — เครื่องอื่นจะยังใช้โมเดลนี้ไม่ได้ "
            "จนกว่าจะรัน: cd backend && python -m app.scripts.upload_models")
    log(f"--- เทรนเสร็จ: {name} ({seconds} วินาที) ---")
    global _LAST_VERSION
    _LAST_VERSION = "v{}.{}.{}".format(*version)
    return model_id


# สร้างท่าอวตารจากข้อมูลล่าสุดต่อท้ายการเทรน (ล้มเหลวไม่ถือว่าเทรนล้ม เพราะโมเดลบันทึกไปแล้ว) คืน True ถ้าสร้างสำเร็จ
def build_avatar_motions() -> bool:
    import contextlib

    import build_motions

    # ขั้นใหม่ล้างค่าความคืบหน้า จึงส่งค่าความแม่นยำต่อไปด้วย ไม่ให้หายจากหน้าแอดมิน
    keep = {k: _run.state[k] for k in ("val_accuracy", "val_top3") if _run and _run.state.get(k) is not None}
    progress(stage="motions", **keep)

    # build_motions ใช้ print จึงเปลี่ยนเส้นทางเข้า log ของการเทรนเพื่อให้เห็นบนหน้าแอดมิน
    class _ToLog:
        def write(self, text: str) -> int:
            for line in text.splitlines():
                if line.strip():
                    log(line)
            return len(text)

        def flush(self) -> None:
            pass

    try:
        with contextlib.redirect_stdout(_ToLog()):
            build_motions.main()
        ok = True
    except (Exception, SystemExit) as e:  # noqa: BLE001
        log(f"สร้างท่าอวตารไม่สำเร็จ ({e}) — กดปุ่ม 'สร้างท่าอวตาร' ที่หน้าคลังคำศัพท์เพื่อลองใหม่")
        ok = False
    # ให้หน้าเว็บรู้ผล (บันทึกลง database ตอน finish)
    progress(motions_ok=ok)
    return ok


# เขียนผลการเทรนลงหน้า "บันทึกการใช้งาน" (ตาราง activity_logs) เป็นภาษาคน เช่น "เทรนเสร็จ v0.0.15 · 5 นาที 41 วินาที"
#   บันทึกไม่ได้ไม่ถือว่าเทรนล้ม
def log_activity(action: str, detail: str | None, ok: bool, started: float) -> None:
    secs = int(time.time() - started)
    took = f"{secs // 60} นาที {secs % 60} วินาที" if secs >= 60 else f"{secs} วินาที"
    try:
        with db.connect() as conn:
            conn.execute(
                """
                INSERT INTO activity_logs (ts, user_id, actor, kind, action, detail, page, method, path, status)
                VALUES (now(), %s, 'แอดมิน', 'ฟังก์ชัน', %s, %s, '/admin/models', 'TRAIN', 'train.py', %s)
                """,
                (os.environ.get("TRAIN_STARTED_BY") or None, f"{action} · ใช้เวลา {took}"[:120],
                 (detail or "")[:200] or None, 200 if ok else 500),
            )
    except Exception as e:  # noqa: BLE001
        print(f"(บันทึกลงบันทึกการใช้งานไม่สำเร็จ: {e})", flush=True)


# เริ่มเทรนพร้อมบันทึกความคืบหน้า/ผลลงตาราง training_runs (หน้าแอดมินแสดงผลจากตารางนี้)
#   (ส่วนนี้เคยหายไปใน commit db55ab6 ทำให้หน้าแท็บการเทรนขึ้น "ยังไม่เคยเทรน" ตลอด)
def run():
    global _run
    parser = argparse.ArgumentParser(description="เทรนโมเดลแปลภาษามือ (ผลเป็นเวอร์ชัน draft ให้แอดมินเผยแพร่)")
    parser.add_argument("--force", action="store_true", help="เทรนแม้มีการเทรนอื่นที่ยังรันอยู่")
    args = parser.parse_args()
    _run = RunTracker(force=args.force)
    started = time.time()
    try:
        model_id = main()
    except KeyboardInterrupt:
        _run.finish("failed", error="ถูกยกเลิก (Ctrl+C)")
        log_activity("เทรนโมเดลถูกยกเลิก", None, False, started)
        raise
    except SystemExit as e:
        error = str(e.code) if e.code not in (None, 0) else "หยุดก่อนเทรนเสร็จ"
        _run.finish("failed", error=error)
        log_activity("เทรนโมเดลไม่สำเร็จ", error, False, started)
        raise
    except Exception as e:
        _run.finish("failed", error=f"{type(e).__name__}: {e}")
        log_activity("เทรนโมเดลไม่สำเร็จ", f"{type(e).__name__}: {e}", False, started)
        raise
    made = build_avatar_motions()
    _run.finish("succeeded", model_id=model_id)
    s = _run.state
    log_activity(f"เทรนเสร็จ ได้ {_LAST_VERSION or 'โมเดลใหม่'} (Draft)" + (" และอัปเดตท่าอวตาร" if made else ""),
                 f"ทายถูก {s['val_accuracy']:.1%}" if s.get("val_accuracy") is not None else None, True, started)


if __name__ == "__main__":
    run()
