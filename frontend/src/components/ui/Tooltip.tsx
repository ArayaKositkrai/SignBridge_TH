// คอมโพเนนต์ UI พื้นฐาน: tooltip และไอคอนคำอธิบาย (HintIcon)

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Icon, { type IconName } from "./Icon";

// ค่าที่ tooltip รับ: ข้อความที่จะแสดง และสิ่งที่ชี้ (ไอคอน/ข้อความ)
interface Props {
  text: ReactNode;
  children: ReactNode;
  className?: string;
  // กล่องกว้างขึ้นสำหรับคำอธิบายยาว ๆ
  wide?: boolean;
}

// กล่องข้อความอธิบายเมื่อชี้เมาส์ โฟกัสด้วยคีย์บอร์ด หรือแตะ (มือถือ) — วางลอยบน body จึงไม่ถูกตารางที่เลื่อนได้ตัดขอบ
export default function Tooltip({ text, children, className = "", wide = false }: Props) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);

  // คำนวณตำแหน่งเหนือสิ่งที่ชี้ (ถ้าชิดขอบบนจอ แสดงด้านล่างแทน)
  const show = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.top < 90;
    setPos({ x: Math.min(Math.max(r.left + r.width / 2, 130), window.innerWidth - 130), y: below ? r.bottom + 8 : r.top - 8, below });
  }, []);
  const hide = useCallback(() => setPos(null), []);

  // ซ่อนเมื่อเลื่อนหน้า/แตะที่อื่น (ตำแหน่งเดิมจะไม่ตรงแล้ว)
  useEffect(() => {
    if (!pos) return;
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) hide();
    };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("pointerdown", away);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("pointerdown", away);
    };
  }, [pos, hide]);

  return (
    <>
      <span
        ref={ref}
        tabIndex={0}
        aria-describedby={pos ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.stopPropagation();
          if (pos) hide();
          else show();
        }}
        onKeyDown={(e) => e.key === "Escape" && hide()}
        className={`inline-flex cursor-help items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-royal ${className}`}
      >
        {children}
      </span>
      {pos &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={{ left: pos.x, top: pos.y }}
            className={`pointer-events-none fixed z-[60] w-max ${wide ? "max-w-[22rem]" : "max-w-[16rem]"} -translate-x-1/2 rounded-lg bg-ink px-2.5 py-1.5 text-xs font-normal leading-snug text-cream shadow-lg animate-fadeUp dark:bg-slate-100 dark:text-slate-900 ${
              pos.below ? "" : "-translate-y-full"
            }`}
          >
            {text}
          </span>,
          document.body,
        )}
    </>
  );
}

// โทนสีของไอคอนเตือน
const TONES = {
  warning: "text-amber-600",
  danger: "text-danger",
  info: "text-brand",
} as const;

// ไอคอนเตือน (alert) หรือคำอธิบาย (help = เครื่องหมาย ? โทน info) พร้อม tooltip (ผู้อ่านหน้าจออ่านข้อความได้ด้วย)
export function HintIcon({
  text,
  tone = "warning",
  icon = "alert",
  size = 15,
  wide = false,
}: {
  text: string;
  tone?: keyof typeof TONES;
  icon?: IconName;
  size?: number;
  wide?: boolean;
}) {
  return (
    <Tooltip text={text} wide={wide}>
      <Icon name={icon} size={size} className={TONES[tone]} />
      <span className="sr-only">{text}</span>
    </Tooltip>
  );
}
