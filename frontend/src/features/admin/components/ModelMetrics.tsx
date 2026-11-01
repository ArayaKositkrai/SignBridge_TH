import { useEffect, useMemo, useState } from "react";
import Badge from "../../../components/ui/Badge";
import Button from "../../../components/ui/Button";
import Icon from "../../../components/ui/Icon";
import { HintIcon } from "../../../components/ui/Tooltip";
import { fmtDate } from "../../../lib/format";
import { HINTS, LABELS, TECH } from "./metricInfo";
import { getModelMetrics, type MetricDetail, type ModelFile, type ModelMetrics as Metrics, type TrainStatus } from "../services/adminApi";

// ชุดเทสที่มีคลิปน้อยกว่านี้ ผลยังเชื่อถือไม่ได้
const SMALL_TEST_SET = 50;
// จำนวนคู่คำที่สับสนกันที่แสดง
const TOP_CONFUSIONS = 10;

// แสดงเปอร์เซ็นต์ (ไม่มีค่า = ขีด)
const pct = (v: number | null | undefined, digits = 0) => (v == null ? "–" : `${(v * 100).toFixed(digits)}%`);

// การ์ดตัวเลขหนึ่งใบ (hint = คำอธิบายว่าวัดอะไร แสดงใน tooltip ของไอคอน ?)
//   tech = ชื่อทางเทคนิคตัวเล็ก (ไว้อ้างอิงในรายงาน)
function MetricCard({ label, tech, value, hint, tone }: { label: string; tech?: string; value: string; hint: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl bg-surface px-4 py-3 ring-1 ring-sky">
      <p className="flex items-center gap-1 text-xs text-ink/60">
        {label}
        <HintIcon text={hint} icon="help" tone="info" wide />
        {tech && <span className="ml-auto text-[10px] text-ink/35">{tech}</span>}
      </p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tone === "bad" ? "text-danger" : "text-navy"}`}>{value}</p>
    </div>
  );
}

// แถบคำเตือนเรื่องความน่าเชื่อถือของผลวัด
function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30">
      <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

// สีของแท่งในกราฟความมั่นใจ (ตรวจกับ validator แล้ว: ถูก/ผิด แยกได้ทั้งโหมดสว่าง/มืด
//   แต่คนตาบอดสีแยกได้ยาก จึงมีลายทแยงบนแท่ง "ทายผิด" + ป้ายกำกับ + ช่องว่างระหว่างแท่งช่วยแยก)
const BAR_CORRECT = "bg-[#059669] dark:bg-[#0e9f6e]";
const BAR_WRONG = "bg-[#d62839] dark:bg-[#e5484d]";
const HATCH = { backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,.45) 0 2px, transparent 2px 6px)" };

// ฮิสโตแกรมความมั่นใจของคำอันดับ 1: แท่งคู่ (ทายถูก / ทายผิด) ต่อช่วง 10% พร้อมเส้นเกณฑ์ความมั่นใจ
export function ConfidenceChart({ data, threshold }: { data: NonNullable<MetricDetail["confidence"]>; threshold?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.correct, ...data.wrong);
  const step = data.bins.length ? 1 / data.bins.length : 0.1;
  return (
    <figure>
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/70">
        <span className="inline-flex items-center gap-1 font-semibold text-navy">
          ระบบมั่นใจแค่ไหนตอนทายถูก/ผิด
          <HintIcon text={HINTS.chart} icon="help" tone="info" wide />
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-sm ${BAR_CORRECT}`} /> ทายถูก
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-sm ${BAR_WRONG}`} style={HATCH} /> ทายผิด
        </span>
        {threshold != null && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 border-l-2 border-dashed border-navy" /> ขั้นต่ำที่ขึ้นคำ {pct(threshold)}
          </span>
        )}
      </figcaption>
      <div className="relative h-40 border-b border-sky" aria-hidden="true">
        <div className="absolute inset-0 flex items-end">
          {data.bins.map((b, i) => (
            <div
              key={b}
              className="relative flex h-full flex-1 items-end justify-center gap-0.5 px-0.5"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {hover === i && <div className="absolute inset-0 rounded bg-sky/30" />}
              <div className={`relative w-1/3 rounded-t ${BAR_CORRECT}`} style={{ height: `${(data.correct[i] / max) * 100}%` }} />
              <div className={`relative w-1/3 rounded-t ${BAR_WRONG}`} style={{ height: `${(data.wrong[i] / max) * 100}%`, ...HATCH }} />
              {hover === i && (
                <div className="absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-lg bg-surface px-2.5 py-1.5 text-xs text-ink shadow-card ring-1 ring-sky">
                  <p className="font-semibold text-navy">
                    มั่นใจ {Math.round(b * 100)}–{Math.round((b + step) * 100)}%
                  </p>
                  <p>ทายถูก {data.correct[i]} · ทายผิด {data.wrong[i]}</p>
                </div>
              )}
            </div>
          ))}
        </div>
        {threshold != null && (
          <div className="pointer-events-none absolute inset-y-0 border-l-2 border-dashed border-navy" style={{ left: `${threshold * 100}%` }} />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink/50" aria-hidden="true">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
      {/* ตารางข้อมูลเดียวกันสำหรับโปรแกรมอ่านหน้าจอ */}
      <table className="sr-only">
        <caption>จำนวนคลิปที่ทายถูกและทายผิด แยกตามช่วงความมั่นใจ</caption>
        <thead>
          <tr>
            <th>ช่วงความมั่นใจ</th>
            <th>ทายถูก</th>
            <th>ทายผิด</th>
          </tr>
        </thead>
        <tbody>
          {data.bins.map((b, i) => (
            <tr key={b}>
              <td>
                {Math.round(b * 100)}–{Math.round((b + step) * 100)}%
              </td>
              <td>{data.correct[i]}</td>
              <td>{data.wrong[i]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

interface Props {
  models: ModelFile[];
  status: TrainStatus | null;
  onRunTest: () => void;
  runBusy: boolean;
}

// ผลวัดโมเดล: เลือกเวอร์ชัน + ชุดผล (ตอนเทรน / Run Test) → การ์ดตัวชี้วัด คำเตือน คู่คำที่สับสน และกราฟความมั่นใจ
export default function ModelMetrics({ models, status, onRunTest, runBusy }: Props) {
  const usable = useMemo(() => models.filter((m) => m.compatible !== false && (m.validation || m.test)), [models]);
  const preferred = models.find((m) => m.draft && m.compatible !== false) ?? models.find((m) => m.active) ?? usable[0];
  const [file, setFile] = useState<string | null>(null);
  const [source, setSource] = useState<"validation" | "test">("validation");
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const selected = file ?? preferred?.version ?? null;
  const evaluating = status?.evaluation?.status === "running";

  // โหลดตัวชี้วัดเต็มของเวอร์ชันที่เลือก (โหลดใหม่เมื่อ Run Test เสร็จ)
  const evalDoneKey = status?.evaluation?.status;
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setLoading(true);
    getModelMetrics(selected)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [selected, evalDoneKey]);

  const m = data?.[source];
  const model = models.find((x) => x.version === selected);
  const otherSets = new Set(models.map((x) => x.test?.test_set_id).filter(Boolean));

  return (
    <section className="mb-5 rounded-2xl bg-surface/80 p-5 ring-1 ring-sky">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-base font-bold text-navy">ผลวัดโมเดล</h2>
        <select
          value={selected ?? ""}
          onChange={(e) => setFile(e.target.value)}
          aria-label="เวอร์ชันโมเดล"
          className="h-9 rounded-xl border border-sky bg-surface px-2 text-sm"
        >
          {models
            .filter((x) => x.compatible !== false)
            .map((x) => (
              <option key={x.version} value={x.version}>
                {x.label}
                {x.active ? " (ใช้งานอยู่)" : x.draft ? " (Draft)" : ""}
              </option>
            ))}
        </select>
        <div className="flex rounded-xl bg-sky/40 p-0.5 text-sm" role="tablist">
          {(["validation", "test"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={source === s}
              onClick={() => setSource(s)}
              className={`rounded-lg px-3 py-1 font-semibold transition ${source === s ? "bg-surface text-navy shadow" : "text-ink/60"}`}
            >
              {s === "validation" ? "ตอนเทรน" : "Run Test"}
            </button>
          ))}
        </div>
        <HintIcon text={HINTS.source} icon="help" tone="info" wide />
        <Button size="sm" variant="soft" icon="refresh" onClick={onRunTest} disabled={runBusy || evaluating || !status?.can_train_here}>
          {evaluating ? "กำลังวัดผล…" : "Run Test ทุกเวอร์ชัน"}
        </Button>
      </header>

      {!selected ? (
        <p className="py-6 text-center text-sm text-ink/50">ยังไม่มีโมเดล</p>
      ) : loading && !data ? (
        <p className="py-6 text-center text-sm text-ink/50">กำลังโหลด…</p>
      ) : !m || !m.clips ? (
        <p className="py-6 text-center text-sm text-ink/50">
          {source === "validation"
            ? "เวอร์ชันนี้ไม่มีผลวัดละเอียด (เทรนก่อนเพิ่มระบบวัดผล) — กด Run Test เพื่อวัดด้วยชุดเทสปัจจุบัน"
            : 'ยังไม่ได้ Run Test — กด "Run Test ทุกเวอร์ชัน"'}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-ink/60">
            {source === "validation" ? "คะแนนตอนเทรน: ให้โมเดลทายคลิปของคนที่ไม่เคยเห็น" : `Run Test เมื่อ ${m.evaluated_at ? fmtDate(m.evaluated_at) : "–"}: ให้โมเดลทายคลิปของคนที่ไม่เคยเห็น`}{" "}
            {m.clips.toLocaleString("th-TH")} คลิป
            {m.excluded_clips ? ` (ไม่นับ ${m.excluded_clips} คลิปของคำที่เวอร์ชันนี้ไม่รู้จัก)` : ""}
            {m.test_set_id && <span className="ml-1 font-mono text-ink/40">ชุด {m.test_set_id}</span>}
          </p>

          {/* คำเตือนเรื่องความน่าเชื่อถือ */}
          {source === "test" && m.seen_test && (
            <Warning>โมเดลนี้เคยเห็นคลิปในชุดเทสตอนเทรน ผลจึงสูงเกินจริง เทียบกับเวอร์ชันอื่นไม่ได้ (เวอร์ชันที่เทรนหลังจากนี้จะกันชุดเทสออกให้เอง)</Warning>
          )}
          {m.clips < SMALL_TEST_SET && <Warning>ชุดเทสมีแค่ {m.clips} คลิป ผลยังแกว่งมาก ควรเลือกล่ามในชุดเทสให้มากขึ้น (แท็บชุดเทส)</Warning>}
          {m.no_train_words && m.no_train_words.length > 0 && (
            <Warning>
              คำที่ทุกคลิปอยู่ในชุดเทส โมเดลไม่ได้เรียนคำนี้เลย จึงทายผิดแน่นอน: {m.no_train_words.join(", ")}
            </Warning>
          )}
          {source === "test" && otherSets.size > 1 && (
            <Warning>บางเวอร์ชันวัดด้วยชุดเทสคนละชุด กด Run Test ใหม่ให้ทุกเวอร์ชันใช้ชุดเดียวกันก่อนเทียบ</Warning>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label={LABELS.accuracy} tech={TECH.accuracy} value={pct(m.accuracy, 1)} hint={HINTS.accuracy} />
            <MetricCard label={LABELS.top3} tech={TECH.top3} value={pct(m.top3, 1)} hint={HINTS.top3} />
            <MetricCard label={LABELS.precision} tech={TECH.precision} value={pct(m.precision, 1)} hint={HINTS.precision} />
            <MetricCard label={LABELS.recall} tech={TECH.recall} value={pct(m.recall, 1)} hint={HINTS.recall} />
            <MetricCard label={LABELS.f1} tech={TECH.f1} value={pct(m.f1, 1)} hint={HINTS.f1} />
            <MetricCard
              label={LABELS.falseAlarm}
              value={m.null_false_alarm == null ? "ไม่มีข้อมูล" : pct(m.null_false_alarm, 1)}
              tone={m.null_false_alarm != null && m.null_false_alarm > 0.1 ? "bad" : undefined}
              hint={HINTS.falseAlarm}
            />
            <MetricCard label={LABELS.dropped} value={pct(m.word_dropped, 1)} hint={HINTS.dropped} />
            <MetricCard
              label={LABELS.threshold}
              tech={TECH.threshold}
              value={pct(m.threshold)}
              hint={HINTS.threshold}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold text-navy">
                คำที่ระบบมักจำสลับกัน
                <HintIcon text={HINTS.confusions} icon="help" tone="info" wide />
              </h3>
              {m.confusions && m.confusions.length > 0 ? (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-ink/55">
                    <tr>
                      <th className="py-1 font-semibold">คำจริง</th>
                      <th className="py-1 font-semibold">ทายเป็น</th>
                      <th className="py-1 text-right font-semibold">ครั้ง</th>
                      <th className="py-1 text-right font-semibold">% ของคำนี้</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sky/60">
                    {m.confusions.slice(0, TOP_CONFUSIONS).map((c) => (
                      <tr key={`${c.true}-${c.pred}`}>
                        <td className="py-1.5 font-semibold text-navy">{c.true}</td>
                        <td className="py-1.5">{c.pred}</td>
                        <td className="py-1.5 text-right tabular-nums">{c.count}</td>
                        <td className="py-1.5 text-right">
                          <Badge tone={c.rate >= 0.3 ? "danger" : c.rate >= 0.15 ? "warning" : "neutral"}>{pct(c.rate)}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-ink/50">ไม่มีคำที่ระบบจำสลับกันซ้ำ ๆ</p>
              )}
            </div>
            {m.confidence && <ConfidenceChart data={m.confidence} threshold={m.threshold} />}
          </div>
          {model?.active && source === "validation" && m.threshold != null && (
            <p className="text-xs text-ink/55">ตอนใช้งานจริง ระบบจะขึ้นคำเมื่อมั่นใจอย่างน้อย {pct(m.threshold)}</p>
          )}
        </div>
      )}
    </section>
  );
}
