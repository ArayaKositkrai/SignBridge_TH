import Button from "../../../components/ui/Button";
import Card from "../../../components/ui/Card";
import Chip from "../../../components/ui/Chip";
import Icon from "../../../components/ui/Icon";
import type { SignResult, SocketStatus } from "../../../types";

// ค่าที่แผงผลลัพธ์รับ
interface Props {
  result: SignResult | null;
  // ข้อความแจ้งจากระบบ (เช่น ยังไม่มีโมเดล)
  notice?: string | null;
  words: string[];
  sentences: string[];
  socket: SocketStatus;
  cameraOn: boolean;
  onSpeak: (text: string) => void;
  onCommit: () => void;
  onClear: () => void;
}

// ข้อความบอกสถานะการเชื่อมต่อ backend
const SOCKET_LABEL: Record<SocketStatus, string> = {
  open: "เชื่อมต่อ backend แล้ว",
  connecting: "กำลังเชื่อมต่อ…",
  closed: "ยังไม่เชื่อมต่อ",
};

// วงกลมแสดงความมั่นใจเป็นเปอร์เซ็นต์
function Gauge({ pct }: { pct: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="-rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#bbd6e1" strokeOpacity=".6" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="url(#g)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          className="transition-[stroke-dashoffset] duration-300"
        />
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3885ab" />
            <stop offset="100%" stopColor="#11329a" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-bold text-navy">
        {pct ? `${pct}%` : "–"}
      </span>
    </div>
  );
}

// แผงผลลัพธ์: คำที่กำลังแปล ความมั่นใจ ประโยค และปุ่มอ่านออกเสียง
export default function ResultPanel(p: Props) {
  const pct = Math.round((p.result?.confidence ?? 0) * 100);
  const current = p.words.join(" ");
  const lastSentence = p.sentences[p.sentences.length - 1];
  const speakText = current || lastSentence || "";

  return (
    <div className="grid content-start gap-4 md:grid-cols-2 lg:grid-cols-1">
      <Card title="กำลังแปล">
        {p.notice && (
          <p role="status" className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            {p.notice}
          </p>
        )}
        <div className="flex items-center gap-4">
          <div className="min-h-[4.5rem] min-w-0 flex-1">
            {p.result ? (
              <p key={p.result.text} className="text-gradient animate-fadeUp text-4xl font-bold leading-[1.25]">
                {p.result.text}
              </p>
            ) : (
              <p className="flex h-[4.5rem] items-center text-lg text-ink/45">
                {p.cameraOn ? "รอท่าภาษามือ…" : "เปิดกล้องเพื่อเริ่มแปล"}
              </p>
            )}
          </div>
          <Gauge pct={pct} />
        </div>

        <div className="mt-3 flex min-h-[2rem] flex-wrap items-center gap-2 border-t border-sky/60 pt-3">
          <span className="text-xs text-ink/55">ใกล้เคียง</span>
          {p.result?.candidates.length ? (
            p.result.candidates.map((c) => (
              <Chip key={c.text} disabled className="!opacity-100">
                {c.text}
              </Chip>
            ))
          ) : (
            <span className="text-sm text-ink/35">–</span>
          )}
        </div>

        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ink/50">
          <span
            className={`h-1.5 w-1.5 rounded-full ${p.socket === "open" ? "bg-emerald-500" : "bg-ink/30"}`}
          />
          {SOCKET_LABEL[p.socket]}
          {p.result?.model && <span className="ml-auto">โมเดล {p.result.model}</span>}
        </p>
      </Card>

      <Card
        title="ประโยค"
        action={
          <button
            onClick={p.onCommit}
            disabled={!p.words.length}
            className="text-xs font-semibold text-royal underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-40"
          >
            จบประโยค
          </button>
        }
      >
        <div className="min-h-[4.5rem] rounded-xl bg-cream/80 p-3 ring-1 ring-sky/60">
          {p.words.length ? (
            <p className="text-lg font-semibold leading-relaxed text-navy">
              {p.words.map((w, i) => (
                <span key={`${w}-${i}`} className="inline-block animate-fadeUp pr-1.5">
                  {w}
                </span>
              ))}
              <span className="ml-0.5 inline-block h-5 w-0.5 translate-y-1 animate-pulse bg-brand" />
            </p>
          ) : (
            <p className="text-sm text-ink/45">
              คำที่แปลได้จะต่อกันเป็นประโยคที่นี่ เมื่อลดมือลงประมาณ 2 วินาที ระบบจะจบประโยคให้อัตโนมัติ
            </p>
          )}
        </div>

        {p.sentences.length > 0 && (
          <ul className="mt-3 flex max-h-40 flex-col gap-1.5 overflow-y-auto">
            {[...p.sentences].reverse().map((s, i) => (
              <li key={`${s}-${i}`}>
                <button
                  onClick={() => p.onSpeak(s)}
                  className="group flex w-full items-center gap-2 rounded-lg bg-sky/30 px-3 py-2 text-left text-sm text-navy transition hover:bg-sky/60"
                >
                  <Icon name="volume" size={14} className="shrink-0 opacity-50 group-hover:opacity-100" />
                  <span className="flex-1">{s}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex gap-2">
          <Button icon="volume" className="flex-1" onClick={() => p.onSpeak(speakText)} disabled={!speakText}>
            อ่านออกเสียง
          </Button>
          <Button
            variant="ghost"
            icon="trash"
            onClick={p.onClear}
            disabled={!p.words.length && !p.sentences.length}
            aria-label="ล้างทั้งหมด"
          />
        </div>
      </Card>
    </div>
  );
}
