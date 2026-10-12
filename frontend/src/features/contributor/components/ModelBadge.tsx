import type { ModelsBrief, WordModelStatus } from "../services/contributorApi";

// ค่าที่ป้ายรับ: สถานะของคำในโมเดล และข้อมูลเวอร์ชัน
interface Props {
  status?: WordModelStatus;
  models: ModelsBrief | null;
  compact?: boolean;
}

// สีตามความแม่นยำ: ดี (≥70%) พอใช้ (40-70%) ต่ำ (<40%)
function tone(acc: number | null) {
  if (acc == null) return "bg-sky/50 text-navy";
  if (acc >= 0.7) return "bg-emerald-100 text-emerald-700";
  if (acc >= 0.4) return "bg-amber-100 text-amber-700";
  return "bg-danger/10 text-danger";
}

// ป้ายบอกว่าคำนี้อยู่ในโมเดลเวอร์ชันไหน และทายถูกกี่ % เมื่อทดสอบกับคนที่โมเดลไม่เคยเห็น
export default function ModelBadge({ status, models, compact }: Props) {
  const pick = status?.active.included ? "active" : status?.draft.included ? "draft" : null;
  if (!pick || !models) {
    return <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs text-ink/50">ยังไม่อยู่ในโมเดล</span>;
  }
  const acc = status![pick].accuracy;
  const label = models[pick].label ?? "";
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${tone(acc)}`}
      title={acc == null ? "ไม่มีคลิปของคนใหม่ให้วัดผลคำนี้" : "ทดสอบกับล่ามที่โมเดลไม่เคยเห็น"}
    >
      {pick === "draft" ? "Draft " : compact ? "" : "ใช้งาน "}
      {label}
      <span className="font-normal opacity-80">· {acc == null ? "ยังไม่ได้วัด" : `ถูก ${Math.round(acc * 100)}%`}</span>
    </span>
  );
}
