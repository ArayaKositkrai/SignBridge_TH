import { useEffect, type ReactNode } from "react";
import Icon from "./Icon";

// ความกว้างของหน้าต่าง
const SIZES = { md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" } as const;

// ค่าที่หน้าต่างแก้ไขรับ
interface Props {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZES;
}

// หน้าต่างแก้ไข/รายละเอียดกลางจอ (มือถือขึ้นจากด้านล่าง) พื้นทึบทั้งหมด หลังหน้าต่างมืดลง ให้แยกจากหน้าหลักชัด
//   เนื้อหายาวเลื่อนในหน้าต่าง กดพื้นหลังหรือ Esc เพื่อปิด
export default function Dialog({ open, title, subtitle, onClose, children, footer, size = "lg" }: Props) {
  // ฟังปุ่ม Esc และล็อกการเลื่อนหน้าหลักขณะเปิด
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 backdrop-blur-[2px] sm:items-center sm:p-6 dark:bg-black/70"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-surface shadow-[0_24px_60px_-12px_rgba(0,0,0,0.5)] ring-1 ring-black/10 dark:ring-white/10 animate-fadeUp sm:rounded-3xl ${SIZES[size]}`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-sky bg-panel px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-navy">{title}</h2>
            {subtitle && <div className="mt-0.5 truncate text-sm text-ink/60">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="-mr-2 rounded-full p-2 text-ink hover:bg-sky/50" aria-label="ปิด">
            <Icon name="close" />
          </button>
        </header>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && <footer className="border-t border-sky bg-panel px-5 py-3 sm:px-6">{footer}</footer>}
      </section>
    </div>
  );
}
