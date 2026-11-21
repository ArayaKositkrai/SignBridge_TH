import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Badge from "../../../components/ui/Badge";
import Dialog from "../../../components/ui/Dialog";
import DataTable, { type Column } from "./DataTable";
import { HINTS, LABELS } from "./metricInfo";
import { ConfidenceChart } from "./ConfidenceChart";
import type { MetricDetail } from "../services/adminApi";

// แสดงเปอร์เซ็นต์ (ไม่มีค่า = ขีด)
const pct = (v: number | null | undefined, digits = 1) => (v == null ? "–" : `${(v * 100).toFixed(digits)}%`);
const num = (n: number) => n.toLocaleString("th-TH");

// ตัวชี้วัดทุกตัวที่กดดูรายละเอียดได้ (แดชบอร์ดแสดง 5 ตัว หน้าโมเดลแสดงครบ)
export type MetricKey = "accuracy" | "top3" | "precision" | "recall" | "f1" | "falseAlarm" | "dropped" | "threshold";
type Key = MetricKey;
export const ALL_CARDS: { key: Key; better: "high" | "low"; value: (m: MetricDetail) => number | null | undefined }[] = [
  { key: "accuracy", better: "high", value: (m) => m.accuracy },
  { key: "top3", better: "high", value: (m) => m.top3 },
  { key: "precision", better: "high", value: (m) => m.precision },
  { key: "recall", better: "high", value: (m) => m.recall },
  { key: "f1", better: "high", value: (m) => m.f1 },
  { key: "falseAlarm", better: "low", value: (m) => m.null_false_alarm },
  { key: "dropped", better: "low", value: (m) => m.word_dropped },
  { key: "threshold", better: "high", value: (m) => m.threshold },
];
// ผลรายคำหนึ่งแถว
interface WordRow {
  word: string;
  recall: number;
  precision: number;
  f1: number;
  clips: number;
}

// หัวข้อย่อยในหน้าต่างรายละเอียด
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-bold text-navy">{title}</h3>
      {children}
    </section>
  );
}

// กล่องหมายเหตุสีอ่อน
function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-sky/30 px-3 py-2 text-sm text-ink/75">{children}</p>;
}

// ตัวเลขสรุปตัวใหญ่ในหน้าต่าง (เช่น "908 จาก 1,239 คลิป")
function Big({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-brand/10 px-4 py-3 text-base text-navy">{children}</p>;
}

// คำอธิบาย "ความมั่นใจขั้นต่ำ" แบบยกตัวอย่าง
function ThresholdExplainer({ threshold, words }: { threshold?: number; words: number | null }) {
  if (threshold == null) return null;
  const t = Math.round(threshold * 100);
  return (
    <Note>
      <b>ความมั่นใจขั้นต่ำ {t}% คืออะไร</b>
      <br />
      ทุกครั้งที่เห็นท่า ระบบจะคิดว่าเป็นคำอะไร และมั่นใจกี่ % แล้วจะขึ้นคำก็ต่อเมื่อมั่นใจถึง {t}% เช่น "โกรธ (มั่นใจ {Math.min(99, t + 15)}%)" → ขึ้นคำ ·
      "โกรธ (มั่นใจ {Math.max(1, t - 5)}%)" → ไม่ขึ้นอะไร
      {words ? (
        <>
          <br />
          ตัวเลข {t}% ฟังดูต่ำ แต่ระบบต้องเลือกจาก {words} คำ ถ้าเดามั่วจะได้แค่ราว {(100 / words).toFixed(1)}% ต่อคำ {t}% จึงถือว่าค่อนข้างมั่นใจแล้ว
        </>
      ) : null}
      <br />
      ตั้งค่านี้สูงขึ้น → ขึ้นคำผิดน้อยลง แต่เงียบบ่อยขึ้น · ตั้งต่ำลง → ตรงกันข้าม ระบบลองหลายค่าแล้วเลือกค่าที่สมดุลที่สุดให้เอง (ตารางด้านล่าง)
    </Note>
  );
}

// ตาราง "ถ้าตั้งความมั่นใจขั้นต่ำที่เท่านี้ จะเป็นยังไง" (แถวที่ใช้อยู่ถูกไฮไลต์)
function ThresholdTable({ m }: { m: MetricDetail }) {
  const curve = m.threshold_curve ?? [];
  if (!curve.length) return <Note>โมเดลรุ่นนี้ไม่มีข้อมูลส่วนนี้</Note>;
  return (
    <div className="scrollbar-thin max-h-72 overflow-auto rounded-xl ring-1 ring-sky">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-panel text-left text-xs text-ink/60">
          <tr>
            <th className="px-3 py-2 font-semibold">ถ้าตั้งความมั่นใจขั้นต่ำที่</th>
            <th className="px-3 py-2 text-right font-semibold">{LABELS.falseAlarm}</th>
            <th className="px-3 py-2 text-right font-semibold">{LABELS.dropped}</th>
            <th className="px-3 py-2 text-right font-semibold">{LABELS.f1}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-sky/60">
          {curve.map((c) => {
            const current = m.threshold != null && Math.abs(c.threshold - m.threshold) < 1e-6;
            return (
              <tr key={c.threshold} className={current ? "bg-brand/10 font-semibold" : ""}>
                <td className="px-3 py-1.5">
                  {Math.round(c.threshold * 100)}%
                  {current && (
                    <Badge tone="brand" className="ml-2">
                      ใช้อยู่
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{pct(c.null_false_alarm)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{pct(c.word_dropped)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{pct(c.f1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ตารางคำที่ระบบมักจำสลับกัน
function Confusions({ m, limit = 15 }: { m: MetricDetail; limit?: number }) {
  const list = m.confusions ?? [];
  if (!list.length) return <Note>ไม่มีคำที่ระบบจำสลับกันซ้ำ ๆ</Note>;
  return (
    <div className="scrollbar-thin max-h-72 overflow-auto rounded-xl ring-1 ring-sky">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-panel text-left text-xs text-ink/60">
          <tr>
            <th className="px-3 py-2 font-semibold">ทำท่าคำว่า</th>
            <th className="px-3 py-2 font-semibold">ระบบขึ้นว่า</th>
            <th className="px-3 py-2 text-right font-semibold">กี่คลิป</th>
            <th className="px-3 py-2 text-right font-semibold">% ของคำนี้</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-sky/60">
          {list.slice(0, limit).map((c) => (
            <tr key={`${c.true}-${c.pred}`}>
              <td className="px-3 py-1.5 font-semibold text-navy">{c.true}</td>
              <td className="px-3 py-1.5">{c.pred}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{c.count}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{pct(c.rate, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ตารางคำที่เผลอขึ้นตอนไม่ได้ทำท่า หรือคำที่ทำท่าแล้วระบบเงียบ (บ่อยสุดขึ้นก่อน) ยังไม่มีข้อมูล = แนะนำให้กด Run Test
function SilenceTable({ kind, m }: { kind: "falseAlarm" | "dropped"; m: MetricDetail }) {
  const list: { word: string; count: number; rate: number; clips?: number }[] | undefined =
    kind === "falseAlarm" ? m.false_alarm_words : m.dropped_words;
  if (list === undefined) return <Note>ผลวัดชุดนี้ยังไม่ได้แยกรายคำ — กด Run Test หรือเทรนใหม่อีกครั้งเพื่อดูตารางนี้</Note>;
  if (!list.length) return <Note>{kind === "falseAlarm" ? "ไม่มีคำไหนเผลอขึ้นมาตอนไม่ได้ทำท่า" : "ไม่มีคำไหนที่ทำท่าแล้วระบบเงียบ"}</Note>;
  return (
    <div className="scrollbar-thin max-h-72 overflow-auto rounded-xl ring-1 ring-sky">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-panel text-left text-xs text-ink/60">
          <tr>
            <th className="px-3 py-2 font-semibold">{kind === "falseAlarm" ? "คำที่เผลอขึ้น" : "ทำท่าคำว่า"}</th>
            <th className="px-3 py-2 text-right font-semibold">{kind === "falseAlarm" ? "กี่ครั้ง" : "เงียบกี่คลิป"}</th>
            <th className="px-3 py-2 text-right font-semibold">{kind === "falseAlarm" ? '% ของช่วง "ไม่ได้ทำท่า"' : "% ของคำนี้"}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-sky/60">
          {list.map((r) => (
            <tr key={r.word}>
              <td className="px-3 py-1.5 font-semibold text-navy">{r.word}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">
                {r.count}
                {r.clips != null && <span className="text-ink/50"> / {r.clips}</span>}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">{pct(r.rate, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ตารางคะแนนรายคำ (เรียงจากคำที่แย่ที่สุดก่อน)
function WordTable({ rows, cols, sortKey }: { rows: WordRow[]; cols: ("recall" | "precision" | "f1")[]; sortKey: "recall" | "precision" | "f1" }) {
  const label = { recall: LABELS.recall, precision: LABELS.precision, f1: LABELS.f1 } as const;
  const columns: Column<WordRow>[] = [
    { key: "word", header: "คำ", sort: (r) => r.word, cell: (r) => <span className="font-semibold text-navy">{r.word}</span> },
    ...cols.map((k) => ({
      key: k,
      header: label[k],
      align: "right" as const,
      sort: (r: WordRow) => r[k],
      cell: (r: WordRow) => <Badge tone={r[k] >= 0.7 ? "success" : r[k] >= 0.4 ? "warning" : "danger"}>{pct(r[k], 0)}</Badge>,
    })),
    { key: "clips", header: "คลิปทดสอบ", align: "right", sort: (r) => r.clips, cell: (r) => <span className="tabular-nums">{r.clips}</span> },
  ];
  return <DataTable rows={rows} columns={columns} rowKey={(r) => r.word} initialSort={{ key: sortKey, dir: "asc" }} pageSize={50} maxHeight="20rem" empty="ไม่มีคะแนนรายคำ" />;
}

// หน้าต่างรายละเอียดของตัวเลขหนึ่งตัว: คืออะไร ได้มายังไง และคำ/เคสที่ต้องปรับปรุง (ใช้ทั้งแดชบอร์ดและหน้าโมเดล)
export function MetricDialog({
  open,
  m,
  modelWords,
  subtitle,
  onClose,
}: {
  open: Key | null;
  m: MetricDetail;
  modelWords: number | null;
  subtitle: string;
  onClose: () => void;
}) {
  const rows = useMemo<WordRow[]>(
    () => Object.entries(m.per_word ?? {}).map(([word, w]) => ({ word, recall: w.recall, precision: w.precision, f1: w.f1, clips: w.clips })),
    [m],
  );
  const clips = m.clips ?? 0;
  const card = ALL_CARDS.find((c) => c.key === open);
  const unmeasured = modelWords != null ? Math.max(0, modelWords - rows.length) : 0;
  const coverage =
    unmeasured > 0 ? (
      <Note>
        มี {unmeasured} คำที่โมเดลรู้จักแต่ยังไม่มีคลิปในชุดเทส จึงยังไม่รู้ว่าทายคำพวกนี้ได้ดีแค่ไหน (ไม่ได้นับในตัวเลขนี้) — ให้ล่ามตัวจริงอัดคำเหล่านี้
        คลิปของล่ามจะเข้าชุดเทสให้เอง (ดูรายชื่อคำได้ที่{" "}
        <Link to="/admin/models?tab=split" className="font-semibold text-brand hover:underline">
          โมเดล › ชุดเทส
        </Link>
        )
      </Note>
    ) : null;
  const smallNote = <p className="text-xs text-ink/55">คำที่มีคลิปทดสอบน้อย (1–2 คลิป) ตัวเลขอาจแกว่งมาก ทายผิดคลิปเดียวก็ตกเหลือ 0–50%</p>;

  let body: ReactNode = null;
  if (open === "accuracy")
    body = (
      <>
        <Big>
          ทายถูก <b>{num(Math.round((m.accuracy ?? 0) * clips))}</b> จาก {num(clips)} คลิป = <b>{pct(m.accuracy)}</b>
        </Big>
        {coverage}
        <Section title="คำที่ระบบยังทายไม่ค่อยถูก">
          {smallNote}
          <WordTable rows={rows} cols={["recall"]} sortKey="recall" />
        </Section>
        <Section title="คำที่ระบบมักจำสลับกัน">
          <p className="text-xs text-ink/55">{HINTS.confusions}</p>
          <Confusions m={m} />
        </Section>
        {m.confidence && (
          <Section title="ตอนระบบมั่นใจ ทายถูกจริงไหม">
            <p className="text-xs text-ink/55">{HINTS.chart}</p>
            <ConfidenceChart data={m.confidence} threshold={m.threshold} />
          </Section>
        )}
      </>
    );
  else if (open === "top3")
    body = (
      <>
        <Big>
          ทายถูกตั้งแต่ตัวเลือกแรก <b>{pct(m.accuracy)}</b> · ถ้านับ 3 ตัวเลือกแรก <b>{pct(m.top3)}</b>
          <br />
          <span className="text-sm text-ink/70">
            แปลว่าอีก {pct((m.top3 ?? 0) - (m.accuracy ?? 0))} ระบบ "เกือบถูก" — คำที่ถูกอยู่อันดับ 2 หรือ 3 ผู้ใช้กดเลือกคำรองเพื่อแก้ได้
          </span>
        </Big>
        {coverage}
        <Section title="คำที่ระบบมักจำสลับกัน">
          <p className="text-xs text-ink/55">{HINTS.confusions}</p>
          <Confusions m={m} />
        </Section>
        <Note>ระบบยังไม่ได้แยกคะแนนนี้ทีละคำ</Note>
      </>
    );
  else if (open === "precision")
    body = (
      <>
        <Big>
          เวลาระบบขึ้นคำบนจอ ถูกจริงเฉลี่ย <b>{pct(m.precision)}</b>
          <br />
          <span className="text-sm text-ink/70">ต่ำ = มีคำที่ระบบชอบขึ้นผิด ๆ ทั้งที่คนทำท่าคำอื่น</span>
        </Big>
        {coverage}
        <Section title="คำที่ระบบชอบขึ้นผิดที่สุด">
          {smallNote}
          <WordTable rows={rows} cols={["precision"]} sortKey="precision" />
        </Section>
        <Section title="คำที่ระบบมักจำสลับกัน">
          <p className="text-xs text-ink/55">{HINTS.confusions}</p>
          <Confusions m={m} />
        </Section>
      </>
    );
  else if (open === "recall")
    body = (
      <>
        <Big>
          เวลามีคนทำท่า ระบบจับได้ถูกเฉลี่ย <b>{pct(m.recall)}</b>
          <br />
          <span className="text-sm text-ink/70">ต่ำ = มีคำที่ทำท่าแล้วระบบไม่ค่อยรู้จัก (ขึ้นคำอื่น หรือเงียบ)</span>
        </Big>
        {coverage}
        <Section title="คำที่ทำท่าแล้วระบบจับได้น้อยที่สุด">
          {smallNote}
          <WordTable rows={rows} cols={["recall"]} sortKey="recall" />
        </Section>
        <Section title="คำไหนที่ทำท่าแล้วระบบเงียบบ่อยที่สุด">
          <SilenceTable kind="dropped" m={m} />
        </Section>
      </>
    );
  else if (open === "threshold")
    body = (
      <>
        <ThresholdExplainer threshold={m.threshold} words={modelWords} />
        <Section title="ถ้าเปลี่ยนความมั่นใจขั้นต่ำ จะเป็นยังไง">
          <ThresholdTable m={m} />
        </Section>
        {m.confidence && (
          <Section title="ตอนระบบมั่นใจ ทายถูกจริงไหม">
            <p className="text-xs text-ink/55">{HINTS.chart}</p>
            <ConfidenceChart data={m.confidence} threshold={m.threshold} />
          </Section>
        )}
      </>
    );
  else if (open === "f1")
    body = (
      <>
        <Big>
          {LABELS.precision} <b>{pct(m.precision)}</b> · {LABELS.recall} <b>{pct(m.recall)}</b> → {LABELS.f1} <b>{pct(m.f1)}</b>
        </Big>
        <Note>
          <b>{LABELS.precision}</b> ต่ำ = ระบบชอบขึ้นคำนี้ผิด ๆ (ทั้งที่คนทำท่าคำอื่น)
          <br />
          <b>{LABELS.recall}</b> ต่ำ = คนทำท่าคำนี้แล้วระบบไม่ค่อยรู้จัก
          <br />
          คะแนนรวมจะดีก็ต่อเมื่อทั้งสองอย่างดี คิดแยกทีละคำแล้วเฉลี่ย ทุกคำนับเท่ากัน
        </Note>
        {coverage}
        <Section title="คะแนนทีละคำ (คำที่แย่ที่สุดขึ้นก่อน)">
          {smallNote}
          <WordTable rows={rows} cols={["precision", "recall", "f1"]} sortKey="f1" />
        </Section>
      </>
    );
  else if (open === "falseAlarm" || open === "dropped")
    body = (
      <>
        {open === "falseAlarm" ? (
          <Big>
            {m.null_false_alarm == null ? (
              'ชุดเทสนี้ไม่มีคลิปช่วง "ไม่ได้ทำท่า" จึงวัดตัวเลขนี้ไม่ได้'
            ) : (
              <>
                ทุก 100 ครั้งที่ไม่มีใครทำภาษามือ ระบบเผลอขึ้นคำมาประมาณ <b>{Math.round((m.null_false_alarm ?? 0) * 100)}</b> ครั้ง
              </>
            )}
          </Big>
        ) : (
          <Big>
            ทุก 100 ครั้งที่คนทำภาษามือจริง ระบบไม่ขึ้นคำอะไรเลยประมาณ <b>{Math.round((m.word_dropped ?? 0) * 100)}</b> ครั้ง
            <br />
            <span className="text-sm text-ink/70">เพราะระบบไม่มั่นใจพอ หรือคิดว่าคนนั้นไม่ได้ทำท่า</span>
          </Big>
        )}
        <Section title={open === "falseAlarm" ? "ตอนไม่ได้ทำท่า คำไหนเผลอขึ้นมาบ่อยที่สุด" : "คำไหนที่ทำท่าแล้วระบบเงียบบ่อยที่สุด"}>
          {open === "dropped" && smallNote}
          <SilenceTable kind={open} m={m} />
        </Section>
        <ThresholdExplainer threshold={m.threshold} words={modelWords} />
        <Section title="ถ้าเปลี่ยนความมั่นใจขั้นต่ำ จะเป็นยังไง">
          <ThresholdTable m={m} />
        </Section>
      </>
    );

  return (
    <Dialog open={!!open} title={card ? `${LABELS[card.key]} ${pct(card.value(m))}` : ""} subtitle={subtitle} size="xl" onClose={onClose}>
      {open && (
        <div className="flex flex-col gap-5">
          <Section title="ตัวเลขนี้คืออะไร">
            <p className="text-sm leading-relaxed">{HINTS[open]}</p>
          </Section>
          {body}
        </div>
      )}
    </Dialog>
  );
}
