# แบ่งชุดเทรน/ชุดเทสของคลิป (ตามผู้แสดง) ที่แอดมินตั้งในหน้าผู้ใช้

import json
import threading
from collections import defaultdict

import numpy as np
from sqlalchemy import func, select

from app.core.config import ML_DIR
from app.db.models import AppSetting, Contributor, Sample, Word
from app.db.session import SessionLocal

# ชุดเทสของคลิปที่อัดผ่านระบบ: แอดมินตั้งทีละคนที่หน้าผู้ใช้ (ล่ามตัวจริง = ทดสอบ, คนในทีม = เทรน)
#   เก็บรายชื่อคนที่เป็นชุดเทสในตาราง app_settings key = test_split และเลือกรายคลิปได้ (คอลัมน์ samples.split)
#   ชุด TSL ไม่ใช้ค่านี้ — train.py สุ่มผู้แสดง 20% ของแต่ละชุดเอง
SETTING_KEY = "test_split"
# รูปแบบรหัสผู้แสดงของคลิปที่อัดผ่านระบบ (ต้องตรงกับ train.py load_recorded)
RECORDED_PREFIX = "ล่าม:"
UNKNOWN_SIGNER = "ไม่ระบุ"
RECORDED_SOURCE = "ล่าม"

# ค่าที่ต้องตรงกับ ml/src/train.py (split_test, load_tsl, load_recorded) เพื่อให้หน้าเว็บแสดงชุดเทสตรงกับตอนเทรน
TSL_PATH = ML_DIR / "data" / "processed" / "tsl_skeleton.npz"
TRAIN_SETTINGS_PATH = ML_DIR / "configs" / "train_words.json"
NULL_LABEL = "ไม่ทำท่า"
SEED = 7
VAL_SIGNER_RATIO = 0.2

# cache แถวของชุด TSL: (เวลาแก้ไขไฟล์, [(ผู้แสดง, แหล่ง, คำ), ...])
_tsl_cache: tuple[float, list[tuple[str, str, str]]] | None = None
_lock = threading.Lock()


# ผู้แสดงที่แอดมินเลือกไว้เป็นชุดเทส
def selected_signers() -> list[str]:
    with SessionLocal() as db:
        row = db.get(AppSetting, SETTING_KEY)
    return list((row.value or {}).get("signers", [])) if row else []


# บันทึกผู้แสดงที่เลือกเป็นชุดเทส
def set_selected_signers(signers: list[str]) -> list[str]:
    clean = sorted({s.strip() for s in signers if s and s.strip()})
    with SessionLocal() as db:
        row = db.get(AppSetting, SETTING_KEY)
        if row is None:
            db.add(AppSetting(key=SETTING_KEY, value={"signers": clean}))
        else:
            row.value = {"signers": clean}
        db.commit()
    return clean


# รายการ (ผู้แสดง, แหล่ง, คำ) ของทุกคลิปในชุด TSL (ไม่มีไฟล์ = ว่าง)
def _tsl_rows() -> list[tuple[str, str, str]]:
    global _tsl_cache
    if not TSL_PATH.is_file():
        return []
    mtime = TSL_PATH.stat().st_mtime
    with _lock:
        if _tsl_cache is None or _tsl_cache[0] != mtime:
            with np.load(TSL_PATH, allow_pickle=False) as d:
                rows = list(zip(map(str, d["signer"]), map(str, d["source"]), map(str, d["label"])))
            _tsl_cache = (mtime, rows)
        return _tsl_cache[1]


# ตั้งค่าการเทรน (include_null_class, min_recorded_clips) ไม่มีไฟล์ = ค่าเริ่มต้น
def _train_settings() -> dict:
    try:
        return json.loads(TRAIN_SETTINGS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


# สุ่มผู้แสดงชุด TSL เข้าชุดเทส แบบเดียวกับ train.py split_test (seed เดียวกัน ได้คนเดียวกัน)
def _random_tsl_signers(pools: dict[str, set[str]]) -> set[str]:
    rng = np.random.default_rng(SEED)
    out: set[str] = set()
    for src in sorted(pools):
        pool = sorted(pools[src])
        if len(pool) >= 2:
            out |= {str(s) for s in rng.choice(pool, max(1, round(len(pool) * VAL_SIGNER_RATIO)), replace=False)}
    return out


# ภาพรวมชุดเทส (ดูอย่างเดียว): ใครอยู่ในชุดเทสของการเทรนครั้งถัดไป เพราะอะไร คลิป/คำกี่ตัว และคำที่ไม่มีคลิปทดสอบ
#   ชุด TSL = สุ่ม 20% · คลิปที่อัดผ่านระบบ = ตามคนที่ตั้งในหน้าผู้ใช้ หรือรายคลิป
#   (ใกล้เคียงกับตอนเทรนจริง ต่างได้เล็กน้อยถ้าบางคลิปอ่านท่าไม่ได้ตอนเทรน)
def overview() -> dict:
    cfg = _train_settings()
    include_null = cfg.get("include_null_class", True)
    min_clips = cfg.get("min_recorded_clips", 5)
    with SessionLocal() as db:
        train_words = set(db.scalars(select(Word.word).where(Word.in_train_set.is_(True))).all())
        recorded = db.execute(
            select(Sample.split, Word.word, Contributor.name)
            .join(Word, Word.id == Sample.word_id)
            .outerjoin(Contributor, Contributor.id == Sample.contributor_id)
            .where(Sample.status != "rejected", Sample.source.in_(("record", "upload")))
        ).all()
    test_people = set(selected_signers())

    # คลิปที่เข้าเทรน: (ผู้แสดง, แหล่ง, คำ, ตั้งเป็นทดสอบรายคลิป)
    clips: list[tuple[str, str, str, bool]] = [
        (s, src, label, False) for s, src, label in _tsl_rows() if label in train_words or (include_null and label == NULL_LABEL)
    ]
    per_word_recorded: dict[str, int] = defaultdict(int)
    for _split, word, _name in recorded:
        per_word_recorded[word] += 1
    for split, word, name in recorded:
        if per_word_recorded[word] >= min_clips:
            clips.append((signer_id(name), RECORDED_SOURCE, word, split == "test"))

    pools: dict[str, set[str]] = defaultdict(set)
    for s, src, _label, _t in clips:
        if src != RECORDED_SOURCE:
            pools[src].add(s)
    randomly = _random_tsl_signers(pools)
    by_user = {s for s, src, *_ in clips if src == RECORDED_SOURCE} & test_people

    n: dict[tuple[str, str], int] = defaultdict(int)
    n_test: dict[tuple[str, str], int] = defaultdict(int)
    words: dict[tuple[str, str], set] = defaultdict(set)
    per_word: dict[str, list[int]] = defaultdict(lambda: [0, 0])  # คำ → [คลิปเทรน, คลิปสอบ]
    for s, src, label, clip_test in clips:
        is_test = s in randomly or s in by_user or clip_test
        n[(s, src)] += 1
        n_test[(s, src)] += is_test
        words[(s, src)].add(label)
        if label != NULL_LABEL:
            per_word[label][is_test] += 1

    signers = []
    for (s, src), count in n.items():
        reason = "random" if s in randomly else "user" if s in by_user else "clips" if n_test[(s, src)] else None
        signers.append({
            "id": s,
            "name": s.removeprefix(RECORDED_PREFIX),
            "source": src,
            "clips": count,
            "test_clips": n_test[(s, src)],
            "words": len(words[(s, src)] - {NULL_LABEL}),
            "test": reason is not None,
            "reason": reason,
        })
    signers.sort(key=lambda x: (not x["test"], x["source"] != RECORDED_SOURCE, x["source"], x["name"]))
    return {
        "signers": signers,
        "total_clips": len(clips),
        "test_clips": sum(n_test.values()),
        "words": len(per_word),
        "words_without_test": sorted(w for w, (_tr, te) in per_word.items() if te == 0),
        "words_without_train": sorted(w for w, (tr, _te) in per_word.items() if tr == 0),
    }


# รหัสผู้แสดงของคลิปที่ล่ามอัด จากชื่อผู้แสดง (ตรงกับ train.py load_recorded)
def signer_id(name: str | None) -> str:
    return RECORDED_PREFIX + ((name or "").strip() or UNKNOWN_SIGNER)


# ตั้งผู้แสดงที่ล่ามอัดหนึ่งคนให้เป็นชุดเทส (True) หรือชุดเทรน (False)
def set_signer_test(name: str | None, test: bool) -> None:
    sid = signer_id(name)
    selected = set(selected_signers())
    selected = selected | {sid} if test else selected - {sid}
    set_selected_signers(sorted(selected))


# จำนวนคลิปที่ล่ามอัด (ไม่นับที่ถูกปฏิเสธ) แยกตามชื่อผู้แสดง
def recorded_clip_counts() -> dict[str, int]:
    with SessionLocal() as db:
        rows = db.execute(
            select(Contributor.name, func.count(Sample.id))
            .join(Sample, Sample.contributor_id == Contributor.id)
            .where(Sample.status != "rejected", Sample.source.in_(("record", "upload")))
            .group_by(Contributor.name)
        ).all()
    return {name: n for name, n in rows}


# เติมชุดข้อมูลของคลิปที่ผู้ใช้แต่ละคนอัด (split = train/test, clips = จำนวนคลิป) ให้รายชื่อผู้ใช้
#   ผู้ใช้ทั่วไปไม่ได้เป็นผู้แสดง จึงเป็น None
def annotate_users(users: list[dict]) -> list[dict]:
    selected = set(selected_signers())
    counts = recorded_clip_counts()
    for u in users:
        performer = u.get("role") != "user"
        u["split"] = ("test" if signer_id(u["name"]) in selected else "train") if performer else None
        u["clips"] = counts.get(u["name"], 0) if performer else None
    return users


# ชุดข้อมูลของผู้แสดงที่ยังไม่มีชื่อ ("ไม่ระบุ") ไว้แสดงในหน้าอัดคลิปตอนยังไม่เลือกผู้แสดง
def unknown_signer_split() -> str:
    return "test" if signer_id(None) in set(selected_signers()) else "train"


# ตั้งคลิปที่ล่ามอัดหนึ่งคลิปเป็นชุดเทรน/ทดสอบ คืน False ถ้าไม่พบคลิป
def set_sample_split(sample_id: str, split: str) -> bool:
    with SessionLocal() as db:
        sample = db.get(Sample, sample_id)
        if sample is None:
            return False
        sample.split = split
        db.commit()
        return True
