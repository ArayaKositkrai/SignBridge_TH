import threading
from collections import defaultdict

import numpy as np
from sqlalchemy import select

from app.core.config import ML_DIR
from app.db.models import AppSetting, Contributor, Sample, Word
from app.db.session import SessionLocal

# ชุดทดสอบโมเดล: แอดมินเลือก "ผู้แสดง" ที่กันไว้ทดสอบ (เก็บในตาราง app_settings key = test_split)
#   และเลือกรายคลิปของคลิปที่ล่ามอัดได้ด้วย (คอลัมน์ samples.split) — train.py อ่านทั้งสองอย่าง
#   ไม่เลือกผู้แสดงเลย = train.py สุ่ม 20% ของผู้แสดงในแต่ละชุดข้อมูลแบบเดิม
SETTING_KEY = "test_split"
# ชุดข้อมูล TSL ที่นำเข้าแล้ว (อ่านแค่ชื่อผู้แสดง/คำ ไม่โหลดท่า)
TSL_PATH = ML_DIR / "data" / "processed" / "tsl_skeleton.npz"
# ชื่อแหล่งของคลิปที่ล่ามอัด และรูปแบบรหัสผู้แสดง (ต้องตรงกับ train.py load_recorded)
RECORDED_SOURCE = "ล่าม"
RECORDED_PREFIX = "ล่าม:"
UNKNOWN_SIGNER = "ไม่ระบุ"

# cache ผู้แสดงในชุด TSL: (เวลาแก้ไขไฟล์, [(ผู้แสดง, แหล่ง, คำ), ...])
_tsl_cache: tuple[float, list[tuple[str, str, str]]] | None = None
_lock = threading.Lock()


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


# ผู้แสดงที่แอดมินเลือกไว้เป็นชุดทดสอบ
def selected_signers() -> list[str]:
    with SessionLocal() as db:
        row = db.get(AppSetting, SETTING_KEY)
    return list((row.value or {}).get("signers", [])) if row else []


# บันทึกผู้แสดงที่เลือกเป็นชุดทดสอบ (รายการว่าง = กลับไปสุ่มอัตโนมัติ)
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


# สรุปผู้แสดงทุกคน (เฉพาะคำที่เลือกไว้เทรน) พร้อมจำนวนคลิป/คำ และสถานะว่าถูกเลือกเป็นชุดทดสอบไหม
#   พร้อมคำเตือน: คำที่ไม่มีคลิปทดสอบเลย / คำที่คลิปทั้งหมดอยู่ในชุดทดสอบ (เทรนไม่ได้)
def overview() -> dict:
    with SessionLocal() as db:
        train_words = set(db.scalars(select(Word.word).where(Word.in_train_set.is_(True))).all())
        recorded = db.execute(
            select(Sample.id, Sample.split, Word.word, Contributor.name)
            .join(Word, Word.id == Sample.word_id)
            .outerjoin(Contributor, Contributor.id == Sample.contributor_id)
            .where(Sample.status != "rejected", Sample.source.in_(("record", "upload")))
        ).all()
    selected = set(selected_signers())

    clips: dict[tuple[str, str], int] = defaultdict(int)
    words: dict[tuple[str, str], set] = defaultdict(set)
    # คำ → จำนวนคลิป (เทรน, ทดสอบ) ตามการเลือกปัจจุบัน (ใช้หาคำที่ไม่มีชุดทดสอบ)
    per_word: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for signer, source, label in _tsl_rows():
        if label not in train_words:
            continue
        clips[(signer, source)] += 1
        words[(signer, source)].add(label)
        per_word[label][signer in selected] += 1
    clip_tests = 0
    for _sid, split, word, name in recorded:
        signer = RECORDED_PREFIX + (name or UNKNOWN_SIGNER)
        clips[(signer, RECORDED_SOURCE)] += 1
        words[(signer, RECORDED_SOURCE)].add(word)
        is_test = signer in selected or split == "test"
        clip_tests += split == "test"
        if word in train_words:
            per_word[word][is_test] += 1

    signers = [
        {
            "id": signer,
            "name": signer.removeprefix(RECORDED_PREFIX),
            "source": source,
            "clips": n,
            "words": len(words[(signer, source)]),
            "test": signer in selected,
        }
        for (signer, source), n in clips.items()
    ]
    signers.sort(key=lambda s: (s["source"] != RECORDED_SOURCE, s["source"], s["name"]))
    return {
        "mode": "manual" if selected or clip_tests else "auto",
        "signers": signers,
        "recorded_test_clips": clip_tests,
        "words_without_test": sorted(w for w, (tr, te) in per_word.items() if te == 0) if selected or clip_tests else [],
        "words_without_train": sorted(w for w, (tr, te) in per_word.items() if tr == 0),
    }


# ตั้งคลิปที่ล่ามอัดหนึ่งคลิปเป็นชุดเทรน/ทดสอบ คืน False ถ้าไม่พบคลิป
def set_sample_split(sample_id: str, split: str) -> bool:
    with SessionLocal() as db:
        sample = db.get(Sample, sample_id)
        if sample is None:
            return False
        sample.split = split
        db.commit()
        return True
