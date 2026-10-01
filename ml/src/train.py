"""เทรนโมเดลแปลภาษามือจาก skeleton แล้วบันทึกเป็นเวอร์ชัน draft

ข้อมูลที่ใช้:
- ml/data/processed/tsl_skeleton.npz  (นำเข้าด้วย import_tsl.py) เฉพาะคำใน ml/configs/train_words.json
- ml/data/raw/<คำ>/*.landmarks.json   คลิปที่ล่ามอัดผ่านระบบ (คำที่มีคลิปถึงจำนวนขั้นต่ำ)

ขั้นตอน: แปลงเป็น feature (features.py) → แบ่งชุดทดสอบตามผู้แสดง (คนที่ทดสอบไม่อยู่ในชุดเทรน)
→ เทรน CNN 1 มิติ วัดความแม่นยำ → เทรนใหม่ด้วยข้อมูลทั้งหมด → บันทึกน้ำหนักเป็น .npz (backend ใช้แค่ numpy)
"""
import json
import os
import random
import re
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

import numpy as np
import torch
from torch import nn

sys.path.insert(0, str(Path(__file__).resolve().parent))
import features as F  # noqa: E402

# โฟลเดอร์ ml (อ้างจากตำแหน่งไฟล์นี้)
ML_DIR = Path(__file__).resolve().parents[1]
# ไฟล์ตั้งค่าเวอร์ชันโมเดล
CONFIG_PATH = ML_DIR / "configs" / "model_config.json"
# รายการคำที่จะเทรน
WORDS_PATH = ML_DIR / "configs" / "train_words.json"
# ชุดข้อมูล TSL ที่นำเข้าแล้ว
TSL_PATH = ML_DIR / "data" / "processed" / "tsl_skeleton.npz"
# คลิปที่ล่ามอัด
RAW_PATH = ML_DIR / "data" / "raw"
# โฟลเดอร์เก็บไฟล์โมเดล
MODELS_PATH = ML_DIR / "models"
# ชื่อไฟล์โมเดลแบบมีเลขเวอร์ชัน
MODEL_NAME = "model_signBridge_v{}.{}.{}.npz"
# รูปแบบสำหรับอ่านเลขเวอร์ชันจากชื่อไฟล์ (ทุกนามสกุล)
VERSION_RE = re.compile(r"^model_signBridge_v(\d+)\.(\d+)\.(\d+)\.\w+$")
# ชื่อคลาสของคลิปที่ไม่ได้ทำท่า
NULL_LABEL = "ไม่ทำท่า"
# สัดส่วนภาพของคลิปที่อัดไว้ก่อนระบบบันทึกขนาดภาพ
DEFAULT_ASPECT = 1.0
# สัดส่วนผู้แสดงที่กันไว้ทดสอบ
VAL_SIGNER_RATIO = 0.2
# ค่าการเทรน
EPOCHS = 80
BATCH = 64
LR = 2e-3
SEED = 7


# อ่านไฟล์ตั้งค่าเวอร์ชันโมเดล
def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


# เขียนไฟล์ตั้งค่าแบบปลอดภัย (เขียนไฟล์ชั่วคราวแล้วแทนที่)
def save_config(data):
    tmp = CONFIG_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
    os.replace(tmp, CONFIG_PATH)


# หาเลขเวอร์ชันถัดไป: ยังไม่มี = 0.0.0, มีแล้ว = เลขท้ายของเวอร์ชันล่าสุด + 1
def next_version() -> tuple[int, int, int]:
    found = [tuple(int(x) for x in m.groups()) for p in MODELS_PATH.iterdir() if (m := VERSION_RE.match(p.name))]
    if not found:
        return (0, 0, 0)
    major, minor, patch = max(found)
    return (major, minor, patch + 1)


# พิมพ์ข้อความทันที (backend อ่าน log ระหว่างเทรน)
def log(msg: str):
    print(msg, flush=True)


# โหลดคลิปจากชุดข้อมูล TSL เฉพาะคำที่เลือก
def load_tsl(words: set[str], include_null: bool):
    if not TSL_PATH.is_file():
        log("ไม่พบ tsl_skeleton.npz (รัน import_tsl.py ก่อน) — ใช้เฉพาะคลิปที่ล่ามอัด")
        return []
    d = np.load(TSL_PATH, allow_pickle=False)
    pts, off = d["points"], d["offsets"]
    out = []
    for i, label in enumerate(d["label"]):
        label = str(label)
        if label in words or (include_null and label == NULL_LABEL):
            out.append((pts[off[i] : off[i + 1]], float(d["aspect"][i]), label, str(d["signer"][i]), str(d["source"][i])))
    return out


# โหลดคลิปที่ล่ามอัดผ่านระบบ (เฉพาะคำที่มีคลิปพอ)
def load_recorded(min_clips: int):
    out = []
    if not RAW_PATH.is_dir():
        return out
    for folder in sorted(RAW_PATH.iterdir()):
        files = sorted(folder.glob("*.landmarks.json")) if folder.is_dir() else []
        if len(files) < min_clips:
            continue
        for f in files:
            meta_file = f.with_name(f.name.replace(".landmarks.json", ".meta.json"))
            meta = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.is_file() else {}
            frames = json.loads(f.read_text(encoding="utf-8"))
            seq = np.stack([F.from_mediapipe(x.get("pose"), x.get("leftHand"), x.get("rightHand")) for x in frames])
            aspect = meta["width"] / meta["height"] if meta.get("width") and meta.get("height") else DEFAULT_ASPECT
            signer = "ล่าม:" + (meta.get("signer") or "ไม่ระบุ")
            out.append((seq, aspect, folder.name, signer, "ล่าม"))
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
    seq = torch.cat([pos, present], 2)
    a = torch.randint(0, t // 8 + 1, (b, 1)).float()
    e = (t - 1) - torch.randint(0, t // 8 + 1, (b, 1)).float()
    where = a + (e - a) * torch.linspace(0, 1, t)
    lo = where.floor().long().clamp(0, t - 1)
    hi = (lo + 1).clamp(max=t - 1)
    w = (where - lo.float()).unsqueeze(2)
    pick = lambda idx: torch.gather(seq, 1, idx.unsqueeze(2).expand(-1, -1, seq.shape[2]))
    seq = pick(lo) * (1 - w) + pick(hi) * w
    pos, present = seq[:, :, :n2], (seq[:, :, n2:] > 0.5).float()
    vel = torch.diff(pos, dim=1, prepend=pos[:, :1])
    return torch.cat([pos, present, vel], 2)


# เทรนโมเดลหนึ่งรอบ คืนโมเดลที่เทรนแล้ว
def fit(X, y, n_class, mean, std, epochs=EPOCHS, report=None):
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
    torch.set_num_threads(max(1, os.cpu_count() - 1))
    cfg = json.loads(WORDS_PATH.read_text(encoding="utf-8"))
    words = set(cfg["words"])
    log("--- เริ่มเทรนโมเดลแปลภาษามือ ---")

    clips = load_tsl(words, cfg.get("include_null_class", True)) + load_recorded(cfg.get("min_recorded_clips", 5))
    feats, labels_raw, signers, sources = [], [], [], []
    for seq, aspect, label, signer, source in clips:
        f = F.clip_features(seq, aspect)
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
    log(f"ข้อมูล {len(X)} คลิป · {len(labels)} คลาส · แหล่ง {dict(Counter(sources))}")
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

        model = fit(X[~is_val], y[~is_val], len(labels), mean, std, report=report)
        acc, top3, per = evaluate(model, X[is_val], y[is_val], mean, std, labels)
        metrics = {"val_accuracy": round(acc, 4), "val_top3": round(top3, 4), "val_per_word": per, "val_clips": int(is_val.sum())}
        log(f"ผลบนผู้แสดงใหม่: ถูก {acc:.1%} · ติด 3 อันดับ {top3:.1%}")
        worst = sorted(per.items(), key=lambda kv: kv[1])[:5]
        log("คำที่ทายพลาดบ่อย: " + ", ".join(f"{k} {v:.0%}" for k, v in worst))

    # เทรนใหม่ด้วยข้อมูลทั้งหมดสำหรับใช้งานจริง
    log("เทรนรอบสุดท้ายด้วยข้อมูลทั้งหมด…")
    mean, std = X.reshape(-1, X.shape[2]).mean(0), X.reshape(-1, X.shape[2]).std(0) + 1e-6
    model = fit(X, y, len(labels), mean, std)
    weights = export_weights(model, mean, std)

    # ตรวจว่าตัวคำนวณแบบ numpy ให้ผลเท่ากับ torch
    model.eval()
    with torch.no_grad():
        ref = torch.softmax(model((torch.tensor(X[:5]) - torch.tensor(mean)) / torch.tensor(std)), 1).numpy()
    got = np.stack([F.predict_proba(weights, x) for x in X[:5]])
    if not np.allclose(ref, got, atol=1e-4):
        raise SystemExit("ผลจาก numpy ไม่ตรงกับ torch")

    MODELS_PATH.mkdir(parents=True, exist_ok=True)
    version = next_version()
    name = MODEL_NAME.format(*version)
    np.savez(MODELS_PATH / name, labels=np.array(labels), feature_version=np.array(F.FEATURE_VERSION), **weights)
    info = {
        "version": "v{}.{}.{}".format(*version),
        "file": name,
        "trained_at": datetime.now().isoformat(timespec="seconds"),
        "words": {l: counts[l] for l in labels},
        "samples": int(len(X)),
        "sources": dict(Counter(sources)),
        "feature_version": F.FEATURE_VERSION,
        "seconds": round(time.time() - t0, 1),
        **metrics,
    }
    (MODELS_PATH / name).with_suffix(".json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")

    config = load_config()
    config["draft_version"] = name
    config["draft_words"] = [l for l in labels if l != NULL_LABEL]
    save_config(config)
    log(f"--- เทรนเสร็จ: {name} ({info['seconds']} วินาที) ---")


if __name__ == "__main__":
    main()
