// ค่าที่สวิตช์เปิด/ปิดรับ
interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  size?: "sm" | "md";
}

// สวิตช์เปิด/ปิด (label ใช้เป็นชื่อสำหรับโปรแกรมอ่านหน้าจอ)
export default function Switch({ checked, onChange, label, disabled, size = "md" }: Props) {
  const box = size === "sm" ? "h-5 w-9" : "h-6 w-11";
  const knob = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const on = size === "sm" ? "left-[18px]" : "left-[22px]";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`relative shrink-0 rounded-full transition disabled:opacity-40 ${box} ${checked ? "bg-brand" : "bg-ink/20"}`}
    >
      <span className={`absolute top-0.5 rounded-full bg-white shadow transition-all ${knob} ${checked ? on : "left-0.5"}`} />
    </button>
  );
}
