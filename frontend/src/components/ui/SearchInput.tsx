import Icon from "./Icon";

// ค่าที่ช่องค้นหารับ
interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

// ช่องค้นหาพร้อมไอคอนแว่นขยายและปุ่มล้างคำค้น
export default function SearchInput({ value, onChange, placeholder = "ค้นหา", className = "" }: Props) {
  return (
    <div className={`relative ${className}`}>
      <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full rounded-xl border border-sky bg-surface pl-9 pr-9 text-sm outline-none transition placeholder:text-ink/40 focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-ink/45 hover:bg-sky/50 hover:text-ink"
          aria-label="ล้างคำค้น"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}
