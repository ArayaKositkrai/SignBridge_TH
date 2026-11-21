"""คำนวณตัวชี้วัดของโมเดลจากความน่าจะเป็นที่ทายบนชุดเทส — ใช้ร่วมกันทั้ง train.py (ตอนเทรน) และ evaluate.py (Run Test)

ใช้แค่ numpy ผลเป็น dict ที่เก็บลงคอลัมน์ models.metrics ได้ตรง ๆ:
    accuracy, top3                       ทายถูกอันดับ 1 / ติด 3 อันดับแรก
    precision, recall, f1                เฉลี่ยทุกคำ (macro ไม่นับคลาส "ไม่ทำท่า") คำที่มีคลิปเยอะไม่กลบคำที่มีคลิปน้อย
    per_word                             ต่อคำ: recall (ทายคำนี้ถูกกี่ %), precision, f1, จำนวนคลิป
    confusions                           คู่คำที่ทายสลับกันบ่อย (คำจริง → ทายเป็น) แทน confusion matrix ที่ใหญ่เกินจะอ่าน
    threshold                            เกณฑ์ความมั่นใจขั้นต่ำที่ให้ผลดีที่สุดบนชุดเทส (ตัวแปลใช้ตัดสินว่า "ได้คำ")
    threshold_curve                      ผลของแต่ละเกณฑ์ (ไว้วาดกราฟ)
    null_false_alarm                     ตอนไม่ได้ทำท่า ระบบพูดเป็นคำกี่ % (ที่เกณฑ์ที่เลือก) — None ถ้าไม่มีคลาส "ไม่ทำท่า"
    word_dropped                         ตอนทำท่าจริง ระบบไม่พูดอะไรกี่ % (ทายเป็น "ไม่ทำท่า" หรือมั่นใจไม่ถึงเกณฑ์)
    false_alarm_words                    ตอนไม่ได้ทำท่า คำไหนเผลอขึ้นมาบ่อยที่สุด (ที่เกณฑ์ที่เลือก)
    dropped_words                        ต่อคำ: ทำท่าคำนี้แล้วระบบเงียบ (ไม่ขึ้นคำ) กี่ครั้ง / กี่ %
    confidence                           ฮิสโตแกรมความมั่นใจของคำที่ทาย แยกตอนทายถูก/ผิด
"""
import numpy as np

NULL_LABEL = "ไม่ทำท่า"
# เกณฑ์ความมั่นใจที่ลอง (เลือกตัวที่ F1 ของคำที่ระบบพูดออกมาสูงสุด)
THRESHOLDS = [round(float(t), 2) for t in np.arange(0.20, 0.901, 0.05)]
# เกณฑ์เริ่มต้นเมื่อคำนวณไม่ได้ (ตรงกับ WORD_PROB ของ backend)
DEFAULT_THRESHOLD = 0.45
# จำนวนช่องของฮิสโตแกรมความมั่นใจ (0-10%, 10-20%, …)
CONF_BINS = 10
# เก็บคู่คำที่สับสนกันไม่เกินเท่านี้ และต้องเกิดอย่างน้อยกี่ครั้ง
MAX_CONFUSIONS = 30
MIN_CONFUSION_COUNT = 2


def _safe_div(a: float, b: float) -> float:
    return a / b if b else 0.0


def _r(v: float | None, n: int = 4) -> float | None:
    return None if v is None else round(float(v), n)


# ผลของเกณฑ์หนึ่งค่า: ระบบ "พูด" คำเมื่อคำอันดับ 1 (ไม่นับไม่ทำท่า) มั่นใจถึงเกณฑ์ และอันดับ 1 จริงไม่ใช่ "ไม่ทำท่า"
def _at_threshold(probs: np.ndarray, y: np.ndarray, null: int | None, t: float) -> dict:
    pred = probs.argmax(1)
    conf = probs[np.arange(len(probs)), pred]
    spoken = conf >= t
    if null is not None:
        spoken &= pred != null
    is_word = y != null if null is not None else np.ones(len(y), bool)
    correct = spoken & (pred == y)
    precision = _safe_div(correct.sum(), spoken.sum())
    recall = _safe_div(correct.sum(), is_word.sum())
    return {
        "threshold": t,
        "precision": precision,
        "recall": recall,
        "f1": _safe_div(2 * precision * recall, precision + recall),
        "null_false_alarm": float(spoken[~is_word].mean()) if (~is_word).any() else None,
        "word_dropped": float((~spoken[is_word]).mean()) if is_word.any() else None,
    }


# แยกรายคำ ณ เกณฑ์ t: คำที่เผลอขึ้นตอนไม่ได้ทำท่า และคำที่ทำท่าแล้วระบบเงียบ (เรียงจากบ่อยสุด)
def _silence_breakdown(probs: np.ndarray, y: np.ndarray, labels: list[str], null: int | None, t: float) -> tuple[list, list]:
    pred = probs.argmax(1)
    conf = probs[np.arange(len(probs)), pred]
    spoken = conf >= t
    if null is not None:
        spoken &= pred != null
    is_word = y != null if null is not None else np.ones(len(y), bool)

    false_alarm = []
    idle = ~is_word
    if idle.any():
        hits = pred[idle & spoken]
        for c in np.unique(hits):
            cnt = int((hits == c).sum())
            false_alarm.append({"word": labels[c], "count": cnt, "rate": _r(cnt / idle.sum(), 3)})
        false_alarm.sort(key=lambda r: -r["count"])

    dropped = []
    for c in np.unique(y[is_word]):
        mask = y == c
        cnt = int((mask & ~spoken).sum())
        if cnt:
            dropped.append({"word": labels[c], "count": cnt, "clips": int(mask.sum()), "rate": _r(cnt / mask.sum(), 3)})
    dropped.sort(key=lambda r: (-r["rate"], -r["count"]))
    return false_alarm, dropped


# ตัวชี้วัดทั้งหมดจากความน่าจะเป็น probs (N, C) ป้ายจริง y (N,) และรายชื่อคลาส labels
def compute(probs: np.ndarray, y: np.ndarray, labels: list[str]) -> dict:
    probs = np.asarray(probs, dtype=np.float64)
    y = np.asarray(y)
    n = len(y)
    if n == 0:
        return {}
    null = labels.index(NULL_LABEL) if NULL_LABEL in labels else None
    order = np.argsort(-probs, axis=1)
    pred = order[:, 0]
    top3 = order[:, :3]

    # ต่อคำ (ไม่นับคลาสไม่ทำท่า): precision = ทายเป็นคำนี้แล้วถูก, recall = คลิปของคำนี้ทายถูก
    per_word = {}
    for c in np.unique(np.concatenate([y, pred])):
        if c == null:
            continue
        tp = int(((pred == c) & (y == c)).sum())
        support = int((y == c).sum())
        predicted = int((pred == c).sum())
        p, r = _safe_div(tp, predicted), _safe_div(tp, support)
        if support:  # คำที่ไม่มีคลิปในชุดเทส ไม่นับในค่าเฉลี่ย
            per_word[labels[c]] = {"recall": _r(r, 3), "precision": _r(p, 3), "f1": _r(_safe_div(2 * p * r, p + r), 3), "clips": support}
    macro = {k: float(np.mean([w[k] for w in per_word.values()])) if per_word else 0.0 for k in ("precision", "recall", "f1")}

    # คู่ที่สับสนกัน
    pairs: dict[tuple[int, int], int] = {}
    for t, p in zip(y, pred):
        if t != p:
            pairs[(int(t), int(p))] = pairs.get((int(t), int(p)), 0) + 1
    support = {int(c): int((y == c).sum()) for c in np.unique(y)}
    confusions = sorted(
        (
            {"true": labels[t], "pred": labels[p], "count": cnt, "rate": _r(cnt / support[t], 3)}
            for (t, p), cnt in pairs.items()
            if cnt >= MIN_CONFUSION_COUNT
        ),
        key=lambda c: (-c["count"], -c["rate"]),
    )[:MAX_CONFUSIONS]

    # เลือกเกณฑ์ความมั่นใจ (F1 ของคำที่ระบบพูดออกมา: แปลมั่ว/แปลตอนไม่ได้ทำท่า = precision ตก, ไม่พูดตอนทำท่า = recall ตก)
    curve = [_at_threshold(probs, y, null, t) for t in THRESHOLDS]
    best = max(curve, key=lambda c: (round(c["f1"], 4), -c["threshold"])) if curve else None
    threshold = best["threshold"] if best and best["f1"] > 0 else DEFAULT_THRESHOLD
    chosen = next((c for c in curve if c["threshold"] == threshold), None) or _at_threshold(probs, y, null, threshold)

    false_alarm_words, dropped_words = _silence_breakdown(probs, y, labels, null, threshold)

    # ฮิสโตแกรมความมั่นใจของคำอันดับ 1 แยกถูก/ผิด
    conf = probs[np.arange(n), pred]
    bins = np.minimum((conf * CONF_BINS).astype(int), CONF_BINS - 1)
    right = pred == y
    confidence = {
        "bins": [round(i / CONF_BINS, 2) for i in range(CONF_BINS)],
        "correct": [int(((bins == i) & right).sum()) for i in range(CONF_BINS)],
        "wrong": [int(((bins == i) & ~right).sum()) for i in range(CONF_BINS)],
    }

    return {
        "clips": n,
        "accuracy": _r((pred == y).mean()),
        "top3": _r((top3 == y[:, None]).any(1).mean()),
        "precision": _r(macro["precision"]),
        "recall": _r(macro["recall"]),
        "f1": _r(macro["f1"]),
        "per_word": per_word,
        "confusions": confusions,
        "threshold": threshold,
        "threshold_curve": [{k: _r(v) for k, v in c.items()} for c in curve],
        "null_false_alarm": _r(chosen["null_false_alarm"]),
        "word_dropped": _r(chosen["word_dropped"]),
        "false_alarm_words": false_alarm_words,
        "dropped_words": dropped_words,
        "has_null_class": null is not None and bool((y == null).any()),
        "confidence": confidence,
    }
