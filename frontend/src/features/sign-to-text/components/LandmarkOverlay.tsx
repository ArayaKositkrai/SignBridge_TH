import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import { drawFrame } from "../../../lib/mediapipe/draw";
import type { LandmarkFrame } from "../../../types";

// ค่าที่ overlay รับ
interface Props {
  videoRef: RefObject<HTMLVideoElement>;
  frameRef: MutableRefObject<LandmarkFrame | null>;
  showHands: boolean;
}

// canvas ซ้อนบนวิดีโอ วาดเส้น keypoint ล่าสุดทุกเฟรม
export default function LandmarkOverlay({ videoRef, frameRef, showHands }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const showRef = useRef(showHands);
  showRef.current = showHands;

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
        drawFrame(ctx, frameRef.current, canvas.width, canvas.height, showRef.current);
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
      className="pointer-events-none absolute inset-0 h-full w-full object-cover"
    />
  );
}
