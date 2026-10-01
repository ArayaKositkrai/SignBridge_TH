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

// ค่าที่กล้องทำได้จริงหลังเปิด: เฟรมต่อวินาที และขนาดภาพ
export interface CameraSettings {
  fps: number | null;
  width: number | null;
  height: number | null;
}

// ตัวเลือกกล้อง: อัตราเฟรมที่ต้องการ (กล้องอาจให้ได้น้อยกว่า)
interface Options {
  frameRate?: number;
}

// hook เปิด/ปิด/สลับกล้อง และเชื่อมภาพเข้ากับ <video>
export function useCamera({ frameRate }: Options = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<Facing>("user");
  const [canFlip, setCanFlip] = useState(false);
  const [settings, setSettings] = useState<CameraSettings>({ fps: null, width: null, height: null });

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
          video: {
            facingMode: mode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            ...(frameRate ? { frameRate: { ideal: frameRate } } : {}),
          },
          audio: false,
        });
        streamRef.current = stream;
        const s = stream.getVideoTracks()[0]?.getSettings() ?? {};
        setSettings({ fps: s.frameRate ?? null, width: s.width ?? null, height: s.height ?? null });
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setFacing(mode);
        setStatus("on");
        // มีกล้องมากกว่า 1 ตัวถึงจะสลับกล้องได้ (โน้ตบุ๊กส่วนใหญ่มีตัวเดียว)
        navigator.mediaDevices
          .enumerateDevices()
          .then((list) => setCanFlip(list.filter((d) => d.kind === "videoinput").length > 1))
          .catch(() => setCanFlip(false));
      } catch (err) {
        setError(describeError(err));
        setStatus("error");
      }
    },
    [facing, frameRate],
  );

  // สลับระหว่างกล้องหน้ากับกล้องหลัง
  const flip = useCallback(() => {
    void start(facing === "user" ? "environment" : "user");
  }, [facing, start]);

  // ปิดกล้องอัตโนมัติเมื่อออกจากหน้า
  useEffect(() => () => stop(), [stop]);

  return { videoRef, status, error, facing, canFlip, settings, start, stop, flip };
}
