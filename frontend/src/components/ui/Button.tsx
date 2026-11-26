// คอมโพเนนต์ UI พื้นฐาน: ปุ่มที่ใช้ทั้งแอป

import type { ButtonHTMLAttributes, ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

// แบบของปุ่ม: หลัก อ่อน โปร่ง อันตราย
type Variant = "primary" | "soft" | "ghost" | "danger";
// ขนาดของปุ่ม
type Size = "sm" | "md" | "lg";

// ค่าที่ปุ่มรับได้ (นอกจาก props ปกติของ <button>)
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  children?: ReactNode;
}

// สไตล์ของแต่ละแบบ
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-gradient-to-br from-brand to-deep text-white shadow-[0_8px_18px_-8px_rgba(24,80,121,.7)] hover:brightness-110 hover:-translate-y-px",
  soft: "bg-sky/60 text-navy hover:bg-sky",
  ghost: "bg-surface text-ink ring-1 ring-sky hover:bg-sky/40 hover:-translate-y-px",
  danger:
    "bg-gradient-to-br from-danger to-danger-dark text-white shadow-[0_8px_18px_-8px_rgba(214,40,57,.7)] hover:brightness-110",
};

// สไตล์ของแต่ละขนาด
const SIZES: Record<Size, string> = {
  sm: "h-9 px-3 text-sm gap-1.5",
  md: "h-11 px-4 text-sm gap-2",
  lg: "h-14 px-6 text-base gap-2.5",
};

// ปุ่มกลาง ใช้ทั้งแอป (รองรับไอคอนนำหน้า)
export default function Button({
  variant = "primary",
  size = "md",
  icon,
  className = "",
  children,
  ...rest
}: Props) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-xl font-semibold transition duration-200 active:scale-[.98] disabled:pointer-events-none disabled:opacity-45 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === "lg" ? 22 : 18} />}
      {children}
    </button>
  );
}
