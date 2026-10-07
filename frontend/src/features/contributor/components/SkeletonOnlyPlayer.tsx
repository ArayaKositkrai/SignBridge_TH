import { useEffect, useRef } from "react";
import { drawFrame } from "../../../lib/mediapipe/draw";
import type { CapturedFrame } from "../services/contributorApi";
import { frameAt } from "../services/extractLandmarks";

// ค่าที่ตัวเล่น skeleton รับ: เฟรม และขนาดภาพ (0 = ไม่ทราบ ใช้ 16:9)
interface Props {
  frames: CapturedFrame[];
  width: number;
  height: number;
}

// ความสูงของ canvas ที่วาด (พิกเซล)
const CANVAS_H = 720;
// สัดส่วนภาพเริ่มต้นเมื่อไฟล์ไม่บอกขนาด
const DEFAULT_ASPECT = 16 / 9;
// หน่วงก่อนเล่นวนรอบใหม่ (มิลลิวินาที)
const LOOP_PAUSE_MS = 300;

// เล่น skeleton วนซ้ำบนพื้นมืดเมื่อไม่มีวิดีโอ (ไฟล์ .npy/.npz)
export default function SkeletonOnlyPlayer({ frames, width, height }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const aspect = width && height ? width / height : DEFAULT_ASPECT;

  // วนเล่นตามเวลาจริง ตั้งแต่เฟรมแรกถึงเฟรมสุดท้าย
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !frames.length) return;
    canvas.width = Math.round(CANVAS_H * aspect);
    canvas.height = CANVAS_H;
    const t0 = frames[0].t;
    const span = Math.max(frames[frames.length - 1].t - t0, 1);
    const start = performance.now();
    let raf = 0;
    // วาดเฟรมของเวลาปัจจุบัน
    const loop = () => {
      const ms = t0 + ((performance.now() - start) % (span + LOOP_PAUSE_MS));
      drawFrame(ctx, frameAt(frames, ms), canvas.width, canvas.height, true);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [frames, aspect]);

  return (
    <div className="absolute inset-0 grid place-items-center bg-deep">
      <canvas ref={ref} className="max-h-full max-w-full" style={{ aspectRatio: aspect }} />
      <span className="absolute bottom-2 right-3 rounded-full bg-black/50 px-2.5 py-1 text-xs text-white">
        ไฟล์ skeleton (ไม่มีวิดีโอ)
      </span>
    </div>
  );
}
