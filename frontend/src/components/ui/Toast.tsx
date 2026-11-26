// ระบบข้อความแจ้งเตือน (toast): provider + hook useToast สำหรับเรียกจากทุกหน้า

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Icon, { type IconName } from "./Icon";

// ชนิดของข้อความแจ้งเตือน
type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  link?: ToastLink;
}

// ลิงก์ใน toast: กดทั้ง toast แล้วไปหน้านั้น (label = ข้อความปุ่มที่เห็น)
export interface ToastLink {
  to: string;
  label: string;
}

// ตัวเลือกเพิ่มเติมของ toast
export interface ToastOptions {
  link?: ToastLink;
}

// toast ที่มีลิงก์ค้างนานขึ้น ให้มีเวลากด
const LINK_EXTRA_MS = 4000;

// toast แบบความคืบหน้า: ค้างอยู่จนกว่าจะสั่งเอาออก อัปเดตค่าได้เรื่อย ๆ (เช่นการเทรนโมเดล)
export interface ProgressToast {
  title: string;
  detail?: string;
  // 0-100 (null = ไม่รู้ % แสดงแถบวิ่ง)
  percent: number | null;
  warning?: boolean;
  link?: { to: string; label: string };
}

// คำสั่งแสดงข้อความแจ้งเตือน: toast.success("บันทึกแล้ว"), toast.error("..."), toast.info("...")
//   toast.progress("train", {...}) แสดง/อัปเดต toast ความคืบหน้า, toast.progress("train", null) เอาออก
interface ToastApi {
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
  progress: (key: string, item: ProgressToast | null) => void;
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
  const [progress, setProgress] = useState<Record<string, ProgressToast>>({});
  // toast ความคืบหน้าที่ผู้ใช้กดปิด (ซ่อนไว้จนกว่างานนั้นจะจบ แล้วเริ่มงานใหม่จะแสดงอีก)
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (tone: ToastTone, message: string, options?: ToastOptions) => {
      const id = nextId.current++;
      setItems((list) => [...list, { id, tone, message, link: options?.link }].slice(-MAX_TOASTS));
      window.setTimeout(() => dismiss(id), DURATION[tone] + (options?.link ? LINK_EXTRA_MS : 0));
    },
    [dismiss],
  );

  const setProgressItem = useCallback((key: string, item: ProgressToast | null) => {
    setProgress((cur) => {
      if (item) return { ...cur, [key]: item };
      if (!(key in cur)) return cur;
      const next = { ...cur };
      delete next[key];
      return next;
    });
    if (!item) setHidden((h) => (h.has(key) ? new Set([...h].filter((k) => k !== key)) : h));
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, o) => show("success", m, o),
      error: (m, o) => show("error", m, o),
      info: (m, o) => show("info", m, o),
      progress: setProgressItem,
    }),
    [show, setProgressItem],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-24 z-[60] flex flex-col items-stretch gap-2 md:inset-x-auto md:bottom-6 md:right-6 md:w-96"
      >
        {Object.entries(progress)
          .filter(([key]) => !hidden.has(key))
          .map(([key, p]) => (
            <div
              key={`progress-${key}`}
              role="status"
              className="pointer-events-auto animate-fadeUp rounded-xl bg-surface px-4 py-3 text-sm text-ink shadow-card ring-1 ring-sky"
            >
              <div className="flex items-start gap-3">
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ring-1 ring-inset ${
                    p.warning ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-brand/10 text-brand ring-brand/20"
                  }`}
                >
                  <Icon name={p.warning ? "alert" : "refresh"} size={15} className={p.warning ? "" : "animate-spin [animation-duration:2s]"} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center justify-between gap-2 font-semibold text-navy">
                    {p.title}
                    {p.percent != null && <span className="tabular-nums text-ink/70">{p.percent}%</span>}
                  </p>
                  {p.detail && <p className="truncate text-xs text-ink/60">{p.detail}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => setHidden((h) => new Set(h).add(key))}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink/50 transition hover:bg-sky/40 hover:text-ink"
                  aria-label="ซ่อนความคืบหน้า"
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
              <div
                className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-sky/50"
                role="progressbar"
                aria-label={p.title}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={p.percent ?? undefined}
              >
                {p.percent != null ? (
                  <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${Math.max(p.percent, 3)}%` }} />
                ) : (
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-brand" />
                )}
              </div>
              {p.link && (
                <Link to={p.link.to} className="mt-1.5 inline-block text-xs font-semibold text-brand hover:underline">
                  {p.link.label}
                </Link>
              )}
            </div>
          ))}
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className="pointer-events-auto flex animate-fadeUp items-start gap-3 rounded-xl bg-surface px-4 py-3 text-sm text-ink shadow-card ring-1 ring-sky"
          >
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ring-1 ring-inset ${STYLE[t.tone].className}`}>
              <Icon name={STYLE[t.tone].icon} size={15} />
            </span>
            {t.link ? (
              // มีลิงก์: กดตรงข้อความแล้วไปหน้านั้นและปิด toast
              <Link to={t.link.to} onClick={() => dismiss(t.id)} className="group min-w-0 flex-1 self-center">
                <span className="block whitespace-pre-line break-words">{t.message}</span>
                <span className="mt-0.5 inline-block text-xs font-semibold text-brand group-hover:underline">{t.link.label}</span>
              </Link>
            ) : (
              <p className="min-w-0 flex-1 self-center whitespace-pre-line break-words">{t.message}</p>
            )}
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
