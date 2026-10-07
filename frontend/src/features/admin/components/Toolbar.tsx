import type { ReactNode } from "react";

// แถวเครื่องมือเหนือตาราง: ช่องค้นหาและตัวกรองเรียงในแถวเดียว (จอเล็กขึ้นบรรทัดใหม่)
export default function Toolbar({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {children}
      {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

// ค่าที่ตัวเลือกกรองรับ
interface SelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}

// ตัวเลือกกรองแบบ dropdown (ตัวเลือกแรกควรเป็น "ทั้งหมด" ค่าว่าง)
export function FilterSelect({ label, value, onChange, options }: SelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      title={label}
      className="h-10 rounded-xl border border-sky bg-surface px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
