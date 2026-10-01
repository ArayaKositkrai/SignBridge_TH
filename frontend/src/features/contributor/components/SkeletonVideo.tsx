import { useEffect, useRef, useState, type RefObject } from "react";
import Icon from "../../../components/ui/Icon";
import type { LandmarkFrame } from "../../../types";
import LandmarkOverlay from "../../sign-to-text/components/LandmarkOverlay";
import type { CapturedFrame } from "../services/contributorApi";
import { frameAt } from "../services/extractLandmarks";

// ค่าที่ตัวเล่นรับ: ลิงก์วิดีโอ skeleton กลับซ้าย-ขวา แสดง skeleton และเล่นวน/มีปุ่มควบคุม
interface Props {
  src: string;
  frames: CapturedFrame[] | null;
  mirror?: boolean;
  showSkeleton?: boolean;
  loop?: boolean;
  videoRef?: RefObject<HTMLVideoElement>;
}

// วิดีโอพร้อม skeleton ที่ตรงกับเวลาในวิดีโอ (แตะเพื่อหยุด/เล่น)
export default function SkeletonVideo({ src, frames, mirror = false, showSkeleton = true, loop = true, videoRef }: Props) {
  const ownRef = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? ownRef;
  const frameRef = useRef<LandmarkFrame | null>(null);
  const [paused, setPaused] = useState(false);

  // ทุกเฟรมจอ: หา skeleton ของเวลาปัจจุบันในวิดีโอ
  useEffect(() => {
    let raf = 0;
    const loopFn = () => {
      const v = ref.current;
      frameRef.current = v && frames ? frameAt(frames, v.currentTime * 1000) : null;
      raf = requestAnimationFrame(loopFn);
    };
    raf = requestAnimationFrame(loopFn);
    return () => cancelAnimationFrame(raf);
  }, [frames, ref]);

  // แตะเพื่อหยุด/เล่นต่อ
  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  return (
    <button type="button" onClick={toggle} className="absolute inset-0 bg-black" aria-label={paused ? "เล่นต่อ" : "หยุดชั่วคราว"}>
      <div className={`absolute inset-0 ${mirror ? "-scale-x-100" : ""}`}>
        <video
          ref={ref}
          src={src}
          autoPlay
          loop={loop}
          muted
          playsInline
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          className="absolute inset-0 h-full w-full object-contain"
        />
        {showSkeleton && frames && (
          <LandmarkOverlay videoRef={ref} frameRef={frameRef} showHands mirror={mirror} fit="contain" />
        )}
      </div>
      {paused && (
        <span className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white backdrop-blur">
          <Icon name="play" size={28} />
        </span>
      )}
    </button>
  );
}
