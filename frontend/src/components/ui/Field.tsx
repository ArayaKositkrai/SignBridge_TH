// คอมโพเนนต์ UI พื้นฐาน: ช่องกรอกข้อมูลพร้อมชื่อและข้อความผิดพลาด

import type { InputHTMLAttributes, ReactNode } from "react";

// ค่าที่ช่องกรอกข้อมูลรับ (นอกจาก props ปกติของ <input>)
interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}

// ช่องกรอกข้อมูลพร้อมชื่อช่อง คำอธิบาย และข้อความผิดพลาด
export default function Field({ label, hint, error, className = "", id, ...rest }: Props) {
  const inputId = id ?? `f-${label}`;
  return (
    <label htmlFor={inputId} className={`flex flex-col gap-1 ${className}`}>
      <span className="text-sm font-semibold text-navy">{label}</span>
      <input
        id={inputId}
        aria-invalid={!!error}
        className={`h-11 rounded-xl border bg-surface px-3 text-sm outline-none transition placeholder:text-ink/35 focus:ring-2 disabled:bg-ink/5 disabled:text-ink/50 ${
          error ? "border-danger focus:ring-danger/20" : "border-sky focus:border-brand focus:ring-brand/20"
        }`}
        {...rest}
      />
      {error ? <span className="text-xs text-danger">{error}</span> : hint && <span className="text-xs text-ink/55">{hint}</span>}
    </label>
  );
}
