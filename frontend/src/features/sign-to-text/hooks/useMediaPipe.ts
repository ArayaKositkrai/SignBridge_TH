import { useEffect, useRef, useState, type RefObject } from "react";
import { detect, loadHolistic } from "../../../lib/mediapipe/holistic";
import { FrameSmoother } from "../../../lib/mediapipe/smoothing";
import type { LandmarkFrame } from "../../../types";

// สถานะการโหลดโมเดล
export type ModelStatus = "idle" | "loading" | "ready" | "error";

// ค่าที่ hook รับ: ตัว <video> และเปิดใช้งานหรือไม่
interface Options {
  videoRef: RefObject<HTMLVideoElement>;
  active: boolean;
}

// hook ตรวจจับท่าทางจากวิดีโอทุกเฟรม เก็บผลล่าสุดไว้ใน ref (ไม่ทำให้หน้ารีเรนเดอร์ถี่)
//   frameRef = ผลดิบ (ส่งให้โมเดลจดจำ เหมือนข้อมูลตอนเทรน) / displayRef = ผลที่กรองให้นิ่งแล้ว (ไว้วาดทับภาพ)
export function useMediaPipe({ videoRef, active }: Options) {
  const frameRef = useRef<LandmarkFrame | null>(null);
  const displayRef = useRef<LandmarkFrame | null>(null);
  const smootherRef = useRef(new FrameSmoother());
  const frameIdRef = useRef(0);
  const [status, setStatus] = useState<ModelStatus>("idle");
  const [handsVisible, setHandsVisible] = useState(false);
  const [bodyVisible, setBodyVisible] = useState(false);
  // จำนวนเฟรมที่ตรวจจับได้ต่อวินาที (น้อย = เครื่องประมวลผลไม่ทัน ท่าที่ทำเร็วจะมีเฟรมน้อยจนจำยาก)
  const [fps, setFps] = useState(0);

  // เริ่มโหลดโมเดลและวนตรวจจับเมื่อเปิดกล้อง หยุดเมื่อปิด
  useEffect(() => {
    if (!active) {
      frameRef.current = null;
      displayRef.current = null;
      smootherRef.current.reset();
      setHandsVisible(false);
      setBodyVisible(false);
      setFps(0);
      return;
    }

    let cancelled = false;
    let raf = 0;
    let lastVideoTime = -1;
    let fpsCount = 0;
    let fpsStart = performance.now();
    let lastHands = false;
    let lastBody = false;

    setStatus("loading");
    loadHolistic()
      .then((landmarker) => {
        if (cancelled) return;
        setStatus("ready");

        // ตรวจจับทีละเฟรม (ข้ามถ้าภาพยังไม่เปลี่ยน) แล้วอัปเดตว่าเห็นตัว/มือหรือไม่
        const tick = () => {
          const video = videoRef.current;
          if (video && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
            lastVideoTime = video.currentTime;
            try {
              const frame = detect(landmarker, video, performance.now());
              frameRef.current = frame;
              displayRef.current = smootherRef.current.apply(frame, performance.now());
              frameIdRef.current += 1;
              fpsCount += 1;
              const now = performance.now();
              if (now - fpsStart >= 1000) {
                setFps(Math.round((fpsCount * 1000) / (now - fpsStart)));
                fpsCount = 0;
                fpsStart = now;
              }
              const hands = frame.leftHand.length > 0 || frame.rightHand.length > 0;
              const body = frame.pose.length > 0;
              if (hands !== lastHands) setHandsVisible((lastHands = hands));
              if (body !== lastBody) setBodyVisible((lastBody = body));
            } catch {
              // a single bad frame should not stop the loop
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      })
      .catch(() => !cancelled && setStatus("error"));

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      frameRef.current = null;
      displayRef.current = null;
    };
  }, [active, videoRef]);

  return { frameRef, displayRef, frameIdRef, status, handsVisible, bodyVisible, fps };
}
