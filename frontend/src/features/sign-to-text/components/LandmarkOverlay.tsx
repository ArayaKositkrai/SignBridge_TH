import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import { drawFrame } from "../../../lib/mediapipe/draw";
import type { LandmarkFrame } from "../../../types";

// ค่าที่ overlay รับ (mirror = ภาพถูกกลับซ้าย-ขวา, fit = วิธีย่อภาพให้ตรงกับวิดีโอ)
interface Props {
  videoRef: RefObject<HTMLVideoElement>;
  frameRef: MutableRefObject<LandmarkFrame | null>;
  showHands: boolean;
  mirror?: boolean;
  fit?: "cover" | "contain";
}

// canvas ซ้อนบนวิดีโอ วาดเส้น keypoint ล่าสุดทุกเฟรม
export default function LandmarkOverlay({ videoRef, frameRef, showHands, mirror = false, fit = "cover" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const showRef = useRef(showHands);
  showRef.current = showHands;
  const mirrorRef = useRef(mirror);
  mirrorRef.current = mirror;

  useEffect(() => {
    let raf = 0;
    // ปรับขนาด canvas ให้เท่าวิดีโอ แล้ววาดโครงกระดูก
    const loop = () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && video && ctx && video.videoWidth) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        drawFrame(ctx, frameRef.current, canvas.width, canvas.height, showRef.current, {
          mirror: mirrorRef.current,
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, frameRef]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="landmark-canvas"
      className={`pointer-events-none absolute inset-0 h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
    />
  );
}
