import { pickFaceKeypoints } from "../../../lib/mediapipe/faceKeypoints";
import { detect, loadHolistic } from "../../../lib/mediapipe/holistic";
import type { LandmarkFrame, Point } from "../../../types";
import type { CapturedFrame } from "./contributorApi";

// อัตราเฟรมของ skeleton (เท่ากับคลิปอ้างอิงในชุดข้อมูล 50 fps)
export const SKELETON_FPS = 50;
// ความยาวสูงสุดของวิดีโอที่อัปโหลด (วินาที) ให้ไม่เกินจำนวนเฟรมที่ backend รับ
export const MAX_UPLOAD_SEC = 30;
// เวลารอ event ของวิดีโอสูงสุด ก่อนถือว่าไฟล์เสีย
const EVENT_TIMEOUT_MS = 8000;
// เฟรมที่ห่างจากเวลาที่ขอเกินนี้ จะไม่นำมาวาด
const MAX_GAP_MS = 150;

// ปัดทศนิยม 4 ตำแหน่ง ลดขนาดไฟล์ landmarks
const round = (v: number) => Math.round(v * 1e4) / 1e4;
// ปัดค่าของทุกจุด
const roundPts = (pts: Point[]): Point[] =>
  pts.map((p) => ({ x: round(p.x), y: round(p.y), z: round(p.z ?? 0) }));

// แปลงผล MediaPipe หนึ่งเฟรมเป็นเฟรมที่เก็บไปเทรน (ใบหน้าเก็บเฉพาะจุดสำคัญ ไม่เห็นหน้า = รายการว่าง)
export function toCaptured(f: LandmarkFrame, t: number): CapturedFrame {
  return {
    t: Math.round(t),
    pose: roundPts(f.pose),
    leftHand: roundPts(f.leftHand),
    rightHand: roundPts(f.rightHand),
    face: roundPts(pickFaceKeypoints(f.face)),
  };
}

// หาเฟรมที่ใกล้เวลาที่ขอที่สุด (ค้นหาแบบแบ่งครึ่ง) แล้วแปลงเป็นรูปแบบสำหรับวาด
export function frameAt(frames: CapturedFrame[], ms: number): LandmarkFrame | null {
  if (!frames.length) return null;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < ms) lo = mid + 1;
    else hi = mid;
  }
  const best =
    lo > 0 && Math.abs(frames[lo - 1].t - ms) < Math.abs(frames[lo].t - ms) ? frames[lo - 1] : frames[lo];
  // ใบหน้าที่เก็บเป็นแค่จุดสำคัญ จึงวาดแยกจากโครงหน้าเต็ม (faceKeypoints)
  return Math.abs(best.t - ms) > MAX_GAP_MS ? null : { ...best, face: [], faceKeypoints: best.face ?? [] };
}

// รอ event ของวิดีโอ (ล้มเหลวถ้าไฟล์เสีย ถูกยกเลิก หรือรอนานเกินไป)
function waitFor(video: HTMLVideoElement, event: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const done = (fn: () => void) => {
      clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      video.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
      fn();
    };
    const onEvent = () => done(resolve);
    const onError = () => done(() => reject(new Error("เปิดไฟล์วิดีโอนี้ไม่ได้")));
    const onAbort = () => done(() => reject(new DOMException("aborted", "AbortError")));
    const timer = window.setTimeout(() => done(() => reject(new Error("อ่านวิดีโอนานเกินไป"))), EVENT_TIMEOUT_MS);
    video.addEventListener(event, onEvent);
    video.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort);
  });
}

// เลื่อนวิดีโอไปยังเวลาที่ต้องการแล้วรอจนภาพพร้อม
async function seek(video: HTMLVideoElement, t: number, signal: AbortSignal) {
  const ready = waitFor(video, "seeked", signal);
  video.currentTime = t;
  await ready;
}

// หาความยาววิดีโอ (ไฟล์ webm บางไฟล์บอกเป็น Infinity ต้องเลื่อนไปท้ายไฟล์ก่อน)
async function resolveDuration(video: HTMLVideoElement, signal: AbortSignal) {
  if (Number.isFinite(video.duration)) return video.duration;
  await seek(video, 1e7, signal);
  const duration = video.duration;
  await seek(video, 0, signal);
  return duration;
}

// ผลการสกัด skeleton: เฟรม ความยาว และขนาดวิดีโอ
export interface ExtractResult {
  frames: CapturedFrame[];
  durationMs: number;
  width: number;
  height: number;
}

// สกัด skeleton จากไฟล์วิดีโอทีละเฟรม (เลื่อนทีละ 1/50 วินาที) พร้อมรายงานความคืบหน้า 0-1
export async function extractFromVideo(
  url: string,
  onProgress: (p: number) => void,
  signal: AbortSignal,
): Promise<ExtractResult> {
  const landmarker = await loadHolistic();
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    const loaded = waitFor(video, "loadeddata", signal);
    video.src = url;
    await loaded;
    const duration = await resolveDuration(video, signal);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("อ่านความยาววิดีโอไม่ได้");
    if (duration > MAX_UPLOAD_SEC) {
      throw new Error(`คลิปยาว ${Math.round(duration)} วินาที เกิน ${MAX_UPLOAD_SEC} วินาที กรุณาตัดให้เหลือเฉพาะท่าของคำนี้`);
    }

    const frames: CapturedFrame[] = [];
    for (let t = 0.5 / SKELETON_FPS; t < duration; t += 1 / SKELETON_FPS) {
      await seek(video, t, signal);
      frames.push(toCaptured(detect(landmarker, video, performance.now()), video.currentTime * 1000));
      onProgress(Math.min(1, t / duration));
    }
    onProgress(1);
    return { frames, durationMs: duration * 1000, width: video.videoWidth, height: video.videoHeight };
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
