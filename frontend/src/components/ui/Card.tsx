// คอมโพเนนต์ UI พื้นฐาน: การ์ดจัดกลุ่มเนื้อหา

import type { HTMLAttributes, ReactNode } from "react";

// ค่าที่การ์ดรับ: หัวข้อ และปุ่มที่มุมขวาบน
interface Props extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  action?: ReactNode;
}

// การ์ดพื้นโปร่งแสงสำหรับจัดกลุ่มเนื้อหา
export default function Card({ title, action, className = "", children, ...rest }: Props) {
  return (
    <section className={`glass-card animate-fadeUp ${className}`} {...rest}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && (
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
              <span className="h-3.5 w-1 rounded-full bg-gradient-to-b from-brand to-royal" />
              {title}
            </h3>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
