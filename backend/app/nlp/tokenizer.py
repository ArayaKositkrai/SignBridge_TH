import json
from functools import lru_cache
from pathlib import Path

from app.services.retrieval_service import load_vocabulary

# ตัดข้อความภาษาไทยเป็นคำที่อวตารทำท่าได้ และแก้คำที่พิมพ์ผิด/คำเรียกอื่น
#   - คำในคลังตรงตัว: ใช้เลย
#   - คำเรียกอื่น (aliases.json เช่น โรงบาล → โรงพยาบาล): ใช้คำในคลังแทน
#   - คำภาษาไทยปกติที่อวตารยังไม่มีท่า (เช่น อยาก ผม): ไม่แก้ บอกผู้ใช้ว่ายังไม่มีท่า
#   - คำที่ไม่ใช่คำไทยและใกล้กับคำในคลัง (กืน → กิน, ขนมปุง → ขนมปัง): แก้ให้ และเสนอคำอื่นที่อาจหมายถึง
#   - ส่วนที่เหลือ: ส่งกลับเป็น unknown พร้อมคำใกล้เคียงให้ผู้ใช้กดเลือก
#   เลือกการตัดที่ "ผิดน้อยที่สุด" ทั้งข้อความ (dynamic programming) ไม่ใช่จับคำยาวสุดทีละคำ

# ไฟล์คำเรียกอื่น {คำที่คนพิมพ์: คำในคลัง} ทีมแก้ไขเพิ่มได้เอง
ALIASES_PATH = Path(__file__).with_name("aliases.json")
# คะแนนโทษ: ต่อคำ (ให้เลือกคำยาวก่อนคำสั้นหลายคำ), คำไทยที่ไม่มีท่า, ต่อตัวอักษรที่สะกดต่าง, ข้ามตัวอักษรที่ไม่รู้จัก
TOKEN_COST = 0.1
OTHER_WORD_COST = 0.4
EDIT_COST = 1.0
SKIP_COST = 1.2
# คำไทยในพจนานุกรมยาวสุดที่พิจารณา (ตัวอักษร)
MAX_DICT_WORD = 20
# จำนวนคำใกล้เคียงที่เสนอให้เลือก
MAX_SUGGESTIONS = 3

_alias_cache: tuple[float, dict[str, str]] | None = None


# พจนานุกรมคำไทยทั่วไป (PyThaiNLP) ไว้แยกคำไทยปกติออกจากคำที่พิมพ์ผิด ไม่มีไลบรารี = ว่าง (ยังแก้คำผิดได้ แต่ระวังน้อยลง)
@lru_cache(maxsize=1)
def thai_dictionary() -> frozenset[str]:
    try:
        from pythainlp.corpus import thai_words
    except ImportError:
        return frozenset()
    return frozenset(thai_words())


# อ่านคำเรียกอื่นจากไฟล์ (โหลดใหม่เมื่อไฟล์เปลี่ยน) ไม่มีไฟล์/อ่านไม่ได้ = ว่าง · คีย์ที่ขึ้นต้นด้วย _ คือคำอธิบาย
def _aliases() -> dict[str, str]:
    global _alias_cache
    try:
        mtime = ALIASES_PATH.stat().st_mtime
    except OSError:
        return {}
    if _alias_cache is None or _alias_cache[0] != mtime:
        try:
            data = json.loads(ALIASES_PATH.read_text(encoding="utf-8"))
            _alias_cache = (mtime, {str(k).strip(): str(v).strip() for k, v in data.items() if not str(k).startswith("_")})
        except (OSError, ValueError, AttributeError):
            _alias_cache = (mtime, {})
    return _alias_cache[1]


# จำนวนตัวอักษรที่ยอมให้สะกดต่างได้ ตามความยาวคำ (คำสั้นมากไม่เดา เพราะจะผิดง่าย)
def allowed_edits(n: int) -> int:
    return 0 if n < 3 else 1 if n <= 5 else 2 if n <= 8 else 3


# พยัญชนะของคำ (ก-ฮ) ไว้กันคำสั้นถูกแก้เป็นคำที่พยัญชนะต่างกัน เช่น ไก่ ≠ ไม่
def consonants(s: str) -> str:
    return "".join(c for c in s if "ก" <= c <= "ฮ")


# ระยะแก้ไข (Levenshtein) เกิน limit คืน limit + 1 ทันที
@lru_cache(maxsize=50_000)
def edit_distance(a: str, b: str, limit: int) -> int:
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        if min(cur) > limit:
            return limit + 1
        prev = cur
    return prev[-1]


# คำในคลังที่ใกล้เคียงกับข้อความ sub (เรียงจากใกล้สุด) [(ระยะ, คำ)]
#   extra = ยอมให้ต่างมากขึ้น (ใช้ตอนเสนอคำให้ผู้ใช้เลือก ไม่ได้แก้ให้เอง)
#   แก้ให้เอง (extra = 0): คำสั้น (≤ 4 ตัวอักษร) ต้องมีพยัญชนะเหมือนกัน ต่างแค่สระ/วรรณยุกต์
def similar(sub: str, words: list[str], extra: int = 0) -> list[tuple[int, str]]:
    chars = set(sub)
    out = []
    for w in words:
        a = allowed_edits(len(w)) + extra
        if a <= 0 or abs(len(w) - len(sub)) > a or len(set(w) - chars) > a:
            continue
        if not extra and len(w) <= 4 and consonants(w) != consonants(sub):
            continue
        d = edit_distance(sub, w, a)
        if d <= a:
            out.append((d, w))
    out.sort(key=lambda x: (x[0], -len(x[1])))
    return out


# วิเคราะห์ข้อความ คืน
#   tokens   คำในคลังที่ใช้ทำท่า (ตามลำดับ)
#   fixes    คำที่แก้ให้ [{typed, word, kind: typo|alias, alternatives}]
#   no_sign  คำไทยปกติที่อวตารยังไม่มีท่า (ข้ามไป)
#   unknown  ส่วนที่อ่านไม่ออก [{text, suggestions}]
def analyze(text: str) -> dict:
    vocab = set(load_vocabulary())
    aliases = {k: v for k, v in _aliases().items() if v in vocab}
    dictionary = thai_dictionary()
    words = sorted(vocab, key=len, reverse=True)
    # คำในคลังมาก่อนคำเรียกอื่นเสมอ (คำเรียกอื่นที่ซ้ำกับคำในคลังไม่มีผล)
    exact = {**aliases, **{w: w for w in vocab}}
    max_len = max(MAX_DICT_WORD, max((len(k) for k in exact), default=0) + 3)
    tokens: list[str] = []
    fixes: list[dict] = []
    no_sign: list[str] = []
    unknown: list[dict] = []

    for chunk in text.split():
        n = len(chunk)
        # best[i] = (คะแนนโทษรวม, จุดก่อนหน้า, รายการ) ของการตัด chunk[:i]
        best: list[tuple[float, int, tuple] | None] = [None] * (n + 1)
        best[0] = (0.0, -1, ())
        for i in range(n):
            if best[i] is None:
                continue
            base = best[i][0]

            def push(j: int, cost: float, item: tuple, i=i, base=base):
                if best[j] is None or base + cost < best[j][0]:
                    best[j] = (base + cost, i, item)

            push(i + 1, SKIP_COST, ("skip", chunk[i]))
            for j in range(i + 1, min(n, i + max_len) + 1):
                sub = chunk[i:j]
                if sub in exact:
                    push(j, TOKEN_COST, ("word", sub, exact[sub], 0))
                elif len(sub) >= 2 and sub in dictionary:
                    push(j, OTHER_WORD_COST, ("other", sub))
                else:
                    for d, w in similar(sub, words)[:1]:
                        push(j, TOKEN_COST + EDIT_COST * d, ("word", sub, w, d))

        # ย้อนรอยผลการตัด
        items = []
        j = n
        while j > 0:
            _cost, i, item = best[j]
            items.append(item)
            j = i
        items.reverse()

        pending = ""
        for item in items + [("end",)]:
            if item[0] == "skip":
                pending += item[1]
                continue
            if pending.strip():
                # เสนอคำใกล้เคียงเฉพาะเมื่อเป็นตัวอักษรไทย (ตัวอักษรอื่นเดาไม่ได้)
                thai = any("\u0e01" <= c <= "\u0e4e" for c in pending)
                sugg = [w for _d, w in similar(pending, words, extra=2)[:MAX_SUGGESTIONS]] if thai else []
                unknown.append({"text": pending, "suggestions": sugg})
            pending = ""
            if item[0] == "other":
                no_sign.append(item[1])
            elif item[0] == "word":
                _, typed, word, d = item
                tokens.append(word)
                if typed != word:
                    alts = [w for _d, w in similar(typed, words, extra=1) if w != word][:MAX_SUGGESTIONS]
                    fixes.append({"typed": typed, "word": word, "kind": "alias" if d == 0 else "typo", "alternatives": alts})
    return {"tokens": tokens, "fixes": fixes, "no_sign": no_sign, "unknown": unknown}


# ตัดข้อความเป็นรายการคำ (ใช้ตรงอื่นที่ต้องการแค่คำ)
def tokenize(text: str) -> list[str]:
    return analyze(text)["tokens"]
