import Icon, { type IconName } from "./Icon";

// ค่าที่หัวข้อหน้ารับ: ไอคอน ชื่อ คำอธิบาย และโทนสี
interface Props {
  icon: IconName;
  title: string;
  subtitle: string;
  tone?: "brand" | "danger";
}

// หัวข้อประจำหน้า (ไอคอน + ชื่อ + คำอธิบาย)
export default function PageTitle({ icon, title, subtitle, tone = "brand" }: Props) {
  return (
    <div className="mb-5 flex items-center gap-3 animate-fadeUp">
      <span
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white shadow-lg ${
          tone === "danger"
            ? "bg-gradient-to-br from-danger to-danger-dark"
            : "bg-gradient-to-br from-brand to-royal"
        }`}
      >
        <Icon name={icon} size={22} />
      </span>
      <div className="min-w-0">
        <h1 className="text-xl font-bold leading-tight text-navy md:text-2xl">{title}</h1>
        <p className="text-sm text-ink/60">{subtitle}</p>
      </div>
    </div>
  );
}
