// อวตารแบบโครงกระดูก 2D (canvas)

import { useEffect, useRef, type MutableRefObject } from "react";
import { drawAvatar, type Trails } from "../../../lib/avatar/render";
import { computeFigure, sampleFace, sampleMotion } from "../../../lib/avatar/skeleton";
import type { Motion } from "../../../types";

// ค่าที่ตัวละครรับ: ท่าทางของคำปัจจุบัน และความคืบหน้า (0-1)
interface Props {
  motion: Motion | null | undefined;
  progressRef: MutableRefObject<number>;
}

// ตัวละครโครงกระดูก: วาดท่าทางและสีหน้าตามความคืบหน้าทุกเฟรม
export default function SkeletonAvatar({ motion, progressRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const motionRef = useRef(motion);
  motionRef.current = motion;
  // เก็บรอยแสงของมือ
  const trails = useRef<Trails>({ r: [], l: [] });

  useEffect(() => {
    let raf = 0;
    // ทุกเฟรม: ปรับขนาด canvas หาท่ามือและสีหน้า แล้ววาด
    const loop = (now: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(canvas.clientWidth * dpr);
        const h = Math.round(canvas.clientHeight * dpr);
        if (w && h && (canvas.width !== w || canvas.height !== h)) {
          canvas.width = w;
          canvas.height = h;
        }
        if (canvas.width && canvas.height) {
          const hands = sampleMotion(motionRef.current, progressRef.current);
          // Gentle breathing so the idle avatar does not look frozen.
          const sway = Math.sin(now / 900) * 0.004;
          const figure = computeFigure({
            r: { ...hands.r, y: hands.r.y + sway },
            l: { ...hands.l, y: hands.l.y + sway },
          });
          drawAvatar(ctx, figure, sampleFace(motionRef.current, progressRef.current), canvas.width, canvas.height, now, trails.current);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [progressRef]);

  return <canvas ref={canvasRef} data-testid="avatar-canvas" className="absolute inset-0 h-full w-full" />;
}
