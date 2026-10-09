import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

// ชนิดของข้อความแจ้งเตือน
type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

// คำสั่งแสดงข้อความแจ้งเตือน: toast.success("บันทึกแล้ว"), toast.error("..."), toast.info("...")
interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

// ระยะเวลาที่แสดงก่อนหายเอง (ข้อผิดพลาดค้างนานกว่าให้อ่านทัน)
const DURATION: Record<ToastTone, number> = { success: 3500, info: 3500, error: 6000 };
// แสดงพร้อมกันได้สูงสุด (เกินนี้ตัวเก่าสุดหายก่อน)
const MAX_TOASTS = 4;
// สีและไอคอนของแต่ละชนิด
const STYLE: Record<ToastTone, { icon: IconName; className: string }> = {
  success: { icon: "check", className: "text-emerald-700 bg-emerald-50 ring-emerald-200" },
  error: { icon: "alert", className: "text-danger bg-danger/10 ring-danger/20" },
  info: { icon: "alert", className: "text-brand bg-brand/10 ring-brand/20" },
};

const ToastContext = createContext<ToastApi | null>(null);

// ครอบแอปเพื่อให้ทุกหน้าแสดงข้อความแจ้งเตือนมุมจอได้ (มือถืออยู่เหนือเมนูล่าง)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++;
      setItems((list) => [...list, { id, tone, message }].slice(-MAX_TOASTS));
      window.setTimeout(() => dismiss(id), DURATION[tone]);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => show("success", m),
      error: (m) => show("error", m),
      info: (m) => show("info", m),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-24 z-[60] flex flex-col items-stretch gap-2 md:inset-x-auto md:bottom-6 md:right-6 md:w-96"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className="pointer-events-auto flex animate-fadeUp items-start gap-3 rounded-xl bg-surface px-4 py-3 text-sm text-ink shadow-card ring-1 ring-sky"
          >
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ring-1 ring-inset ${STYLE[t.tone].className}`}>
              <Icon name={STYLE[t.tone].icon} size={15} />
            </span>
            <p className="min-w-0 flex-1 self-center whitespace-pre-line break-words">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink/50 transition hover:bg-sky/40 hover:text-ink"
              aria-label="ปิดข้อความ"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ใช้แสดงข้อความแจ้งเตือนในคอมโพเนนต์
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast ต้องใช้ภายใน ToastProvider");
  return ctx;
}
