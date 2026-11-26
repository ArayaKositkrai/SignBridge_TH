// hook คุมการเล่นท่าทีละคำ

import { useCallback, useEffect, useRef, useState } from "react";
import type { SignClip } from "../../../types";

// ระยะเวลาต่อคำเมื่อคำนั้นไม่ได้กำหนดไว้
const DEFAULT_CLIP_MS = 1800;
// อัปเดต state ของแถบความคืบหน้าทุกกี่มิลลิวินาที
const STATE_UPDATE_MS = 80;

// ระยะเวลาของคลิปหนึ่งคำ
export const clipDuration = (clip: SignClip | null) => clip?.motion?.duration ?? DEFAULT_CLIP_MS;

// hook คุมการเล่นคำต่อคำ: เล่น หยุด ข้าม และความคืบหน้า
export function useSignPlayback(clips: SignClip[]) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [clipProgress, setClipProgress] = useState(0);
  // Read every animation frame by the avatar; React state above is throttled for the UI.
  // ความคืบหน้าของคำปัจจุบัน ตัวละครอ่านทุกเฟรม ส่วน state ข้างบนอัปเดตถี่น้อยกว่าสำหรับหน้าจอ
  const progressRef = useRef(0);

  const current = clips[index] ?? null;

  // ตั้งความคืบหน้าทั้งใน ref และ state
  const setProgress = useCallback((p: number) => {
    progressRef.current = p;
    setClipProgress(p);
  }, []);

  // เริ่มเล่นใหม่ตั้งแต่คำแรกเมื่อได้รายการคำชุดใหม่
  useEffect(() => {
    setIndex(0);
    setProgress(0);
    setPlaying(clips.length > 0);
  }, [clips, setProgress]);

  // ไปคำถัดไป หรือหยุดเมื่อจบทุกคำ
  const advance = useCallback(() => {
    if (index + 1 < clips.length) {
      setProgress(0);
      setIndex(index + 1);
    } else {
      setProgress(1);
      setPlaying(false);
    }
  }, [index, clips.length, setProgress]);

  useEffect(() => {
    // เล่นท่าของคำปัจจุบันด้วย requestAnimationFrame เมื่อจบคำจะไปคำถัดไปเอง (คำที่มีวิดีโอใช้เวลาของวิดีโอแทน)
    if (!playing || !current || current.url) return;
    const duration = clipDuration(current);
    const startedAt = performance.now() - progressRef.current * duration;
    let raf = 0;
    let lastUi = 0;
    const tick = (now: number) => {
      const p = Math.min((now - startedAt) / duration, 1);
      progressRef.current = p;
      if (now - lastUi > STATE_UPDATE_MS || p >= 1) {
        lastUi = now;
        setClipProgress(p);
      }
      if (p >= 1) advance();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, current, advance]);

  // เล่น/หยุดชั่วคราว (ถ้าเล่นจบแล้วจะเริ่มใหม่จากคำแรก)
  const toggle = useCallback(() => {
    if (!clips.length) return;
    if (!playing && index === clips.length - 1 && progressRef.current >= 1) {
      setIndex(0);
      setProgress(0);
    }
    setPlaying((p) => !p);
  }, [clips.length, playing, index, setProgress]);

  // กระโดดไปเล่นคำที่เลือก
  const seek = useCallback(
    (i: number) => {
      setIndex(i);
      setProgress(0);
      setPlaying(true);
    },
    [setProgress],
  );

  const total = clips.length || 1;
  const progress = Math.min((index + clipProgress) / total, 1);

  return { current, index, playing, progress, progressRef, toggle, seek, advance, setClipProgress: setProgress };
}
