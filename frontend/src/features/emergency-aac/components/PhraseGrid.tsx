// กริดปุ่มวลีฉุกเฉิน

import Icon from "../../../components/ui/Icon";
import type { EmergencyPhrase } from "../../../types";

// ค่าที่กริดวลีรับ: รายการ ปุ่มที่เลือก โหมดแก้ไข และ callback
interface Props {
  phrases: EmergencyPhrase[];
  activeId: string | null;
  editing: boolean;
  onPick: (p: EmergencyPhrase) => void;
  onDelete: (p: EmergencyPhrase) => void;
}

// กริดปุ่มวลีฉุกเฉิน: ไอคอน → ชื่อปุ่ม → ข้อความที่พูด (ในโหมดแก้ไข แตะเพื่อแก้ และมีปุ่มลบบนวลีที่เพิ่มเอง)
export default function PhraseGrid({ phrases, activeId, editing, onPick, onDelete }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {phrases.map((p, i) => {
        const active = p.id === activeId;
        const ghost = p.icon === "more";
        const deletable = editing && p.custom;
        return (
          <div key={p.id} className="relative" style={{ animationDelay: `${i * 45}ms` }}>
            <button
              onClick={() => onPick(p)}
              disabled={editing && !p.custom}
              className={`group flex min-h-[6.5rem] w-full animate-fadeUp flex-col items-center justify-center gap-2.5 rounded-2xl p-3 text-base font-semibold transition duration-200 active:scale-[.97] disabled:opacity-50 ${
                ghost
                  ? "border-2 border-dashed border-sky bg-surface/40 text-navy/70 hover:bg-surface"
                  : active
                    ? "bg-gradient-to-br from-brand to-deep text-white shadow-[0_14px_28px_-12px_rgba(24,80,121,.8)]"
                    : "glass-card !p-3 text-navy hover:-translate-y-1 hover:shadow-[0_18px_30px_-14px_rgba(24,80,121,.55)]"
              } ${deletable ? "ring-2 ring-brand/60" : ""}`}
            >
              <span
                className={`grid h-11 w-11 place-items-center rounded-xl transition ${
                  active
                    ? "bg-white/20 text-white"
                    : ghost
                      ? "text-navy/60"
                      : "bg-sky/60 text-navy group-hover:bg-brand group-hover:text-white"
                }`}
              >
                <Icon name={p.icon === "more" ? "plus" : p.icon} size={24} />
              </span>
              <span className="line-clamp-2 break-words px-1 text-center leading-snug">{p.label}</span>
              {p.speak && p.speak !== p.label && (
                <span
                  className={`-mt-1.5 line-clamp-1 break-all px-1 text-center text-[11px] font-normal ${
                    active ? "text-white/80" : "text-ink/55"
                  }`}
                >
                  {p.speak}
                </span>
              )}
            </button>

            {deletable && (
              <button
                onClick={() => onDelete(p)}
                aria-label={`ลบ ${p.label}`}
                className="absolute -right-2 -top-2 grid h-8 w-8 place-items-center rounded-full bg-danger text-white shadow-lg ring-2 ring-white transition hover:bg-danger-dark active:scale-90"
              >
                <Icon name="trash" size={15} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
