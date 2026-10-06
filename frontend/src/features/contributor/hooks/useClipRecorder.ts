import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { logEvent } from "../../../lib/activityLog";
import type { CapturedFrame } from "../services/contributorApi";
import { extractFromVideo, flipFrames, SKELETON_FPS } from "../services/extractLandmarks";
import { LANDMARK_EXTS, parseLandmarkFile } from "../services/parseLandmarkFile";

// สถานะ: ว่าง นับถอยหลัง กำลังอัด กำลังสร้าง skeleton ตรวจดูคลิป
export type RecorderState = "idle" | "countdown" | "recording" | "processing" | "review";

// คลิปที่อัด/เลือกไว้ รอตรวจก่อนกดเก็บ (ไฟล์ .npy/.npz ไม่มีวิดีโอ: blob และ url เป็น null)
export interface Take {
  blob: Blob | null;
  url: string | null;
  fileName: string;
  source: "record" | "upload";
  frames: CapturedFrame[];
  durationMs: number;
  // ขนาดภาพ (0 = ไม่ทราบ ให้ backend ประมาณสัดส่วนเอง)
  width: number;
  height: number;
  // อัตราเฟรมของ skeleton
  fps: number;
  // frames ถูกกลับซ้าย-ขวาแล้ว (คลิปกล้องหน้า) จึงต้องกลับ x คืนตอนวาดทับวิดีโอ
  flipped: boolean;
}

// ตัวเลือกตอนเลือกไฟล์: flip = ไฟล์เป็นภาพกระจก (กล้องหน้า) ให้กลับซ้าย-ขวาก่อนเก็บ
export interface LoadOptions {
  flip?: boolean;
}

// ค่าที่ hook รับ: วิดีโอกล้อง เวลานับถอยหลัง และความยาวสูงสุด (วินาที)
interface Options {
  videoRef: RefObject<HTMLVideoElement>;
  countdownSec?: number;
  maxSec?: number;
}

// รูปแบบวิดีโอที่ลองใช้ตามลำดับ (Chrome/Edge ใช้ webm, Safari ใช้ mp4)
const MIME_CANDIDATES: [string, string][] = [
  ["video/webm;codecs=vp9", "webm"],
  ["video/webm;codecs=vp8", "webm"],
  ["video/webm", "webm"],
  ["video/mp4", "mp4"],
];

// คุณภาพวิดีโอที่อัด (บิตต่อวินาที) ให้ภาพคมพอสำหรับจับนิ้ว
const VIDEO_BITRATE = 6_000_000;

// นามสกุลไฟล์ที่อัปโหลดได้ (ต้องตรงกับ backend)
export const VIDEO_EXTS = [".mp4", ".webm", ".mov", ".mkv", ".m4v", ".avi", ".3gp", ".ogv"];
// ไฟล์ที่เลือกได้ทั้งหมด: วิดีโอ และ skeleton (.npy/.npz)
export const UPLOAD_EXTS = [...VIDEO_EXTS, ...LANDMARK_EXTS];
// ขนาดวิดีโอสูงสุด (MB) ต้องตรงกับ backend (ขนาดไฟล์สูงสุดของ Supabase Storage)
export const MAX_VIDEO_MB = 50;

// เลือกรูปแบบวิดีโอที่เบราว์เซอร์อัดได้ (null = อัดไม่ได้)
function pickMime(): [string, string] | null {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_CANDIDATES.find(([m]) => MediaRecorder.isTypeSupported(m)) ?? null;
}

// hook อัดคลิปจากกล้อง (นับถอยหลัง → อัด → สร้าง skeleton 50 fps → ตรวจดู) หรือรับไฟล์วิดีโอ
export function useClipRecorder({ videoRef, countdownSec = 3, maxSec = 5 }: Options) {
  const [state, setState] = useState<RecorderState>("idle");
  const [count, setCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef(0);
  const rafRef = useRef(0);
  const abortRef = useRef(false);
  const extractRef = useRef<AbortController | null>(null);

  // คืนหน่วยความจำของวิดีโอเก่าเมื่อเปลี่ยนคลิปหรือออกจากหน้า
  useEffect(() => {
    if (!take?.url) return;
    const url = take.url;
    return () => URL.revokeObjectURL(url);
  }, [take]);

  // สร้าง skeleton จากวิดีโอ (ทั้งคลิปที่อัดและไฟล์ที่อัปโหลด) แล้วเข้าสู่ขั้นตรวจดู
  const process = useCallback((blob: Blob, fileName: string, source: Take["source"], flip = false) => {
    extractRef.current?.abort();
    const ctrl = new AbortController();
    extractRef.current = ctrl;
    const url = URL.createObjectURL(blob);
    setTake(null);
    setProgress(0);
    setState("processing");

    extractFromVideo(url, setProgress, ctrl.signal)
      .then((r) => {
        if (ctrl.signal.aborted) throw new DOMException("aborted", "AbortError");
        setTake({
          blob,
          url,
          fileName,
          source,
          ...r,
          frames: flip ? flipFrames(r.frames) : r.frames,
          fps: SKELETON_FPS,
          flipped: flip,
        });
        setState("review");
      })
      .catch((e) => {
        URL.revokeObjectURL(url);
        if (ctrl.signal.aborted) return;
        setError(e instanceof Error ? e.message : "สร้าง skeleton จากวิดีโอไม่สำเร็จ");
        setState("idle");
      });
  }, []);

  // เริ่มอัดจริงด้วย MediaRecorder (ใช้ภาพกล้องขนาดเดิม) และหยุดเองเมื่อครบเวลา
  const begin = useCallback(
    (stream: MediaStream, [mime, ext]: [string, string]) => {
      let rec: MediaRecorder;
      try {
        if (!stream.active) throw new Error("camera stopped");
        rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: VIDEO_BITRATE });
      } catch {
        setError("ไม่สามารถเริ่มอัดวิดีโอได้");
        setState("idle");
        return;
      }
      const chunks: Blob[] = [];
      const t0 = performance.now();

      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        cancelAnimationFrame(rafRef.current);
        recorderRef.current = null;
        if (abortRef.current) {
          abortRef.current = false;
          setState("idle");
          return;
        }
        process(new Blob(chunks, { type: rec.mimeType || mime }), `clip.${ext}`, "record");
      };

      // วนทุกเฟรมจอ: อัปเดตเวลา และหยุดเองเมื่อครบเวลา
      const loop = () => {
        const now = performance.now() - t0;
        setElapsed(Math.floor(now / 100) * 100);
        if (now >= maxSec * 1000) {
          if (rec.state === "recording") rec.stop();
          return;
        }
        rafRef.current = requestAnimationFrame(loop);
      };

      try {
        rec.start(250);
      } catch {
        setError("ไม่สามารถเริ่มอัดวิดีโอได้");
        setState("idle");
        return;
      }
      recorderRef.current = rec;
      setElapsed(0);
      setState("recording");
      rafRef.current = requestAnimationFrame(loop);
    },
    [maxSec, process],
  );

  // กดอัด: ล้างคลิปเดิม แล้วนับถอยหลังก่อนเริ่มอัด
  const start = useCallback(() => {
    const stream = videoRef.current?.srcObject;
    if (!(stream instanceof MediaStream) || !stream.active) {
      setError("กรุณาเปิดกล้องก่อนอัดคลิป");
      return;
    }
    const mime = pickMime();
    if (!mime) {
      setError("เบราว์เซอร์นี้ไม่รองรับการอัดวิดีโอ ลองใช้ Chrome หรือ Edge");
      return;
    }
    setTake(null);
    setError(null);
    logEvent("เริ่มอัดคลิป");
    if (countdownSec <= 0) {
      begin(stream, mime);
      return;
    }
    let n = countdownSec;
    setCount(n);
    setState("countdown");
    timerRef.current = window.setInterval(() => {
      n -= 1;
      if (n > 0) {
        setCount(n);
        return;
      }
      window.clearInterval(timerRef.current);
      begin(stream, mime);
    }, 1000);
  }, [videoRef, countdownSec, begin]);

  // หยุดอัดก่อนครบเวลา (ได้คลิปเท่าที่อัดไว้)
  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      logEvent("หยุดอัดคลิป");
      recorderRef.current.stop();
    }
  }, []);

  // ยกเลิกระหว่างนับถอยหลัง กำลังอัด หรือกำลังสร้าง skeleton (ไม่เก็บคลิป)
  const cancel = useCallback(() => {
    logEvent("ยกเลิกการอัด/สร้าง skeleton");
    window.clearInterval(timerRef.current);
    extractRef.current?.abort();
    if (recorderRef.current?.state === "recording") {
      abortRef.current = true;
      recorderRef.current.stop();
    } else {
      setState("idle");
    }
  }, []);

  // ทิ้งคลิปที่ตรวจอยู่ กลับไปพร้อมอัด
  const discard = useCallback(() => {
    logEvent("ทิ้งคลิป");
    setTake(null);
    setState("idle");
  }, []);

  // ล้างคลิปหลังบันทึกสำเร็จ กลับไปพร้อมอัด (ไม่นับเป็นการทิ้ง)
  const reset = useCallback(() => {
    setTake(null);
    setState("idle");
  }, []);

  // เลือกไฟล์จากเครื่อง: วิดีโอสร้าง skeleton เหมือนคลิปที่อัด ส่วน .npy/.npz อ่าน skeleton ตรง ๆ
  const loadFile = useCallback(
    (file: File, { flip = false }: LoadOptions = {}) => {
      const dot = file.name.lastIndexOf(".");
      const ext = dot < 0 ? "" : file.name.slice(dot).toLowerCase();
      const isLandmarks = LANDMARK_EXTS.includes(ext);
      // นามสกุลไม่รู้จักแต่เบราว์เซอร์บอกว่าเป็นวิดีโอ ก็ยอมรับ
      const isVideo = VIDEO_EXTS.includes(ext) || file.type.startsWith("video/");
      if (!isLandmarks && !isVideo) {
        setError(`รองรับเฉพาะไฟล์ ${UPLOAD_EXTS.join(", ")}`);
        return;
      }
      if (!isLandmarks && file.size > MAX_VIDEO_MB * 1024 * 1024) {
        setError(`ไฟล์ใหญ่เกิน ${MAX_VIDEO_MB} MB กรุณาตัดคลิปให้สั้นลงหรือลดความละเอียด`);
        return;
      }
      setError(null);
      if (!isLandmarks) {
        logEvent("อัปโหลดไฟล์วิดีโอ");
        process(file, file.name, "upload", flip);
        return;
      }
      logEvent("อัปโหลดไฟล์ skeleton");
      extractRef.current?.abort();
      const ctrl = new AbortController();
      extractRef.current = ctrl;
      setTake(null);
      setProgress(0);
      setState("processing");
      parseLandmarkFile(file)
        .then((r) => {
          if (ctrl.signal.aborted) return;
          setTake({
            blob: null,
            url: null,
            fileName: file.name,
            source: "upload",
            frames: flip ? flipFrames(r.frames) : r.frames,
            durationMs: r.durationMs,
            width: r.width,
            height: r.height,
            fps: r.fps,
            flipped: false,
          });
          setState("review");
        })
        .catch((e) => {
          if (ctrl.signal.aborted) return;
          setError(e instanceof Error ? e.message : "อ่านไฟล์ skeleton ไม่สำเร็จ");
          setState("idle");
        });
    },
    [process],
  );

  // ออกจากหน้าระหว่างอัด/สกัด: หยุดทุกอย่างและไม่เก็บคลิป
  useEffect(
    () => () => {
      window.clearInterval(timerRef.current);
      cancelAnimationFrame(rafRef.current);
      extractRef.current?.abort();
      if (recorderRef.current?.state === "recording") {
        abortRef.current = true;
        recorderRef.current.stop();
      }
    },
    [],
  );

  return { state, count, elapsed, maxSec, progress, take, error, start, stop, cancel, discard, reset, loadFile };
}
