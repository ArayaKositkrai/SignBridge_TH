import Icon from "../../../components/ui/Icon";

// ปุ่ม "ช่วยด้วย" สีแดงขนาดใหญ่ กดแล้วพูดทันที
export default function EmergencyButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      onClick={onPress}
      className="group relative flex h-32 w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-3xl bg-gradient-to-br from-danger via-danger to-danger-dark text-white shadow-[0_18px_36px_-14px_rgba(214,40,57,.8)] transition hover:brightness-110 active:scale-[.98] sm:h-36"
    >
      <span className="absolute -left-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
      <span className="absolute -bottom-14 -right-6 h-44 w-44 rounded-full bg-black/10" />
      <span className="relative grid h-14 w-14 place-items-center rounded-full bg-white/20">
        <span className="absolute inset-0 animate-ripple rounded-full ring-2 ring-white/60" />
        <Icon name="alert" size={30} />
      </span>
      <span className="relative text-2xl font-bold tracking-wide">{label}</span>
    </button>
  );
}
