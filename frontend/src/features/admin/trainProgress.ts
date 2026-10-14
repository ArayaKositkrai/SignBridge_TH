import type { TrainProgress } from "./services/adminApi";

// ชื่อขั้นการเทรน และช่วงของแถบความคืบหน้า (0-1) ที่แต่ละขั้นใช้ (ใช้ร่วมกันทั้งหน้าโมเดลและการ์ดลอย)
export const STAGES: Record<NonNullable<TrainProgress["stage"]>, { label: string; from: number; to: number }> = {
  load: { label: "โหลดข้อมูล", from: 0, to: 0.05 },
  validate: { label: "เทรนเพื่อวัดความแม่นยำ", from: 0.05, to: 0.5 },
  final: { label: "เทรนรอบสุดท้าย", from: 0.5, to: 0.95 },
  save: { label: "บันทึกโมเดล", from: 0.95, to: 1 },
  done: { label: "เสร็จ", from: 1, to: 1 },
  failed: { label: "หยุด", from: 0, to: 0 },
};

// สัดส่วนความคืบหน้าทั้งหมด (0-1) จากขั้นและรอบที่รายงานมา
export function overall(p: TrainProgress): number {
  const stage = STAGES[p.stage ?? "load"];
  const inStage = p.epoch && p.epochs ? p.epoch / p.epochs : 0;
  return stage.from + (stage.to - stage.from) * inStage;
}
