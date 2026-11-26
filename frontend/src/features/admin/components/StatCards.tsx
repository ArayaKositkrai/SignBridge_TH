// แถบตัวเลขสรุปที่กดเพื่อกรองตาราง

import type { ReactNode } from "react";

// ตัวเลขสรุปหนึ่งช่อง (value = ตัวกรองที่จะใช้เมื่อกด ไม่ใส่ = กดไม่ได้)
export interface Stat {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  filter?: string;
  tone?: "default" | "warning" | "danger" | "success";
}

// ค่าที่แถบตัวเลขรับ: รายการ ตัวกรองที่เลือกอยู่ และฟังก์ชันเมื่อกด
interface Props {
  stats: Stat[];
  active?: string;
  onSelect?: (filter: string) => void;
}

// สีตัวเลขตามโทน
const TONE: Record<NonNullable<Stat["tone"]>, string> = {
  default: "text-navy",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-danger",
  success: "text-emerald-600 dark:text-emerald-400",
};

// แถบตัวเลขสรุปขนาดเท่ากันทุกช่อง กดช่องเพื่อกรองตาราง (กดซ้ำ = ยกเลิก)
export default function StatCards({ stats, active, onSelect }: Props) {
  const cols = stats.length <= 3 ? "sm:grid-cols-3" : stats.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3 lg:grid-cols-5";
  return (
    <div className={`mb-4 grid grid-cols-2 gap-3 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1 ${cols}`}>
      {stats.map((s) => {
        const clickable = !!(s.filter && onSelect);
        const selected = clickable && active === s.filter;
        const body = (
          <>
            <span className="block text-xs font-medium text-ink/55">{s.label}</span>
            <span className={`mt-1 block text-2xl font-bold tabular-nums ${TONE[s.tone ?? "default"]}`}>{s.value}</span>
            {s.hint && <span className="mt-0.5 block truncate text-[11px] text-ink/45">{s.hint}</span>}
          </>
        );
        const base = "rounded-2xl bg-surface/80 px-4 py-3 text-left ring-1 transition";
        return clickable ? (
          <button
            key={s.label}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect!(selected ? "" : s.filter!)}
            className={`${base} ${selected ? "ring-2 ring-brand" : "ring-sky hover:ring-brand/60"}`}
          >
            {body}
          </button>
        ) : (
          <div key={s.label} className={`${base} ring-sky`}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
