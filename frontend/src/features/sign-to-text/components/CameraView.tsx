import { useState, type MutableRefObject, type RefObject } from "react";
import Button from "../../../components/ui/Button";
import Icon from "../../../components/ui/Icon";
import type { CameraStatus, Facing } from "../../../hooks/useCamera";
import type { LandmarkFrame } from "../../../types";
import type { ModelStatus } from "../hooks/useMediaPipe";
import LandmarkOverlay from "./LandmarkOverlay";

// ค่าที่แผงกล้องรับ: สถานะกล้อง โมเดล และปุ่มควบคุม
interface Props {
  videoRef: RefObject<HTMLVideoElement>;
  frameRef: MutableRefObject<LandmarkFrame | null>;
  camera: CameraStatus;
  cameraError: string | null;
  facing: Facing;
  model: ModelStatus;
  handsVisible: boolean;
  bodyVisible: boolean;
  onStart: () => void;
  onStop: () => void;
  onFlip: () => void;
}

// เลือกข้อความและสีของป้ายสถานะมุมซ้ายบน
function badge(camera: CameraStatus, model: ModelStatus, hands: boolean, body: boolean) {
  if (camera !== "on") return { text: "กล้องปิดอยู่", dot: "bg-white/40" };
  if (model === "loading") return { text: "กำลังโหลดโมเดล…", dot: "bg-amber-300 animate-pulse" };
  if (model === "error") return { text: "โหลดโมเดลไม่สำเร็จ", dot: "bg-danger" };
  if (hands) return { text: "กำลังจับท่ามือ", dot: "bg-emerald-300 animate-pulse" };
  if (body) return { text: "เห็นตัวแล้ว · ยกมือขึ้นมา", dot: "bg-sky" };
  return { text: "วางตัวให้อยู่ในกรอบ", dot: "bg-sky/70" };
}

// แผงกล้อง: ภาพสด เส้น keypoint ป้ายสถานะ และปุ่มควบคุม
export default function CameraView(p: Props) {
  const [showHands, setShowHands] = useState(true);
  const mirror = p.facing === "user";
  const b = badge(p.camera, p.model, p.handsVisible, p.bodyVisible);
  const on = p.camera === "on";

  return (
    <div className="flex flex-col gap-3">
      <div
        className={`stage relative aspect-[4/3] overflow-hidden rounded-3xl shadow-card ring-2 transition-all duration-500 lg:aspect-[16/11] ${
          p.handsVisible ? "ring-brand shadow-[0_0_44px_-6px_rgba(56,133,171,.7)]" : "ring-navy/30"
        }`}
      >
        <div className="stage-grid absolute inset-0" />
        <div className={`absolute inset-0 ${mirror ? "-scale-x-100" : ""}`}>
          <video
            ref={p.videoRef}
            playsInline
            muted
            className={`absolute inset-0 h-full w-full object-cover transition-opacity ${on ? "opacity-100" : "opacity-0"}`}
          />
          <LandmarkOverlay videoRef={p.videoRef} frameRef={p.frameRef} showHands={showHands} />
        </div>

        {on && !p.bodyVisible && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <ellipse cx="50" cy="34" rx="11" ry="15" fill="none" stroke="#bbd6e1" strokeOpacity=".55" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            <path d="M22 100 C22 66 36 56 50 56 C64 56 78 66 78 100" fill="none" stroke="#bbd6e1" strokeOpacity=".4" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          </svg>
        )}

        {on && !p.handsVisible && (
          <div className="pointer-events-none absolute inset-x-0 h-24 animate-scan bg-gradient-to-b from-transparent via-sky/15 to-transparent" />
        )}

        {[
          "left-3 top-3 border-l-2 border-t-2 rounded-tl-xl",
          "right-3 top-3 border-r-2 border-t-2 rounded-tr-xl",
          "bottom-3 left-3 border-b-2 border-l-2 rounded-bl-xl",
          "bottom-3 right-3 border-b-2 border-r-2 rounded-br-xl",
        ].map((c) => (
          <span key={c} className={`pointer-events-none absolute h-7 w-7 border-sky/70 ${c}`} />
        ))}

        <div className="absolute left-6 top-6 flex items-center gap-2 rounded-full bg-black/45 px-3 py-1 text-xs font-medium text-white backdrop-blur">
          <span className={`h-2 w-2 rounded-full ${b.dot}`} />
          {b.text}
        </div>

        {!on && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div className="flex max-w-xs flex-col items-center gap-4 animate-fadeUp">
              <span className="relative grid h-20 w-20 place-items-center rounded-full bg-white/10 text-sky ring-1 ring-sky/30">
                <span className="absolute inset-0 animate-ripple rounded-full ring-2 ring-sky/40" />
                <Icon name={p.camera === "error" ? "cameraOff" : "camera"} size={32} />
              </span>
              <p className="text-sm text-sky">
                {p.camera === "error"
                  ? p.cameraError
                  : "เปิดกล้องเพื่อให้ระบบจับท่าทางมือและแปลเป็นข้อความ"}
              </p>
              <Button
                icon="camera"
                size="lg"
                onClick={p.onStart}
                disabled={p.camera === "starting"}
              >
                {p.camera === "starting" ? "กำลังเปิดกล้อง…" : p.camera === "error" ? "ลองอีกครั้ง" : "เปิดกล้อง"}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon="stop" onClick={p.onStop} disabled={!on}>
          หยุดกล้อง
        </Button>
        <Button variant="ghost" icon="refresh" onClick={p.onFlip} disabled={!on}>
          สลับกล้อง
        </Button>
        <label className="ml-auto flex cursor-pointer select-none items-center gap-2 text-sm font-medium text-navy">
          <input
            type="checkbox"
            checked={showHands}
            onChange={(e) => setShowHands(e.target.checked)}
            className="h-4 w-4 rounded accent-brand"
          />
          แสดงจุดมือ
        </label>
      </div>
    </div>
  );
}
