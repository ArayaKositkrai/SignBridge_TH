import { useEffect, type ReactNode } from "react";
import Icon from "./Icon";

// ค่าที่แผงด้านข้างรับ
interface Props {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

// แผงรายละเอียดเลื่อนออกจากขวา (จอเล็กเต็มจอ) กดพื้นหลังหรือ Esc เพื่อปิด
export default function Drawer({ open, title, subtitle, onClose, children, footer }: Props) {
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
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40 backdrop-blur-[2px]" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-lg flex-col bg-cream shadow-2xl animate-fadeUp"
      >
        <header className="flex items-start justify-between gap-3 border-b border-sky/70 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-navy">{title}</h2>
            {subtitle && <div className="mt-0.5 text-sm text-ink/60">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-ink hover:bg-sky/50" aria-label="ปิด">
            <Icon name="close" />
          </button>
        </header>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="border-t border-sky/70 px-5 py-3">{footer}</footer>}
      </aside>
    </div>
  );
}
