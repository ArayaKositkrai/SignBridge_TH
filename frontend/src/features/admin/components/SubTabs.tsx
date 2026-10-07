// ค่าที่แท็บย่อยรับ
interface Props<T extends string> {
  tabs: { value: T; label: string; badge?: string | number }[];
  value: T;
  onChange: (value: T) => void;
}

// แท็บย่อยภายในหน้า (เส้นใต้แท็บที่เลือก)
export default function SubTabs<T extends string>({ tabs, value, onChange }: Props<T>) {
  return (
    <nav className="scrollbar-none mb-4 flex gap-1 overflow-x-auto border-b border-sky" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
            value === t.value ? "border-brand text-navy" : "border-transparent text-ink/55 hover:text-navy"
          }`}
        >
          {t.label}
          {t.badge !== undefined && <span className="ml-1.5 rounded-full bg-sky/60 px-1.5 text-[11px] text-navy">{t.badge}</span>}
        </button>
      ))}
    </nav>
  );
}
