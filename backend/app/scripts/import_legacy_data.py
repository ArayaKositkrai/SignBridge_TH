import json
import sys
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.core.config import ML_DIR, MODELS_DIR
from app.db.models import Model, ModelWord, Motion, Word, WordExternalSource
from app.db.session import SessionLocal
from app.services.motion_library import MOTIONS

# นำข้อมูลจากไฟล์เดิม (ก่อนย้ายขึ้น database) เข้าตาราง words, word_external_sources, motions
# และโมเดลที่อยู่ใน ml/models ของเครื่องนี้ (ไฟล์ .npz + .json คู่กัน) เข้าตาราง models, model_words
# รันครั้งเดียวหลังสร้างตาราง รันซ้ำได้ (อัปเดตทับ ไม่เพิ่มแถวซ้ำ)
# วิธีใช้ (ในโฟลเดอร์ backend): python -m app.scripts.import_legacy_data

ROOT = ML_DIR.parent
VOCAB_PATH = ML_DIR / "configs" / "vocabulary.json"  # คลังคำ (Excel + TSL)
TRAIN_WORDS_PATH = ML_DIR / "configs" / "train_words.json"  # คำที่เทรน
AVATAR_VOCAB_PATH = ROOT / "backend" / "app" / "data" / "vocabulary.json"  # คำของอวตาร (gloss)
MOTIONS_PATH = ROOT / "backend" / "app" / "data" / "motions.json"  # ท่าจากข้อมูลจริง
MODEL_CONFIG_PATH = ML_DIR / "configs" / "model_config.json"  # เวอร์ชัน active / draft
NULL_LABEL = "ไม่ทำท่า"
SOURCE_KEYS = {"TSL-51": "tsl51", "TSL-ONE-S": "tsl_one"}


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        print(f"  ไม่พบหรืออ่านไม่ได้: {path}")
        return default


def main() -> None:
    vocab = read_json(VOCAB_PATH, [])
    avatar = {v["word"]: v for v in read_json(AVATAR_VOCAB_PATH, [])}
    train = set(read_json(TRAIN_WORDS_PATH, {}).get("words", []))
    extracted = read_json(MOTIONS_PATH, {}).get("motions", {})

    rows = {
        v["word"]: {"word": v["word"], "category": v.get("category"), "priority": v.get("priority"),
                    "note": v.get("note"), "to_record": bool(v.get("to_record"))}
        for v in vocab
    }
    for word in avatar.keys() | train | extracted.keys() | MOTIONS.keys():
        rows.setdefault(word, {"word": word, "category": None, "priority": None, "note": None, "to_record": False})
    for r in rows.values():
        a = avatar.get(r["word"])
        has_motion = r["word"] in extracted or r["word"] in MOTIONS
        r["gloss"] = a["gloss"] if a else (r["word"] if has_motion else None)
        r["clip_url"] = a.get("clip") if a else None
        r["in_train_set"] = r["word"] in train

    with SessionLocal() as db:
        stmt = insert(Word).values(list(rows.values()))
        db.execute(stmt.on_conflict_do_update(
            index_elements=[Word.word],
            set_={c: stmt.excluded[c] for c in ("gloss", "category", "priority", "note", "to_record", "clip_url", "in_train_set")},
        ))
        ids = dict(db.execute(select(Word.word, Word.id)).all())

        ext = [
            {"word_id": ids[v["word"]], "source": SOURCE_KEYS[src], "clips": e["clips"], "contributors": e["signers"]}
            for v in vocab for src, e in (v.get("external") or {}).items()
        ]
        if ext:
            stmt = insert(WordExternalSource).values(ext)
            db.execute(stmt.on_conflict_do_update(
                index_elements=[WordExternalSource.word_id, WordExternalSource.source],
                set_={"clips": stmt.excluded.clips, "contributors": stmt.excluded.contributors},
            ))

        # ท่า: ข้อมูลจริงก่อน (ใช้สีหน้าของท่าเขียนมือถ้ามี) ไม่มีค่อยใช้ท่าเขียนมือ
        motions = []
        for word in extracted.keys() | MOTIONS.keys():
            hand = MOTIONS.get(word)
            if word in extracted:
                m, src = extracted[word], extracted[word].get("source") or {}
                motions.append({"word_id": ids[word], "duration_ms": m["duration"], "frames": m["frames"],
                                "face": hand["face"] if hand else [], "source": "extracted",
                                "source_dataset": src.get("dataset"), "source_contributor": src.get("signer"),
                                "source_clip": src.get("clip")})
            else:
                motions.append({"word_id": ids[word], "duration_ms": hand["duration"], "frames": hand["frames"],
                                "face": hand["face"], "source": "handmade", "source_dataset": None,
                                "source_contributor": None, "source_clip": None})
        if motions:
            stmt = insert(Motion).values(motions)
            db.execute(stmt.on_conflict_do_update(
                index_elements=[Motion.word_id],
                set_={c: stmt.excluded[c] for c in ("duration_ms", "frames", "face", "source", "source_dataset",
                                                     "source_contributor", "source_clip")},
            ))
        n_models = import_models(db, ids)
        db.commit()

    n_ext = sum(m["source"] == "extracted" for m in motions)
    print(f"words: {len(rows)} คำ (อวตาร {sum(r['gloss'] is not None for r in rows.values())}, เทรน {len(train)})")
    print(f"word_external_sources: {len(ext)} แถว")
    print(f"motions: {len(motions)} ท่า (ข้อมูลจริง {n_ext}, เขียนมือ {len(motions) - n_ext})")
    print(f"models: {n_models} เวอร์ชัน (จากไฟล์ใน {MODELS_DIR})")


# โมเดลในเครื่องนี้: ข้อมูลจากไฟล์ .json ข้างไฟล์โมเดล สถานะจาก model_config.json (ที่เหลือเป็น archived)
def import_models(db, ids: dict[str, int]) -> int:
    config = read_json(MODEL_CONFIG_PATH, {})
    status_of = {config.get("active_version"): "active", config.get("draft_version"): "draft"}
    n = 0
    for path in sorted(MODELS_DIR.glob("*.npz")) if MODELS_DIR.is_dir() else []:
        info = read_json(path.with_suffix(".json"), None)
        if not info or db.scalar(select(Model.id).where(Model.file == path.name)):
            continue
        status = status_of.get(path.name, "archived")
        if status != "archived" and db.scalar(select(Model.id).where(Model.status == status)):
            status = "archived"  # มี active/draft ใน database อยู่แล้ว ไม่ทับ
        model = Model(
            version=info.get("version") or path.stem, file=path.name, status=status, trained_at=info.get("trained_at"),
            samples=info.get("samples"), feature_version=str(info.get("feature_version")),
            val_accuracy=info.get("val_accuracy"), val_top3=info.get("val_top3"), val_clips=info.get("val_clips"),
            train_seconds=info.get("seconds"), sources=info.get("sources"), bytes=path.stat().st_size,
        )
        db.add(model)
        db.flush()
        per_word = info.get("val_per_word", {})
        for word, clips in (info.get("words") or {}).items():
            if word == NULL_LABEL:
                continue
            if word not in ids:
                row = Word(word=word)
                db.add(row)
                db.flush()
                ids[word] = row.id
            db.add(ModelWord(model_id=model.id, word_id=ids[word], train_clips=clips, val_accuracy=per_word.get(word)))
        n += 1
    return n


if __name__ == "__main__":
    sys.exit(main())
