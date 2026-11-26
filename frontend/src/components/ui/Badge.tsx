// คอมโพเนนต์ UI พื้นฐาน: ป้ายสถานะ

import type { ReactNode } from "react";

// โทนสีของป้าย
export type Tone = "neutral" | "brand" | "navy" | "success" | "warning" | "danger";

// สีของแต่ละโทน
const TONES: Record<Tone, string> = {
  neutral: "bg-ink/5 text-ink/70 ring-ink/10",
  brand: "bg-brand/10 text-brand ring-brand/20",
  navy: "bg-deep text-white ring-deep",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-danger/10 text-danger ring-danger/20",
};

// ป้ายสถานะเล็ก ๆ
export default function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}
