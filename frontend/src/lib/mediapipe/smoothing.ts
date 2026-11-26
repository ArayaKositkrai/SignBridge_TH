// ตัวกรอง One-Euro ลดการสั่นของ landmark

import type { LandmarkFrame, Point } from "../../types";

// ค่าตัวกรอง One-Euro: minCutoff ยิ่งต่ำยิ่งนิ่งตอนช้า, beta ยิ่งสูงยิ่งตามทันตอนขยับเร็ว (พิกัดภาพ 0-1 ต่อวินาที)
const MIN_CUTOFF = 1.6;
const BETA = 9;
const D_CUTOFF = 1;

// ค่าสัมประสิทธิ์ของตัวกรองความถี่ต่ำ ตามความถี่ตัดและช่วงเวลาเฟรม
const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

// ตัวกรอง One-Euro ของค่าเดียว (ลดการสั่นของจุด โดยไม่หน่วงตอนขยับเร็ว)
class OneEuro {
  private x: number | null = null;
  private dx = 0;

  // กรองค่าใหม่ dt = วินาทีจากเฟรมก่อน
  filter(v: number, dt: number): number {
    if (this.x === null || dt <= 0) {
      this.x = v;
      return v;
    }
    const rate = (v - this.x) / dt;
    this.dx += alpha(D_CUTOFF, dt) * (rate - this.dx);
    const cutoff = MIN_CUTOFF + BETA * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}

// ส่วนของร่างกายที่กรองแยกกัน (หายไปส่วนไหน ล้างตัวกรองส่วนนั้นเพื่อไม่ให้ลากจากตำแหน่งเก่า)
type Part = "pose" | "leftHand" | "rightHand";
const PARTS: Part[] = ["pose", "leftHand", "rightHand"];

// ตัวกรองทั้งเฟรม: pose และมือสองข้าง (ใบหน้าส่งผ่านตามเดิม)
export class FrameSmoother {
  private filters: Record<Part, OneEuro[]> = { pose: [], leftHand: [], rightHand: [] };
  private last = 0;

  // ล้างตัวกรองทั้งหมด (เช่นตอนเปลี่ยนคลิป)
  reset() {
    this.filters = { pose: [], leftHand: [], rightHand: [] };
    this.last = 0;
  }

  // กรองหนึ่งเฟรม nowMs = เวลาของเฟรม (มิลลิวินาที) คืนเฟรมใหม่ ไม่แก้เฟรมเดิม
  apply(frame: LandmarkFrame, nowMs: number): LandmarkFrame {
    const dt = this.last ? Math.min((nowMs - this.last) / 1000, 0.5) : 0;
    this.last = nowMs;
    const out: LandmarkFrame = { ...frame };
    for (const part of PARTS) {
      const pts = frame[part];
      if (!pts.length) {
        this.filters[part] = [];
        continue;
      }
      const f = this.filters[part];
      out[part] = pts.map((p, i): Point => {
        const fx = (f[i * 3] ??= new OneEuro());
        const fy = (f[i * 3 + 1] ??= new OneEuro());
        const fz = (f[i * 3 + 2] ??= new OneEuro());
        return { ...p, x: fx.filter(p.x, dt), y: fy.filter(p.y, dt), z: p.z === undefined ? p.z : fz.filter(p.z, dt) };
      });
    }
    return out;
  }
}
