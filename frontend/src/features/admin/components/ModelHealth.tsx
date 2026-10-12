import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Badge from "../../../components/ui/Badge";
import Card from "../../../components/ui/Card";
import Dialog from "../../../components/ui/Dialog";
import Icon from "../../../components/ui/Icon";
import DataTable, { type Column } from "./DataTable";
import { HINTS, LABELS } from "./metricInfo";
import { ConfidenceChart } from "./ModelMetrics";
import { getModelMetrics, listModels, type MetricDetail, type ModelFile, type ModelMetrics } from "../services/adminApi";

// แสดงเปอร์เซ็นต์ (ไม่มีค่า = ขีด)
const pct = (v: number | null | undefined, digits = 1) => (v == null ? "–" : `${(v * 100).toFixed(digits)}%`);
const num = (n: number) => n.toLocaleString("th-TH");

// ตัวเลขที่แสดงบนแดชบอร์ด 5 ตัว (ตัวที่เหลือดูได้ในหน้าโมเดล)
type Key = "accuracy" | "top3" | "f1" | "falseAlarm" | "dropped";
const CARDS: { key: Key; better: "high" | "low"; value: (m: MetricDetail) => number | null | undefined }[] = [
  { key: "accuracy", better: "high", value: (m) => m.accuracy },
  { key: "top3", better: "high", value: (m) => m.top3 },
  { key: "f1", better: "high", value: (m) => m.f1 },
  { key: "falseAlarm", better: "low", value: (m) => m.null_false_alarm },
  { key: "dropped", better: "low", value: (m) => m.word_dropped },
];

// ผลรายคำหนึ่งแถว
interface WordRow {
  word: string;
  recall: number;
  precision: number;
  f1: number;
  clips: number;
}

// เลือกโมเดลที่จะแสดง: ตัวที่ใช้งานอยู่ ถ้าไม่มีใช้ Draft ถ้าไม่มีอีกใช้ตัวล่าสุดที่มีผลวัด
function pickModel(models: ModelFile[]): ModelFile | undefined {
  const ok = models.filter((m) => m.compatible !== false);
  return ok.find((m) => m.active) ?? ok.find((m) => m.draft) ?? ok.find((m) => m.validation || m.test);
}

// การ์ด "โมเดลแม่นแค่ไหน" บนแดชบอร์ด: 5 ตัวเลขหลัก กดการ์ดเพื่อดูคำอธิบายและคำที่ต้องปรับปรุง
export default function ModelHealth() {
  const [model, setModel] = useState<ModelFile | null | undefined>(undefined);
  const [data, setData] = useState<ModelMetrics | null>(null);
  const [source, setSource] = useState<"validation" | "test">("validation");
  const [open, setOpen] = useState<Key | null>(null);
  const [error, setError] = useState<string | null>(null);

  // โหลดรายการโมเดล แล้วโหลดผลวัดของตัวที่เลือก
  useEffect(() => {
    let alive = true;
    listModels()
      .then(async (models) => {
        const m = pickModel(models) ?? null;
        if (!alive) return;
        setModel(m);
        if (!m) return;
        const d = await getModelMetrics(m.version);
        if (!alive) return;
        setData(d);
        if (!d.validation?.clips && d.test?.clips) setSource("test");
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "โหลดผลโมเดลไม่สำเร็จ"));
    return () => {
      alive = false;
    };
  }, []);

  const m = data?.[source];
  const status = model?.active ? "ใช้งานอยู่" : model?.draft ? "Draft ยังไม่เผยแพร่" : "";
  const title = model ? `โมเดลแม่นแค่ไหน · ${model.label}${status ? ` (${status})` : ""}` : "โมเดลแม่นแค่ไหน";
  const measured = m?.per_word ? Object.keys(m.per_word).length : 0;
  const action = (
    <Link to="/admin/models" className="text-xs font-semibold text-brand hover:underline">
      ดูทั้งหมด
    </Link>
  );

  if (error)
    return (
      <Card title={title} action={action}>
        <p className="text-sm text-danger">{error}</p>
      </Card>
    );
  if (model === undefined)
    return (
      <Card title={title}>
        <p className="text-sm text-ink/60">กำลังโหลด…</p>
      </Card>
    );
  if (!model || !m?.clips)
    return (
      <Card title={title} action={action}>
        <p className="text-sm text-ink/60">ยังไม่มีคะแนนของโมเดล — เทรนโมเดล หรือกด Run Test ในหน้าโมเดลก่อน</p>
      </Card>
    );

  return (
    <Card
      title={title}
      action={
        <span className="flex items-center gap-2">
          <span className="flex rounded-lg bg-sky/40 p-0.5 text-xs" role="tablist" title={HINTS.source}>
            {(["validation", "test"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={source === s}
                disabled={!data?.[s]?.clips}
                onClick={() => setSource(s)}
                className={`rounded-md px-2 py-0.5 font-semibold transition disabled:opacity-40 ${source === s ? "bg-surface text-navy shadow" : "text-ink/60"}`}
              >
                {s === "validation" ? "ตอนเทรน" : "Run Test"}
              </button>
            ))}
          </span>
          {action}
        </span>
      }
    >
      <p className="mb-3 text-sm text-ink/70">
        เราเก็บคลิปของคนที่โมเดลไม่เคยเห็น (ล่ามตัวจริง และคนในชุด TSL ที่ระบบสุ่มไว้) เป็น "ชุดทดสอบ" {num(m.clips)} คลิป แล้วให้โมเดลทายว่าเป็นคำอะไร · มีคลิปทดสอบ {measured} จาก{" "}
        {model.words ?? "?"} คำที่โมเดลรู้จัก · <b>กดการ์ดเพื่อดูคำอธิบายและคำที่ต้องปรับปรุง</b>
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {CARDS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setOpen(c.key)}
            className="flex flex-col rounded-xl bg-surface px-4 py-3 text-left ring-1 ring-sky transition hover:ring-2 hover:ring-brand/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span className="flex items-start gap-1 text-xs text-ink/65">
              <span>{LABELS[c.key]}</span>
              <Icon name="help" size={13} className="mt-0.5 shrink-0 text-brand" />
            </span>
            <span className="mt-1 block text-xl font-bold tabular-nums text-navy">{pct(c.value(m))}</span>
            <span className="text-[11px] text-ink/45">{c.better === "high" ? "ยิ่งสูงยิ่งดี" : "ยิ่งน้อยยิ่งดี"}</span>
          </button>
        ))}
      </div>
      <MetricDialog
        open={open}
        m={m}
        modelWords={model.words}
        subtitle={`${model.label} · ${source === "validation" ? "คะแนนตอนเทรน" : "คะแนน Run Test"} · ชุดทดสอบ ${num(m.clips)} คลิป`}
        onClose={() => setOpen(null)}
      />
    </Card>
  );
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

// ตารางคะแนนรายคำ (เรียงจากคำที่แย่ที่สุดก่อน)
function WordTable({ rows, cols, sortKey }: { rows: WordRow[]; cols: ("recall" | "precision" | "f1")[]; sortKey: "recall" | "f1" }) {
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

// หน้าต่างรายละเอียดของตัวเลขหนึ่งตัว: คืออะไร ได้มายังไง และคำ/เคสที่ต้องปรับปรุง
function MetricDialog({
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
  const card = CARDS.find((c) => c.key === open);
  const unmeasured = modelWords != null ? Math.max(0, modelWords - rows.length) : 0;
  const coverage =
    unmeasured > 0 ? (
      <Note>
        มี {unmeasured} คำที่โมเดลรู้จักแต่ยังไม่มีคลิปในชุดทดสอบ จึงยังไม่รู้ว่าทายคำพวกนี้ได้ดีแค่ไหน (ไม่ได้นับในตัวเลขนี้) — ให้ล่ามตัวจริงอัดคำเหล่านี้
        คลิปของล่ามจะเข้าชุดทดสอบให้เอง (ดูรายชื่อคำได้ที่{" "}
        <Link to="/admin/models?tab=split" className="font-semibold text-brand hover:underline">
          โมเดล › ชุดทดสอบ
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
              'ชุดทดสอบนี้ไม่มีคลิปช่วง "ไม่ได้ทำท่า" จึงวัดตัวเลขนี้ไม่ได้'
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
        <ThresholdExplainer threshold={m.threshold} words={modelWords} />
        <Section title="ถ้าเปลี่ยนความมั่นใจขั้นต่ำ จะเป็นยังไง">
          <ThresholdTable m={m} />
        </Section>
        {open === "dropped" && (
          <Section title="คำที่ทำท่าแล้วระบบจับได้น้อยที่สุด">
            {smallNote}
            <WordTable rows={rows} cols={["recall"]} sortKey="recall" />
          </Section>
        )}
        <Note>
          {open === "falseAlarm"
            ? "ระบบยังไม่ได้เก็บว่าตอนไม่ได้ทำท่า คำไหนเผลอขึ้นมาบ่อยที่สุด"
            : "ระบบยังไม่ได้แยกว่าคำไหนเงียบบ่อย ตารางด้านบนคือคำที่ระบบจับได้น้อย ซึ่งรวมทั้งตอนเงียบและตอนขึ้นคำผิด"}
        </Note>
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
