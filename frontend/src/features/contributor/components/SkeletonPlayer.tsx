// ตัวเล่น skeleton บนพื้นดำ

import { useEffect, useRef, useState } from "react";
import Icon from "../../../components/ui/Icon";
import { drawFrame } from "../../../lib/mediapipe/draw";
import type { CapturedFrame } from "../services/contributorApi";
import { frameAt } from "../services/extractLandmarks";

// ค่าที่ตัวเล่นรับ: เฟรม skeleton และแสดง/ซ่อน skeleton
interface Props {
  frames: CapturedFrame[] | null;
  showSkeleton?: boolean;
}

// เล่น skeleton ของคลิปวนบนพื้นดำ (คลิปไม่มีวิดีโอ เก็บแค่ skeleton) แตะเพื่อหยุด/เล่น
export default function SkeletonPlayer({ frames, showSkeleton = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [paused, setPaused] = useState(false);
  const clock = useRef({ start: 0, at: 0 });

  // ทุกเฟรมจอ: วาด skeleton ของเวลาปัจจุบัน (วนเมื่อเล่นจบ)
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !frames?.length) return;
    const duration = Math.max(frames[frames.length - 1].t, 1);
    clock.current.start = performance.now() - clock.current.at;
    let raf = 0;
    const draw = () => {
      const w = canvas.clientWidth * devicePixelRatio;
      const h = canvas.clientHeight * devicePixelRatio;
      if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
      if (!paused) clock.current.at = (performance.now() - clock.current.start) % duration;
      const f = showSkeleton ? frameAt(frames, frames[0].t + clock.current.at) : null;
      drawFrame(ctx, f, w, h, true);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [frames, paused, showSkeleton]);

  return (
    <button
      type="button"
      onClick={() => setPaused((p) => !p)}
      className="absolute inset-0 grid place-items-center bg-black"
      aria-label={paused ? "เล่นต่อ" : "หยุดชั่วคราว"}
    >
      {frames ? (
        <canvas ref={canvasRef} className="aspect-[4/3] max-h-full w-full max-w-full" />
      ) : (
        <span className="text-sm text-white/70">กำลังโหลด skeleton…</span>
      )}
      {paused && (
        <span className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white backdrop-blur">
          <Icon name="play" size={28} />
        </span>
      )}
    </button>
  );
}
