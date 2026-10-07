import type { ButtonHTMLAttributes } from "react";

// ค่าที่ชิปรับ: active = เลือกอยู่
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

// ป้ายกลมเล็ก ใช้แสดงคำหรือให้กดเลือก
export default function Chip({ active, className = "", children, ...rest }: Props) {
  return (
    <button
      type="button"
      className={`rounded-full px-3 py-1 text-sm font-medium transition ${
        active
          ? "bg-deep text-white"
          : "bg-sky/50 text-navy hover:bg-sky"
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
