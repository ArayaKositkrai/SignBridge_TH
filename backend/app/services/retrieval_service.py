import json
from functools import lru_cache
from pathlib import Path

from app.services.motion_library import get_motion

# ไฟล์คลังคำศัพท์ภาษามือ
DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "vocabulary.json"


# โหลดคลังคำศัพท์ครั้งเดียวแล้วจำไว้ในหน่วยความจำ
@lru_cache(maxsize=1)
def load_vocabulary() -> dict[str, dict]:
    entries = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    return {e["word"]: e for e in entries}


# ค้นหาคลิปและท่าทางของแต่ละคำ (ข้ามคำที่ไม่อยู่ในคลัง)
def find_clips(tokens: list[str]) -> list[dict]:
    vocab = load_vocabulary()
    clips = []
    for token in tokens:
        entry = vocab.get(token)
        if entry:
            clips.append(
                {
                    "gloss": entry["gloss"],
                    "word": entry["word"],
                    "url": entry["clip"],
                    "motion": get_motion(entry["gloss"]),
                }
            )
    return clips
