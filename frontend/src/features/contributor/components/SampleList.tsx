import Icon from "../../../components/ui/Icon";
import { fmtDate } from "../../../lib/format";
import { sampleVideoUrl, type SampleMeta } from "../services/contributorApi";

// ค่าที่รายการคลิปรับ: กดคลิปเพื่อเปิดดูจอใหญ่ หรือกดลบ
interface Props {
  word: string;
  samples: SampleMeta[];
  loading: boolean;
  onOpen: (index: number) => void;
  onDelete: (sample: SampleMeta) => void;
}

// คลิปที่เก็บแล้วของคำศัพท์ แสดงเป็นภาพตัวอย่าง (เลื่อนในกรอบได้) กดเพื่อดูจอใหญ่
export default function SampleList({ word, samples, loading, onOpen, onDelete }: Props) {
  if (!word) return <Empty icon="text" text="พิมพ์หรือเลือกคำศัพท์เพื่อดูคลิปที่เก็บไว้" />;
  if (loading && !samples.length) return <Empty icon="refresh" text="กำลังโหลด…" />;
  if (!samples.length) return <Empty icon="camera" text="ยังไม่มีคลิปของคำนี้ เริ่มอัดคลิปแรกได้เลย" />;

  // กรอบเลื่อนแยกจากตาราง: ตารางไม่ถูกบีบให้สูงเท่ากรอบ ภาพตัวอย่างจึงคงสัดส่วน 16:9 ไม่ซ้อนกัน
  return (
    <div className="scrollbar-thin h-full min-h-0 overflow-y-auto pr-1.5">
    <ul className="grid grid-cols-2 gap-2">
      {samples.map((s, i) => (
        <li key={s.id} className="group relative aspect-video shrink-0 overflow-hidden rounded-xl bg-deep ring-1 ring-sky">
          <button
            type="button"
            onClick={() => onOpen(i)}
            className="block h-full w-full"
            aria-label={`ดูคลิปที่ ${i + 1} แบบจอใหญ่`}
          >
            {s.video && (
              <video
                src={`${sampleVideoUrl(s.word, s.id)}#t=0.5`}
                preload="metadata"
                muted
                playsInline
                className="pointer-events-none h-full w-full object-cover opacity-85 transition group-hover:opacity-100"
              />
            )}
            <span className="absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white opacity-80 backdrop-blur transition group-hover:scale-110 group-hover:opacity-100">
              <Icon name="play" size={16} />
            </span>
            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/75 to-transparent px-2 pb-1 pt-4 text-left text-[10px] text-white/90">
              {fmtDate(s.created_at)}
              {s.signer && ` · ${s.signer}`}
              {!s.frame_count && <span className="text-amber-300"> · ไม่มี skeleton</span>}
            </span>
          </button>
          <span className="pointer-events-none absolute left-1.5 top-1.5 grid h-6 min-w-6 place-items-center rounded-md bg-white/90 px-1 text-[11px] font-bold text-deep">
            {i + 1}
          </span>
          <button
            type="button"
            onClick={() => onDelete(s)}
            className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-md bg-black/50 text-white backdrop-blur transition hover:bg-danger md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
            aria-label={`ลบคลิปที่ ${i + 1}`}
          >
            <Icon name="trash" size={14} />
          </button>
        </li>
      ))}
    </ul>
    </div>
  );
}

// ข้อความตอนยังไม่มีคลิป
function Empty({ icon, text }: { icon: "text" | "refresh" | "camera"; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-sky px-4 py-8 text-center text-sm text-ink/60">
      <Icon name={icon} size={22} className="text-brand" />
      {text}
    </div>
  );
}
