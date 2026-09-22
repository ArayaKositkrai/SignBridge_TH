import Icon from "../../../components/ui/Icon";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";

// ค่าที่ปุ่มพูดรับ: onText = ข้อความระหว่างพูด, onFinal = ข้อความเมื่อพูดจบ
interface Props {
  onText: (t: string) => void;
  onFinal: (t: string) => void;
}

// ปุ่มพูดแทนพิมพ์ แสดงข้อความที่ได้ยินสด ๆ และแจ้งข้อผิดพลาด
export default function VoiceInput({ onText, onFinal }: Props) {
  const { supported, listening, interim, error, toggle } = useSpeechRecognition({ onText, onFinal });

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={!supported}
        title={supported ? undefined : "เบราว์เซอร์นี้ไม่รองรับการพูดเป็นข้อความ (ลองใช้ Chrome หรือ Edge)"}
        className={`relative flex h-11 items-center justify-center gap-2 overflow-hidden rounded-xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
          listening
            ? "bg-danger text-white animate-pulseRing"
            : "bg-white text-navy ring-1 ring-sky hover:bg-sky/40"
        }`}
      >
        {listening ? (
          <span className="flex h-5 items-end gap-[3px]" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className="w-[3px] origin-bottom animate-wave rounded-full bg-white"
                style={{ height: "100%", animationDelay: `${i * 0.12}s` }}
              />
            ))}
          </span>
        ) : (
          <Icon name="mic" size={18} />
        )}
        {listening ? "กำลังฟัง… แตะเพื่อหยุด" : supported ? "พูดแทนพิมพ์" : "ไม่รองรับเสียงพูด"}
      </button>

      {listening && (
        <div
          aria-live="polite"
          className="animate-fadeUp rounded-xl bg-navy px-3 py-2 text-sm text-white"
        >
          <span className="mr-2 text-[11px] uppercase tracking-wide text-sky/80">ได้ยินว่า</span>
          {interim || <span className="text-sky/70">พูดได้เลย…</span>}
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger-dark">
          {error}
        </p>
      )}
    </div>
  );
}
