// การ์ด "โมเดลแม่นแค่ไหน" บนแดชบอร์ด

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card from "../../../components/ui/Card";
import Icon from "../../../components/ui/Icon";
import { HINTS, LABELS } from "./metricInfo";
import { ALL_CARDS, MetricDialog, type MetricKey } from "./MetricDialog";
import { getModelMetrics, listModels, type ModelFile, type ModelMetrics } from "../services/adminApi";

// แสดงเปอร์เซ็นต์ (ไม่มีค่า = ขีด)
const pct = (v: number | null | undefined, digits = 1) => (v == null ? "–" : `${(v * 100).toFixed(digits)}%`);
const num = (n: number) => n.toLocaleString("th-TH");

type Key = MetricKey;
// การ์ด 5 ใบบนแดชบอร์ด
const DASHBOARD_KEYS: Key[] = ["accuracy", "top3", "f1", "falseAlarm", "dropped"];
const CARDS = ALL_CARDS.filter((c) => DASHBOARD_KEYS.includes(c.key));

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
        เราเก็บคลิปของคนที่โมเดลไม่เคยเห็น (ล่ามตัวจริง และคนในชุด TSL ที่ระบบสุ่มไว้) เป็น "ชุดเทส" {num(m.clips)} คลิป แล้วให้โมเดลทายว่าเป็นคำอะไร · มีคลิปทดสอบ {measured} จาก{" "}
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
        subtitle={`${model.label} · ${source === "validation" ? "คะแนนตอนเทรน" : "คะแนน Run Test"} · ชุดเทส ${num(m.clips)} คลิป`}
        onClose={() => setOpen(null)}
      />
    </Card>
  );
}
