import { WS_URL } from "../../../config/env";
import type { LandmarkFrame, SignResult, SocketStatus } from "../../../types";

// จุดหนึ่งจุดในรูปแบบ [x, y, z]
type Pt = [number, number, number];

// แปลงรายการจุดเป็นรูปแบบกะทัดรัดสำหรับส่ง
const pack = (pts: { x: number; y: number; z?: number }[]): Pt[] =>
  pts.map((p) => [p.x, p.y, p.z ?? 0]);

// ตัวจัดการ WebSocket ไป /ws/sign-to-text ต่อใหม่เองเมื่อหลุด (version = draft ใช้ทดสอบโมเดลที่ยังไม่เผยแพร่)
export class SignSocket {
  private ws: WebSocket | null = null;
  private retry = 0;
  private closed = false;
  private timer: number | undefined;

  constructor(
    private onResult: (r: SignResult) => void,
    private onStatus: (s: SocketStatus) => void,
    private version: "active" | "draft" = "active",
  ) {}

  // เปิดการเชื่อมต่อ (หลุดแล้วลองใหม่ด้วยเวลาที่เพิ่มขึ้นเรื่อย ๆ)
  connect() {
    this.closed = false;
    this.onStatus("connecting");
    const query = this.version === "draft" ? "?version=draft" : "";
    const ws = new WebSocket(`${WS_URL}/ws/sign-to-text${query}`);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.onStatus("open");
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "result") this.onResult(msg as SignResult);
      } catch {
        // ignore malformed message
      }
    };
    ws.onclose = () => {
      this.onStatus("closed");
      if (this.closed) return;
      const delay = Math.min(1000 * 2 ** this.retry++, 8000);
      this.timer = window.setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  // ส่ง landmarks ของหนึ่งเฟรม พร้อมสัดส่วนภาพ (กว้าง/สูง) ของกล้อง (ถ้ายังเชื่อมต่อไม่พร้อมจะข้าม)
  send(frame: LandmarkFrame, aspect: number) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: "landmarks",
        ts: Date.now(),
        pose: pack(frame.pose),
        left_hand: pack(frame.leftHand),
        right_hand: pack(frame.rightHand),
        aspect,
      }),
    );
  }

  // ปิดการเชื่อมต่อและหยุดต่อใหม่
  close() {
    this.closed = true;
    window.clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
  }
}
