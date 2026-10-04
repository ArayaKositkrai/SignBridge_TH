import type { MutableRefObject } from "react";
import Icon from "../../../components/ui/Icon";
import type { SignClip } from "../../../types";
import Avatar3D from "./Avatar3D";

// ค่าที่ตัวเล่นรับ
interface Props {
  clip: SignClip | null;
  index: number;
  total: number;
  playing: boolean;
  progress: number;
  progressRef: MutableRefObject<number>;
  loading: boolean;
  onToggle: () => void;
  onVideoEnded: () => void;
  onVideoProgress: (ratio: number) => void;
}

// ชื่อแหล่งที่มาของท่าภาษาไทย
const SOURCE_LABEL: Record<string, string> = {
  tsl51_expert: "ผู้เชี่ยวชาญ TSL-51",
  tsl51_user: "ผู้ใช้ TSL-51",
  "TSL-ONE-S": "ชุดข้อมูล TSL-ONE",
  ล่าม: "คลิปที่ล่ามอัด",
};

// ข้อความใต้ชื่อคำ: ท่ามาจากข้อมูลจริงของใคร หรือยังเป็นท่าตัวอย่าง
function motionNote(clip: SignClip): string {
  const src = clip.motion?.source?.dataset;
  if (!clip.motion) return "คำนี้ยังไม่มีท่าทางในระบบ";
  if (src && SOURCE_LABEL[src]) return `ท่าจากการทำท่าจริงของ${SOURCE_LABEL[src]}`;
  return "ท่าทางประกอบตัวอย่าง ยังไม่ใช่ท่ามาตรฐานภาษามือไทย";
}

// ตัวเล่นภาษามือ: วิดีโอ (ถ้ามี) หรือตัวละครทำท่า พร้อมชื่อคำและแถบความคืบหน้า
export default function SignPlayer(p: Props) {
  const hasVideo = Boolean(p.clip?.url);

  return (
    <div className="stage relative flex aspect-[4/3] flex-col overflow-hidden rounded-3xl shadow-card ring-2 ring-navy/30 md:aspect-video lg:aspect-[4/3]">
      <div className="stage-grid absolute inset-0" />

      {p.total > 0 && (
        <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full bg-black/45 px-3 py-1 text-xs font-medium text-white backdrop-blur">
          <span className={`h-2 w-2 rounded-full ${p.playing ? "animate-pulse bg-emerald-300" : "bg-sky/70"}`} />
          คำที่ {p.index + 1} จาก {p.total}
        </div>
      )}

      <div className="relative flex-1">
        {hasVideo ? (
          <video
            key={p.clip!.url}
            src={p.clip!.url!}
            autoPlay={p.playing}
            muted
            playsInline
            onEnded={p.onVideoEnded}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.duration) p.onVideoProgress(v.currentTime / v.duration);
            }}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <Avatar3D motion={p.clip?.motion} progressRef={p.progressRef} />
        )}

        {p.loading && (
          <div className="absolute inset-0 grid place-items-center bg-black/30 backdrop-blur-[2px]">
            <div className="flex items-center gap-3 text-sky">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-sky/30 border-t-sky" />
              กำลังแปล…
            </div>
          </div>
        )}

        {!p.loading && !p.clip && (
          <p className="absolute bottom-5 left-5 right-5 text-center text-sm text-sky/80">
            พิมพ์หรือพูดข้อความ แล้วกด "แปลเป็นภาษามือ"
          </p>
        )}

        {p.clip && !p.loading && (
          <div key={p.clip.gloss + p.index} className="absolute bottom-4 left-5 right-1/2 flex animate-fadeUp flex-col items-start gap-1.5 pr-10 text-left">
            <p className="text-3xl font-bold tracking-wide text-white drop-shadow">{p.clip.word}</p>
            {!hasVideo && (
              <p className="rounded-full bg-white/10 px-3 py-1 text-[11px] text-sky/90">
                {motionNote(p.clip)}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="relative flex items-center gap-3 bg-black/30 px-4 py-3 backdrop-blur">
        <button
          onClick={p.onToggle}
          disabled={!p.total}
          className="grid h-9 w-9 place-items-center rounded-full bg-white text-navy shadow transition hover:scale-105 hover:bg-sky disabled:opacity-40 disabled:hover:scale-100"
          aria-label={p.playing ? "หยุดชั่วคราว" : "เล่น"}
        >
          <Icon name={p.playing ? "pause" : "play"} size={14} />
        </button>
        <div className="flex flex-1 gap-1">
          {Array.from({ length: Math.max(p.total, 1) }, (_, i) => {
            const fill = p.total === 0 ? 0 : i < p.index ? 1 : i === p.index ? p.progress * p.total - p.index : 0;
            return (
              <div key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky to-white transition-[width] duration-100"
                  style={{ width: `${Math.max(0, Math.min(fill, 1)) * 100}%` }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
