import { useEffect, useRef, useState, type ReactNode } from "react";
import Button from "../../../components/ui/Button";
import Icon, { type IconName } from "../../../components/ui/Icon";
import { useCamera } from "../../../hooks/useCamera";
import { SIDE_COLOR } from "../../../lib/mediapipe/draw";
import LandmarkOverlay from "../../sign-to-text/components/LandmarkOverlay";
import { useMediaPipe } from "../../sign-to-text/hooks/useMediaPipe";
import { UPLOAD_EXTS, useClipRecorder, type Take } from "../hooks/useClipRecorder";
import { uploadSample, type SampleMeta } from "../services/contributorApi";
import { SKELETON_FPS } from "../services/extractLandmarks";
import ReviewPlayer from "./ReviewPlayer";

// ค่าที่แผงอัดคลิปรับ: คำศัพท์ ผู้แสดง จำนวนคลิปที่เก็บแล้ว เป้าหมาย และฟังก์ชันเรียกเมื่อบันทึกสำเร็จ
interface Props {
  word: string;
  signer: string | null;
  savedCount: number;
  target: number;
  onSaved: (sample: SampleMeta) => void;
}

// สัดส่วนเฟรมที่เห็นมือ ที่ถือว่าคลิปดี
const GOOD_HAND_RATIO = 0.6;
// สัดส่วนเฟรมที่เห็นมือข้างหนึ่ง ที่ถือว่าใช้มือข้างนั้น
const HAND_USED_RATIO = 0.2;
// เวลาแสดงข้อความ "เก็บแล้ว" (มิลลิวินาที)
const TOAST_MS = 2500;

// สรุปคุณภาพคลิปจาก skeleton: สัดส่วนเฟรมที่เห็นมือ และมือที่ใช้ (ตรวจอัตโนมัติ)
function summarize(take: Take) {
  const n = take.frames.length;
  if (!n) return { ratio: 0, hands: "ไม่พบ skeleton" };
  const share = (pick: (f: Take["frames"][number]) => boolean) => take.frames.filter(pick).length / n;
  const left = share((f) => f.leftHand.length > 0) >= HAND_USED_RATIO;
  const right = share((f) => f.rightHand.length > 0) >= HAND_USED_RATIO;
  const ratio = share((f) => f.leftHand.length > 0 || f.rightHand.length > 0);
  const hands = left && right ? "สองมือ" : left ? "มือซ้าย" : right ? "มือขวา" : "ไม่พบมือ";
  return { ratio, hands };
}

// ปุ่มไอคอนกลมโปร่งแสงที่วางบนภาพกล้อง
function StageButton(p: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={p.onClick}
      disabled={p.disabled}
      title={p.label}
      aria-label={p.label}
      aria-pressed={p.active}
      className={`grid h-11 w-11 place-items-center rounded-full backdrop-blur transition hover:scale-105 disabled:pointer-events-none disabled:opacity-35 ${
        p.active ? "bg-white text-navy" : "bg-black/45 text-white hover:bg-black/60"
      }`}
    >
      <Icon name={p.icon} size={20} />
    </button>
  );
}

// ป้ายข้อมูลเล็กบนภาพกล้อง
function Pill({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white backdrop-blur">
      {children}
    </div>
  );
}

// ป้ายคุณภาพคลิป (เขียว = ดี, เหลือง = ควรอัดใหม่, แดง = ใช้ไม่ได้, ฟ้า = ข้อมูล)
function Stat({ tone, children }: { tone: "good" | "warn" | "bad" | "info"; children: ReactNode }) {
  const tones = {
    good: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    warn: "bg-amber-50 text-amber-700 ring-amber-200",
    bad: "bg-danger/10 text-danger ring-danger/20",
    info: "bg-sky/40 text-navy ring-sky",
  };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${tones[tone]}`}>{children}</span>;
}

// ปุ่มอัดกลมตรงกลาง: วงแดง = อัด, สี่เหลี่ยม + วงความคืบหน้า = หยุด, กากบาท = ยกเลิกนับถอยหลัง
function RecordButton(p: { state: string; progress: number; disabled: boolean; onClick: () => void }) {
  const recording = p.state === "recording";
  const counting = p.state === "countdown";
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <button
      type="button"
      onClick={p.onClick}
      disabled={p.disabled}
      aria-label={recording ? "หยุดอัด" : counting ? "ยกเลิก" : "เริ่มอัด"}
      className="relative grid h-[76px] w-[76px] place-items-center rounded-full transition hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
    >
      <svg viewBox="0 0 76 76" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="38" cy="38" r={r} fill="rgba(0,0,0,.25)" stroke="white" strokeOpacity=".9" strokeWidth="4" />
        {recording && (
          <circle
            cx="38"
            cy="38"
            r={r}
            fill="none"
            stroke="#d62839"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - p.progress)}
          />
        )}
      </svg>
      {counting ? (
        <Icon name="close" size={28} className="relative text-white" />
      ) : (
        <span
          className={`relative bg-danger transition-all duration-200 ${
            recording ? "h-7 w-7 rounded-md" : "h-[54px] w-[54px] rounded-full"
          }`}
        />
      )}
    </button>
  );
}

// แผงอัดคลิปแบบแอปกล้อง: ภาพสด + skeleton ปุ่มอัดกลางจอ ตรวจดูคลิป แล้วอัดใหม่หรือเก็บ
export default function RecorderPanel({ word, signer, savedCount, target, onSaved }: Props) {
  // ขอกล้อง 50 fps เท่าคลิปอ้างอิง (กล้องที่ทำไม่ได้จะให้ค่าสูงสุดที่ทำได้)
  const cam = useCamera({ frameRate: SKELETON_FPS });
  const on = cam.status === "on";
  // หยุดตรวจจับจากกล้องชั่วคราวระหว่างตรวจคลิป/สกัดไฟล์ (ใช้โมเดลตัวเดียวกัน)
  const [paused, setPaused] = useState(false);
  const mp = useMediaPipe({ videoRef: cam.videoRef, active: on && !paused });
  const rec = useClipRecorder({ videoRef: cam.videoRef });
  const [mirror, setMirror] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasWord = word.trim().length > 0;
  const take = rec.take;
  const capturing = rec.state === "countdown" || rec.state === "recording";
  const canRecord = on && hasWord;
  const quality = take ? summarize(take) : null;

  // ตรวจคลิปหรือสกัดไฟล์อยู่ = หยุดตรวจจับจากกล้อง
  useEffect(() => setPaused(rec.state === "review" || rec.state === "processing"), [rec.state]);

  // ซ่อนข้อความ "เก็บแล้ว" อัตโนมัติ
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [toast]);

  // ปุ่มกลาง: อัด / หยุด / ยกเลิกนับถอยหลัง ตามสถานะ
  const primary = () => {
    if (rec.state === "recording") rec.stop();
    else if (rec.state === "countdown") rec.cancel();
    else if (canRecord) {
      setSaveError(null);
      rec.start();
    }
  };

  // เก็บคลิปที่ตรวจแล้วเข้าชุดข้อมูลของคำนี้
  const save = async () => {
    if (!take || !hasWord || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const sample = await uploadSample({
        word: word.trim(),
        source: take.source,
        signer,
        video: take.blob,
        fileName: take.fileName,
        frames: take.frames,
        fps: SKELETON_FPS,
        cameraFps: take.source === "record" ? cam.settings.fps : null,
        durationMs: take.durationMs,
        width: take.width,
        height: take.height,
      });
      rec.discard();
      setToast(`เก็บแล้ว · คลิปที่ ${savedCount + 1} ของ "${sample.word}"`);
      onSaved(sample);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "บันทึกคลิปไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  // อัดใหม่ (คลิปจากกล้อง) หรือเลือกไฟล์ใหม่ (คลิปที่อัปโหลด)
  const retake = () => {
    if (take?.source === "upload") fileRef.current?.click();
    else rec.start();
  };

  // คีย์ลัด: Space = อัด/หยุด, Enter = เก็บ, R = อัดใหม่, Esc = ยกเลิก/ทิ้ง (ไม่ทำงานตอนพิมพ์หรือเปิดหน้าต่างดูคลิป)
  const keysRef = useRef({ primary, save, retake });
  keysRef.current = { primary, save, retake };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName)) return;
      const k = keysRef.current;
      if (e.code === "Space" && rec.state !== "review" && rec.state !== "processing") k.primary();
      else if (e.key === "Enter" && rec.state === "review") void k.save();
      else if (e.key.toLowerCase() === "r" && rec.state === "review" && on) k.retake();
      else if (e.key === "Escape") rec.state === "review" ? rec.discard() : rec.cancel();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rec, on]);

  // สถานะที่แสดงมุมซ้ายบน
  const status = (() => {
    if (rec.state === "recording")
      return { dot: "bg-danger animate-pulse", text: `REC ${(rec.elapsed / 1000).toFixed(1)} / ${rec.maxSec} วิ` };
    if (rec.state === "processing") return { dot: "bg-amber-300 animate-pulse", text: "กำลังสร้าง skeleton…" };
    if (rec.state === "review") return { dot: "bg-amber-300", text: "ตรวจดูคลิป" };
    if (!on) return { dot: "bg-white/40", text: "กล้องปิดอยู่" };
    if (mp.status === "loading") return { dot: "bg-amber-300 animate-pulse", text: "กำลังโหลดโมเดล…" };
    if (mp.handsVisible) return { dot: "bg-emerald-300", text: "เห็นมือแล้ว พร้อมอัด" };
    if (mp.bodyVisible) return { dot: "bg-sky", text: "ยกมือขึ้นมาในกรอบ" };
    return { dot: "bg-sky/70", text: "ยืนให้เห็นครึ่งตัว" };
  })();

  return (
    <div className="flex flex-col gap-3">
      <div
        className={`stage relative mx-auto aspect-video w-full overflow-hidden rounded-3xl shadow-card ring-2 transition-all duration-300 xl:max-w-[calc((100dvh_-_25rem)*16/9)] ${
          rec.state === "recording"
            ? "ring-danger shadow-[0_0_40px_-8px_rgba(214,40,57,.7)]"
            : mp.handsVisible && !take
              ? "ring-brand"
              : "ring-navy/30"
        }`}
      >
        <div className="stage-grid absolute inset-0" />

        {/* ภาพกล้องสด + skeleton (กลับซ้าย-ขวาได้) — ต้องอยู่ตลอดเพื่อไม่ให้กล้องหลุด */}
        <div className={`absolute inset-0 ${mirror ? "-scale-x-100" : ""}`}>
          <video
            ref={cam.videoRef}
            playsInline
            muted
            className={`absolute inset-0 h-full w-full object-cover ${on ? "opacity-100" : "opacity-0"}`}
          />
          {showSkeleton && !take && (
            <LandmarkOverlay videoRef={cam.videoRef} frameRef={mp.frameRef} showHands mirror={mirror} />
          )}
        </div>

        {/* คลิปที่อัด/อัปโหลด เล่นวนพร้อม skeleton ทับ */}
        {take && <ReviewPlayer take={take} mirror={mirror && take.source === "record"} showSkeleton={showSkeleton} />}

        {/* กำลังสกัด skeleton จากไฟล์ */}
        {rec.state === "processing" && (
          <div className="absolute inset-0 grid place-items-center bg-navy/70 p-6 backdrop-blur-sm">
            <div className="flex w-full max-w-xs flex-col items-center gap-3 text-center text-white">
              <span className="text-sm font-semibold">กำลังสร้าง skeleton {SKELETON_FPS} fps จากวิดีโอ</span>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky to-brand transition-[width]"
                  style={{ width: `${Math.round(rec.progress * 100)}%` }}
                />
              </div>
              <span className="text-xs text-sky">{Math.round(rec.progress * 100)}%</span>
              <Button variant="ghost" size="sm" icon="close" onClick={rec.cancel}>
                ยกเลิก
              </Button>
            </div>
          </div>
        )}

        {/* ตัวเลขนับถอยหลัง */}
        {rec.state === "countdown" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/25">
            <span key={rec.count} className="animate-fadeUp text-9xl font-bold text-white drop-shadow-lg">
              {rec.count}
            </span>
          </div>
        )}

        {/* แถบบน: สถานะ คำที่กำลังเก็บ คำอธิบายสี และปุ่มตั้งค่าการแสดงผล */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <div className="flex flex-col items-start gap-1.5">
            <Pill>
              <span className={`h-2 w-2 rounded-full ${status.dot}`} />
              {status.text}
            </Pill>
            {on && cam.settings.fps && !take && (
              <Pill>
                <span className={`h-2 w-2 rounded-full ${cam.settings.fps >= SKELETON_FPS - 1 ? "bg-emerald-300" : "bg-amber-300"}`} />
                กล้อง {Math.round(cam.settings.fps)} fps
                {cam.settings.width && ` · ${cam.settings.width}×${cam.settings.height}`}
              </Pill>
            )}
            {hasWord && (
              <Pill>
                <span className="font-bold">{word.trim()}</span>
                <span className="text-white/70">
                  · คลิปที่ {savedCount + 1}
                  {savedCount < target && ` / ${target}`}
                </span>
              </Pill>
            )}
          </div>
          <div className="pointer-events-auto flex flex-col items-end gap-2">
            <div className="flex gap-2">
              <StageButton
                icon={showSkeleton ? "eye" : "eyeOff"}
                label={showSkeleton ? "ซ่อน skeleton" : "แสดง skeleton"}
                onClick={() => setShowSkeleton((v) => !v)}
                active={showSkeleton}
              />
              <StageButton
                icon="mirror"
                label="กลับซ้าย-ขวา (แบบกระจก)"
                onClick={() => setMirror((v) => !v)}
                active={mirror}
              />
            </div>
            {showSkeleton && (
              <Pill>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: SIDE_COLOR.left }} />
                ซ้าย
                <span className="ml-1 h-2.5 w-2.5 rounded-full" style={{ background: SIDE_COLOR.right }} />
                ขวา
              </Pill>
            )}
          </div>
        </div>

        {/* ข้อความเก็บคลิปสำเร็จ */}
        {toast && (
          <div className="pointer-events-none absolute inset-x-0 top-16 flex justify-center">
            <div className="flex animate-fadeUp items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-lg">
              <Icon name="check" size={16} />
              {toast}
            </div>
          </div>
        )}

        {/* แถบควบคุมล่าง: อัปโหลด / ปุ่มอัด / สลับกล้อง ปิดกล้อง */}
        {on && !take && rec.state !== "processing" && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-4 pb-4 pt-10">
            {!hasWord && (
              <p className="mb-3 text-center text-sm font-medium text-amber-200">
                พิมพ์คำศัพท์ด้านบนก่อนเริ่มอัด
              </p>
            )}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <div className="flex justify-start">
                <StageButton
                  icon="upload"
                  label="อัปโหลดไฟล์วิดีโอ"
                  onClick={() => fileRef.current?.click()}
                  disabled={capturing || !hasWord}
                />
              </div>
              <RecordButton
                state={rec.state}
                progress={rec.elapsed / (rec.maxSec * 1000)}
                disabled={!canRecord && !capturing}
                onClick={primary}
              />
              <div className="flex justify-end gap-2">
                {cam.canFlip && (
                  <StageButton icon="refresh" label="สลับกล้องหน้า/หลัง" onClick={cam.flip} disabled={capturing} />
                )}
                <StageButton icon="cameraOff" label="ปิดกล้อง" onClick={cam.stop} disabled={capturing} />
              </div>
            </div>
          </div>
        )}

        {/* หน้าจอตอนกล้องยังไม่เปิด */}
        {!on && !take && rec.state !== "processing" && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div className="flex max-w-sm flex-col items-center gap-4">
              <span className="grid h-16 w-16 place-items-center rounded-full bg-white/10 text-sky ring-1 ring-sky/30">
                <Icon name={cam.status === "error" ? "cameraOff" : "camera"} size={28} />
              </span>
              <p className="text-sm text-sky">
                {cam.status === "error" ? cam.error : "เปิดกล้องเพื่ออัดท่าภาษามือ หรืออัปโหลดคลิปที่มีอยู่แล้ว"}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button icon="camera" size="lg" onClick={() => void cam.start()} disabled={cam.status === "starting"}>
                  {cam.status === "starting" ? "กำลังเปิดกล้อง…" : "เปิดกล้อง"}
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  icon="upload"
                  onClick={() => fileRef.current?.click()}
                  disabled={!hasWord}
                >
                  อัปโหลดไฟล์
                </Button>
              </div>
              {!hasWord && <p className="text-xs text-amber-200">พิมพ์คำศัพท์ด้านบนก่อน</p>}
            </div>
          </div>
        )}
      </div>

      {/* ช่องเลือกไฟล์วิดีโอ (ซ่อนไว้ เปิดผ่านปุ่มอัปโหลด) */}
      <input
        ref={fileRef}
        type="file"
        accept={`video/*,${UPLOAD_EXTS.join(",")}`}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) rec.loadFile(file);
          e.target.value = "";
        }}
      />

      {/* แถบตัดสินใจหลังอัด: ดูคุณภาพ แล้วเก็บ / อัดใหม่ / ทิ้ง */}
      {take && quality && (
        <div className="flex animate-fadeUp flex-col gap-3 rounded-2xl bg-white/80 p-3 ring-1 ring-sky sm:flex-row sm:items-center">
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="text-sm font-bold text-navy">ใช้คลิปนี้ไหม?</span>
            <div className="flex flex-wrap gap-1.5">
              <Stat tone="info">{(take.durationMs / 1000).toFixed(1)} วิ</Stat>
              <Stat tone="info">
                {take.frames.length} เฟรม @ {SKELETON_FPS} fps
              </Stat>
              <Stat tone={quality.hands === "ไม่พบมือ" || quality.hands === "ไม่พบ skeleton" ? "bad" : "info"}>
                {quality.hands}
              </Stat>
              {take.frames.length > 0 && (
                <Stat tone={quality.ratio >= GOOD_HAND_RATIO ? "good" : quality.ratio > 0 ? "warn" : "bad"}>
                  เห็นมือ {Math.round(quality.ratio * 100)}%
                </Stat>
              )}
            </div>
            {take.frames.length > 0 && quality.ratio < GOOD_HAND_RATIO && (
              <span className="text-xs text-amber-700">เห็นมือน้อย แนะนำให้อัดใหม่โดยให้มืออยู่ในกรอบตลอดท่า</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" icon="trash" onClick={rec.discard} disabled={saving} aria-label="ทิ้งคลิป">
              <span className="hidden sm:inline">ทิ้ง</span>
            </Button>
            <Button
              variant="ghost"
              icon={take.source === "upload" ? "upload" : "refresh"}
              onClick={retake}
              disabled={saving || (take.source === "record" && !on)}
            >
              {take.source === "upload" ? "เลือกไฟล์ใหม่" : "อัดใหม่"}
            </Button>
            <Button icon="check" onClick={() => void save()} disabled={saving || !hasWord} className="flex-1 sm:flex-none">
              {saving ? "กำลังบันทึก…" : "เก็บคลิปนี้"}
            </Button>
          </div>
        </div>
      )}

      {(rec.error || saveError) && (
        <div className="rounded-xl bg-danger/10 px-4 py-2 text-sm text-danger">{rec.error ?? saveError}</div>
      )}

      <p className="hidden text-xs text-ink/50 md:block">
        คีย์ลัด: <kbd className="font-semibold">Space</kbd> อัด/หยุด · <kbd className="font-semibold">Enter</kbd>{" "}
        เก็บคลิป · <kbd className="font-semibold">R</kbd> อัดใหม่ · <kbd className="font-semibold">Esc</kbd> ยกเลิก
      </p>
    </div>
  );
}
