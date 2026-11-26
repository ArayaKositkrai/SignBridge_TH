// หัวหน้าย่อยในแอดมิน

import type { ReactNode } from "react";

// ค่าที่หัวหน้ารับ: ชื่อหน้า คำอธิบายสั้น และปุ่มหลักทางขวา
interface Props {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}

// หัวของทุกหน้าในแอดมิน: ชื่อ + คำอธิบายทางซ้าย ปุ่มหลักทางขวา (จอเล็กปุ่มลงไปอยู่ใต้ชื่อ)
export default function PageHeader({ title, description, actions }: Props) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-navy">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink/60">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
