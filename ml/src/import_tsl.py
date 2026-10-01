"""นำเข้าชุดข้อมูล TSL ที่รวมไว้แล้ว (TSL-ONE-S + TSL-51) เป็นไฟล์ numpy สำหรับเทรน

ใช้:
    pip install pyarrow
    python import_tsl.py --frames <tsl_merged_frames.parquet> --meta <tsl_merged_dataset.zip>

ผลลัพธ์: ml/data/processed/tsl_skeleton.npz
    points  (เฟรมทั้งหมด, 48, 2) float32  รูปแบบกลางตาม features.py (NaN = มองไม่เห็น)
    offsets (คลิป+1,)                       เฟรมของคลิปที่ i คือ points[offsets[i]:offsets[i+1]]
    label / signer / source / sample_id     ข้อมูลต่อคลิป
    aspect  (คลิป,)                         สัดส่วนภาพ (กว้าง/สูง) ที่ใช้แก้พิกัด

ขนาดวิดีโอต้นฉบับไม่มีในชุดข้อมูล จึงใช้ค่าประมาณ:
    TSL-51    = 16:9 (ภาพแนวนอน ประมาณจากความยาวแขน)
    TSL-ONE-S = 0.8 (ภาพแนวตั้ง ประมาณจากระยะปาก-ไหล่เทียบกับความกว้างไหล่)
ตอนเทรนจะสุ่มยืด/หดแกนนอนเพิ่ม เพื่อให้โมเดลทนต่อค่าประมาณที่คลาดเคลื่อน
"""
import argparse
import csv
import io
import zipfile
from pathlib import Path

import numpy as np

# ไฟล์ผลลัพธ์ (อ้างจากตำแหน่งสคริปต์)
OUT_PATH = Path(__file__).resolve().parents[1] / "data" / "processed" / "tsl_skeleton.npz"
# สัดส่วนภาพโดยประมาณของแต่ละชุดข้อมูล
ASPECT = {"TSL-51": 16 / 9, "TSL-ONE-S": 0.8}
# ชื่อคลาสของคลิปที่ไม่ได้ทำท่า
NULL_LABEL = "ไม่ทำท่า"
# ชื่อคอลัมน์ลำตัวตามลำดับรูปแบบกลาง
BODY_COLS = [f"{s}_{j}_{a}" for j in ("shoulder", "elbow", "wrist") for s in "lr" for a in "xy"]
# ชื่อคอลัมน์มือซ้าย/ขวา
HAND_COLS = [f"{h}_{a}{i}" for h in ("lh", "rh") for i in range(21) for a in "xy"]


# อ่านข้อมูลต่อคลิปจาก tsl_merged_meta_th.csv: ชื่อคำ (รวมแบบต่าง ๆ ของคำเดียวกัน) ผู้แสดง ชุดข้อมูล
def read_meta(meta_zip: Path) -> dict[str, dict]:
    with zipfile.ZipFile(meta_zip) as z:
        text = z.read("tsl_merged_meta_th.csv").decode("utf-8-sig")
    meta = {}
    for r in csv.DictReader(io.StringIO(text)):
        if r["is_null_class"] == "True":
            label = NULL_LABEL
        else:
            label = (r["word_th"] or r["คำ"]).strip()
        meta[r["รหัสคลิป"]] = {"label": label, "signer": r["signer_id"], "source": r["ชุดข้อมูล"]}
    return meta


# อ่านเฟรมทั้งหมดจาก parquet แล้วจัดกลุ่มเป็นคลิปในรูปแบบกลาง
def build(frames_path: Path, meta_zip: Path) -> dict:
    import pyarrow.parquet as pq

    meta = read_meta(meta_zip)
    table = pq.read_table(frames_path, columns=["sample_id", "frame", *BODY_COLS, *HAND_COLS])
    sid = np.asarray(table["sample_id"].to_pylist())
    frame = table["frame"].to_numpy()
    coords = np.stack(
        [table[c].to_numpy(zero_copy_only=False).astype(np.float32) for c in BODY_COLS + HAND_COLS], axis=1
    )  # (N, 96) ค่า null กลายเป็น NaN
    points = coords.reshape(len(coords), 48, 2)

    order = np.lexsort((frame, sid))
    sid, points = sid[order], points[order]
    names, starts = np.unique(sid, return_index=True)
    offsets = np.append(starts, len(sid))

    keep = [i for i, n in enumerate(names) if n in meta]
    out_points, out_offsets, labels, signers, sources, aspects = [], [0], [], [], [], []
    for i in keep:
        clip = points[offsets[i] : offsets[i + 1]]
        m = meta[names[i]]
        out_points.append(clip)
        out_offsets.append(out_offsets[-1] + len(clip))
        labels.append(m["label"])
        signers.append(m["signer"])
        sources.append(m["source"])
        aspects.append(ASPECT.get(m["source"], 1.0))
    return {
        "points": np.concatenate(out_points).astype(np.float32),
        "offsets": np.asarray(out_offsets, dtype=np.int64),
        "label": np.asarray(labels),
        "signer": np.asarray(signers),
        "source": np.asarray(sources),
        "sample_id": names[keep],
        "aspect": np.asarray(aspects, dtype=np.float32),
    }


# รับพาธไฟล์จาก command line แล้วบันทึก npz
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--frames", type=Path, required=True)
    ap.add_argument("--meta", type=Path, required=True)
    args = ap.parse_args()
    data = build(args.frames, args.meta)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(OUT_PATH, **data)
    print(f"นำเข้า {len(data['label'])} คลิป ({len(set(data['label']))} คำ, {len(data['points'])} เฟรม) -> {OUT_PATH}")


if __name__ == "__main__":
    main()
