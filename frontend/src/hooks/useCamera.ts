import { useCallback, useEffect, useRef, useState } from "react";

// สถานะกล้อง: ปิด กำลังเปิด เปิดอยู่ ผิดพลาด
export type CameraStatus = "idle" | "starting" | "on" | "error";
// ทิศของกล้อง: หน้า (user) หรือหลัง (environment)
export type Facing = "user" | "environment";

// แปลงข้อผิดพลาดของกล้องเป็นข้อความไทยที่เข้าใจง่าย
function describeError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError") return "ไม่ได้รับอนุญาตให้ใช้กล้อง กรุณาอนุญาตในเบราว์เซอร์";
  if (name === "NotFoundError") return "ไม่พบกล้องในอุปกรณ์นี้";
  if (name === "NotReadableError") return "กล้องถูกใช้งานโดยแอปอื่นอยู่";
  if (!window.isSecureContext) return "กล้องใช้ได้เฉพาะ localhost หรือ HTTPS";
  return "ไม่สามารถเปิดกล้องได้";
}

// hook เปิด/ปิด/สลับกล้อง และเชื่อมภาพเข้ากับ <video>
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<Facing>("user");

  // ปิดกล้องและปล่อยทรัพยากร
  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus("idle");
  }, []);

  // ขออนุญาตและเปิดกล้อง (ระบุกล้องหน้าหรือหลังได้)
  const start = useCallback(
    async (mode: Facing = facing) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("เบราว์เซอร์นี้ไม่รองรับการใช้กล้อง");
        setStatus("error");
        return;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setStatus("starting");
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setFacing(mode);
        setStatus("on");
      } catch (err) {
        setError(describeError(err));
        setStatus("error");
      }
    },
    [facing],
  );

  // สลับระหว่างกล้องหน้ากับกล้องหลัง
  const flip = useCallback(() => {
    void start(facing === "user" ? "environment" : "user");
  }, [facing, start]);

  // ปิดกล้องอัตโนมัติเมื่อออกจากหน้า
  useEffect(() => () => stop(), [stop]);

  return { videoRef, status, error, facing, start, stop, flip };
}
