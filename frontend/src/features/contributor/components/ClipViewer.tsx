// ตัวดูคลิปเต็มจอ (วิดีโอ + skeleton)

import { useEffect, useState } from "react";
import Icon from "../../../components/ui/Icon";
import { SIDE_COLOR } from "../../../lib/mediapipe/draw";
import { fmtDate, fmtDuration, fmtPct } from "../../../lib/format";
import { getSampleLandmarks, sampleVideoUrl, type CapturedFrame, type SampleMeta } from "../services/contributorApi";
import SkeletonPlayer from "./SkeletonPlayer";
import SkeletonVideo from "./SkeletonVideo";

// ค่าที่ตัวดูคลิปรับ: รายการคลิป ลำดับที่เปิด เปลี่ยนคลิป ปิด และลบ
interface Props {
  samples: SampleMeta[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onDelete: (s: SampleMeta) => void;
}

// ดูคลิปแบบเต็มจอ: วิดีโอใหญ่ + skeleton ข้อมูลคลิป และเลื่อนดูคลิปก่อนหน้า/ถัดไป (← → Esc)
export default function ClipViewer({ samples, index, onIndex, onClose, onDelete }: Props) {
  const s = samples[index];
  const [frames, setFrames] = useState<CapturedFrame[] | null>(null);
  const [showSkeleton, setShowSkeleton] = useState(true);

  // โหลด skeleton ของคลิปที่เปิด
  useEffect(() => {
    setFrames(null);
    if (!s?.frame_count) return;
    let alive = true;
    getSampleLandmarks(s.word, s.id)
      .then((f) => alive && setFrames(f))
      .catch(() => alive && setFrames(null));
    return () => {
      alive = false;
    };
  }, [s]);

  // คีย์ลัด: Esc ปิด, ← → เลื่อนคลิป, S เปิด/ปิด skeleton
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      else if (e.key === "ArrowRight" && index < samples.length - 1) onIndex(index + 1);
      else if (e.key.toLowerCase() === "s") setShowSkeleton((v) => !v);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, samples.length, onIndex, onClose]);

  // ล็อกไม่ให้หน้าหลังเลื่อนระหว่างเปิดตัวดูคลิป
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!s) return null;
  const hand = Math.max(s.lh_present_rate ?? 0, s.rh_present_rate ?? 0);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`คลิปที่ ${index + 1} ของ ${s.word}`}
    >
      {/* แถบบน: ชื่อคำ ลำดับ ปุ่ม skeleton ลบ ปิด */}
      <div className="flex items-center gap-3 px-4 py-3 text-white">
        <div className="min-w-0">
          <div className="text-lg font-bold">{s.word}</div>
          <div className="text-xs text-white/60">
            คลิปที่ {index + 1} / {samples.length}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSkeleton((v) => !v)}
            aria-pressed={showSkeleton}
            className={`flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition ${
              showSkeleton ? "bg-white text-deep" : "bg-white/15 text-white hover:bg-white/25"
            }`}
          >
            <Icon name={showSkeleton ? "eye" : "eyeOff"} size={18} />
            skeleton
          </button>
          <button
            type="button"
            onClick={() => onDelete(s)}
            className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white transition hover:bg-danger"
            aria-label="ลบคลิปนี้"
          >
            <Icon name="trash" size={18} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white transition hover:bg-white/30"
            aria-label="ปิด"
          >
            <Icon name="close" size={20} />
          </button>
        </div>
      </div>

      {/* วิดีโอ + ปุ่มก่อนหน้า/ถัดไป */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14">
        <div className="relative h-full w-full max-w-6xl overflow-hidden rounded-2xl">
          {s.video ? (
            <SkeletonVideo
              key={s.id}
              src={sampleVideoUrl(s.word, s.id)}
              frames={frames}
              showSkeleton={showSkeleton}
            />
          ) : (
            <SkeletonPlayer key={s.id} frames={frames} showSkeleton={showSkeleton} />
          )}
        </div>
        <button
          type="button"
          onClick={() => onIndex(index - 1)}
          disabled={index === 0}
          className="absolute left-2 top-1/2 grid h-11 w-11 -translate-y-1/2 rotate-180 place-items-center rounded-full bg-white/15 text-white transition hover:bg-white/30 disabled:opacity-25"
          aria-label="คลิปก่อนหน้า"
        >
          <Icon name="arrow" size={22} />
        </button>
        <button
          type="button"
          onClick={() => onIndex(index + 1)}
          disabled={index === samples.length - 1}
          className="absolute right-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white transition hover:bg-white/30 disabled:opacity-25"
          aria-label="คลิปถัดไป"
        >
          <Icon name="arrow" size={22} />
        </button>
      </div>

      {/* แถบล่าง: ข้อมูลคลิป */}
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 px-4 py-3 text-sm text-white/80">
        <span>ล่าม: {s.signer ?? "ไม่ระบุ"}</span>
        <span>{s.source === "record" ? "อัดจากกล้อง" : "อัปโหลด"}</span>
        {s.duration_ms != null && <span>{fmtDuration(s.duration_ms)}</span>}
        <span>
          {s.frame_count} เฟรม{s.fps ? ` @ ${s.fps} fps` : ""}
        </span>
        {s.camera_fps ? <span>กล้อง {Math.round(s.camera_fps)} fps</span> : null}
        {s.width && s.height ? (
          <span>
            {s.width}×{s.height}
          </span>
        ) : null}
        <span>เห็นมือ {fmtPct(hand)}</span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: SIDE_COLOR.left }} />
          ซ้าย
          <span className="ml-1 h-2.5 w-2.5 rounded-full" style={{ background: SIDE_COLOR.right }} />
          ขวา
        </span>
        <span className="text-white/50">{fmtDate(s.created_at)}</span>
      </div>
    </div>
  );
}
