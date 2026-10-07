import { useEffect, type ReactNode } from "react";
import Icon from "./Icon";

// ค่าที่หน้าต่างป๊อปอัปรับ
interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

// หน้าต่างป๊อปอัป: กดพื้นหลังหรือกด Esc เพื่อปิด
export default function Modal({ open, title, onClose, children }: Props) {
  // ฟังปุ่ม Esc เฉพาะตอนหน้าต่างเปิดอยู่
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-[2px] dark:bg-black/70 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-md animate-fadeUp rounded-t-3xl bg-surface p-5 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.5)] ring-1 ring-black/10 dark:ring-white/10 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-navy">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-ink hover:bg-sky/50"
            aria-label="ปิด"
          >
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
