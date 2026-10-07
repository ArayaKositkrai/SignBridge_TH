// ค่าที่ช่องข้อความรับ
interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}

// ช่องกรอกข้อความ (กด Enter เพื่อแปล, Shift+Enter ขึ้นบรรทัดใหม่)
export default function TextInput({ value, onChange, onSubmit }: Props) {
  return (
    <div className="relative">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
        rows={4}
        maxLength={200}
        placeholder="พิมพ์ข้อความ เช่น สวัสดี ขอบคุณ ครับ"
        className="w-full resize-none rounded-xl border-0 bg-cream/70 p-3 pb-7 text-base text-ink ring-1 ring-sky placeholder:text-ink/40 focus:bg-surface focus:ring-2 focus:ring-brand"
      />
      <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-ink/40">
        {value.length}/200
      </span>
    </div>
  );
}
