import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import Icon from "../../components/ui/Icon";
import SearchInput from "../../components/ui/SearchInput";
import Switch from "../../components/ui/Switch";
import { logEvent } from "../../lib/activityLog";
import { fmtBytes, fmtDate } from "../../lib/format";
import {
  getTestSplit,
  getTrainStatus,
  listModels,
  publishModel,
  setActiveModel,
  setTestSplit,
  type ModelFile,
  type TestSplit,
  type TrainProgress,
  type TrainStatus,
} from "./services/adminApi";

// ชื่อขั้นการเทรน และช่วงของแถบความคืบหน้า (0-1) ที่แต่ละขั้นใช้
const STAGES: Record<NonNullable<TrainProgress["stage"]>, { label: string; from: number; to: number }> = {
  load: { label: "โหลดข้อมูล", from: 0, to: 0.05 },
  validate: { label: "เทรนเพื่อวัดความแม่นยำ", from: 0.05, to: 0.5 },
  final: { label: "เทรนรอบสุดท้ายด้วยข้อมูลทั้งหมด", from: 0.5, to: 0.95 },
  save: { label: "บันทึกโมเดล", from: 0.95, to: 1 },
  done: { label: "เสร็จ", from: 1, to: 1 },
  failed: { label: "หยุด", from: 0, to: 0 },
};

// ข้อความ/สีของสถานะการเทรน
const RUN_STATUS: Record<TrainStatus["status"], { label: string; tone: "neutral" | "warning" | "success" | "danger" }> = {
  idle: { label: "ยังไม่เคยเทรน", tone: "neutral" },
  running: { label: "กำลังเทรน", tone: "warning" },
  stalled: { label: "ขาดการติดต่อ", tone: "warning" },
  succeeded: { label: "เทรนเสร็จแล้ว", tone: "success" },
  failed: { label: "เทรนไม่สำเร็จ", tone: "danger" },
};

// สัดส่วนความคืบหน้าทั้งหมด (0-1) จากขั้นและรอบที่รายงานมา
function overall(p: TrainProgress): number {
  const stage = STAGES[p.stage ?? "load"];
  const inStage = p.epoch && p.epochs ? p.epoch / p.epochs : 0;
  return stage.from + (stage.to - stage.from) * inStage;
}

// แสดงเปอร์เซ็นต์ (ไม่มีค่า = ขีด)
const pct = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v * 100)}%`);

// หน้าโมเดล: เทียบโมเดลที่ใช้กับ Draft → ทดสอบ/เผยแพร่, สถานะการเทรน, เลือกชุดทดสอบ, ประวัติเวอร์ชัน
export default function ModelsView() {
  const [models, setModels] = useState<ModelFile[]>([]);
  const [status, setStatus] = useState<TrainStatus | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "publish" } | { kind: "activate"; model: ModelFile } | null>(null);
  const [busy, setBusy] = useState(false);

  // โหลดรายการโมเดล
  const refreshModels = useCallback(async () => {
    try {
      setModels(await listModels());
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "โหลดรายการโมเดลไม่สำเร็จ" });
    }
  }, []);

  // โหลดสถานะการเทรน
  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await getTrainStatus());
    } catch {
      /* แสดงสถานะเดิมต่อ */
    }
  }, []);

  // โหลดตอนเปิดหน้า แล้วถามสถานะทุก 3 วินาทีขณะเทรน (ไม่ได้เทรน 15 วินาที เผื่อมีคนเริ่มเทรนจากเครื่อง)
  const running = status?.status === "running";
  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);
  useEffect(() => {
    void refreshStatus();
    const id = window.setInterval(() => void refreshStatus(), running ? 3000 : 15000);
    return () => window.clearInterval(id);
  }, [running, refreshStatus]);

  // เทรนเสร็จแล้วโหลดรายการโมเดลใหม่ (จะได้เห็น Draft ตัวใหม่)
  const finishedRef = useRef<number | null>(null);
  useEffect(() => {
    const id = status?.run?.id ?? null;
    if ((status?.status === "succeeded" || status?.status === "failed") && finishedRef.current !== id) {
      finishedRef.current = id;
      void refreshModels();
    }
  }, [status, refreshModels]);

  const active = models.find((m) => m.active) ?? null;
  const draft = models.find((m) => m.draft) ?? null;

  // ทำสิ่งที่ยืนยันแล้ว (เผยแพร่ Draft / ใช้เวอร์ชันเก่า)
  const doConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const r = confirm.kind === "publish" ? await publishModel() : await setActiveModel(confirm.model.version);
      setMessage({ ok: true, text: r.message });
      await refreshModels();
      void refreshStatus();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "เกิดข้อผิดพลาด" });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {message && (
        <p className={`rounded-xl px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-danger/10 text-danger"}`}>{message.text}</p>
      )}

      {/* โมเดลที่ใช้ vs Draft */}
      <div className="grid gap-4 md:grid-cols-2">
        <ModelCard title="ใช้งานอยู่" model={active} highlight />
        <ModelCard
          title="Draft (รอทดสอบ)"
          model={draft}
          compare={active}
          empty="ยังไม่มี Draft — เทรนโมเดลใหม่ด้วยคำสั่งด้านล่าง"
          actions={
            draft && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="play"
                  onClick={() => {
                    logEvent("ทดสอบโมเดล Draft", draft.label);
                    window.open("/?version=draft", "_blank");
                  }}
                >
                  ลองใช้ Draft
                </Button>
                <Button size="sm" icon="check" disabled={busy || running} onClick={() => setConfirm({ kind: "publish" })}>
                  เผยแพร่
                </Button>
              </>
            )
          }
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <TrainingCard status={status} />
        <TestSplitCard />
      </div>

      <HistoryCard models={models} onActivate={(m) => setConfirm({ kind: "activate", model: m })} />

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === "publish" ? "เผยแพร่โมเดล Draft" : "เปลี่ยนเวอร์ชันที่ใช้"}
        busy={busy}
        confirmLabel={confirm?.kind === "publish" ? "เผยแพร่" : "ใช้เวอร์ชันนี้"}
        onClose={() => setConfirm(null)}
        onConfirm={() => void doConfirm()}
      >
        {confirm?.kind === "publish" ? (
          <>
            ผู้ใช้ทุกคนจะใช้ <b>{draft?.label}</b> แปลภาษามือทันที (ทายถูก {pct(draft?.val_accuracy)} เทียบกับตัวเดิม {pct(active?.val_accuracy)})
            · ย้อนกลับไปเวอร์ชันเดิมได้จากประวัติเวอร์ชัน
          </>
        ) : (
          confirm?.kind === "activate" && (
            <>
              เปลี่ยนโมเดลที่ใช้แปลภาษามือเป็น <b>{confirm.model.label}</b> ใช่ไหม?
            </>
          )
        )}
      </ConfirmDialog>
    </div>
  );
}

// การ์ดโมเดลหนึ่งตัว: ความแม่นยำใหญ่ ๆ จำนวนคำ/คลิป วันที่เทรน (Draft แสดงผลต่างเทียบตัวที่ใช้)
function ModelCard({
  title,
  model,
  compare,
  highlight,
  empty = "ยังไม่มีโมเดล",
  actions,
}: {
  title: string;
  model: ModelFile | null;
  compare?: ModelFile | null;
  highlight?: boolean;
  empty?: string;
  actions?: ReactNode;
}) {
  const diff = model?.val_accuracy != null && compare?.val_accuracy != null ? model.val_accuracy - compare.val_accuracy : null;
  return (
    <section className={`glass-card flex flex-col gap-3 ${highlight ? "ring-2 ring-emerald-300" : ""}`}>
      <header className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-brand">{title}</h3>
        {model && <span className="text-xl font-bold text-navy">{model.label}</span>}
      </header>
      {model ? (
        <>
          <div className="flex items-end gap-3">
            <span className="text-4xl font-bold tabular-nums text-navy">{pct(model.val_accuracy)}</span>
            <span className="pb-1 text-sm text-ink/60">
              ทายถูกกับผู้แสดงใหม่
              {diff != null && (
                <span className={`ml-1.5 font-semibold ${diff >= 0 ? "text-emerald-700" : "text-danger"}`}>
                  ({diff >= 0 ? "+" : ""}
                  {Math.round(diff * 100)}%)
                </span>
              )}
            </span>
          </div>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-xs text-ink/55">ติด 3 อันดับแรก</dt>
              <dd className="font-semibold text-navy">{pct(model.val_top3)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink/55">รู้จัก</dt>
              <dd className="font-semibold text-navy">{model.words ?? "–"} คำ</dd>
            </div>
            <div>
              <dt className="text-xs text-ink/55">เทรนจาก</dt>
              <dd className="font-semibold text-navy">{model.samples ?? "–"} คลิป</dd>
            </div>
          </dl>
          <p className="text-xs text-ink/50">เทรนเมื่อ {fmtDate(model.modified_at)}</p>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </>
      ) : (
        <p className="py-6 text-center text-sm text-ink/55">{empty}</p>
      )}
    </section>
  );
}

// การ์ดการเทรน: คำสั่งที่ใช้เทรนจากเครื่อง สถานะ ความคืบหน้า และ log (พับไว้)
function TrainingCard({ status }: { status: TrainStatus | null }) {
  const [copied, setCopied] = useState(false);
  const r = status?.run;
  const prog = r?.progress ?? {};
  const fraction = status?.status === "succeeded" ? 1 : overall(prog);
  const st = RUN_STATUS[status?.status ?? "idle"];

  // คัดลอกคำสั่งเทรน
  const copy = async () => {
    if (!status) return;
    try {
      await navigator.clipboard.writeText(status.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* เบราว์เซอร์ไม่อนุญาต ให้ผู้ใช้คัดลอกเอง */
    }
  };

  return (
    <Card title="เทรนโมเดล" action={<Badge tone={st.tone}>{st.label}</Badge>}>
      <ol className="mb-3 flex flex-col gap-1 text-sm text-ink/70">
        <li>1. เลือกคำในแท็บ "คลังคำศัพท์" และชุดทดสอบ (การ์ดข้าง ๆ)</li>
        <li>2. รันคำสั่งนี้บนเครื่องที่มี torch (ที่รากโปรเจกต์)</li>
        <li>3. ได้ Draft แล้วลองใช้ ถ้าดีกว่าตัวเดิมค่อยกดเผยแพร่</li>
      </ol>
      {status && (
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-navy/90 px-3 py-2 text-xs text-sky">{status.command}</code>
          <Button size="sm" variant="ghost" icon={copied ? "check" : "text"} onClick={() => void copy()}>
            {copied ? "คัดลอกแล้ว" : "คัดลอก"}
          </Button>
        </div>
      )}

      {r && (status?.status === "running" || status?.status === "stalled") && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-ink/60">
            <span>
              {STAGES[prog.stage ?? "load"].label}
              {prog.epoch && prog.epochs ? ` · รอบ ${prog.epoch}/${prog.epochs}` : ""}
            </span>
            <span className="font-semibold text-navy">{Math.round(fraction * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-sky/50">
            <div className="h-full rounded-full bg-gradient-to-r from-brand to-royal transition-[width] duration-700" style={{ width: `${fraction * 100}%` }} />
          </div>
          {status?.status === "stalled" && <p className="mt-1 text-xs text-amber-700">เครื่องที่เทรนเงียบไปเกิน 2 นาที อาจถูกปิดหรือหลุดการเชื่อมต่อ</p>}
        </div>
      )}
      {r && (
        <p className="mt-3 text-xs text-ink/55">
          ครั้งล่าสุด {r.started_at ? fmtDate(r.started_at) : "-"}
          {r.host && ` · เครื่อง ${r.host}`}
          {prog.val_accuracy != null && ` · ทายถูก ${pct(prog.val_accuracy)}`}
        </p>
      )}
      {r?.error && <p className="mt-1 text-xs text-danger">{r.error}</p>}
      {r && r.log.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold text-brand">ดู log การเทรน</summary>
          <pre className="scrollbar-thin mt-1 max-h-48 overflow-auto rounded-lg bg-navy/90 p-2 text-[11px] leading-relaxed text-sky">{r.log.join("\n")}</pre>
        </details>
      )}
    </Card>
  );
}

// การ์ดชุดทดสอบ: เลือกผู้แสดงที่กันไว้วัดความแม่นยำ (ไม่เลือก = สุ่มอัตโนมัติ)
function TestSplitCard() {
  const [data, setData] = useState<TestSplit | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // โหลดรายชื่อผู้แสดง
  useEffect(() => {
    getTestSplit()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "โหลดไม่สำเร็จ"));
  }, []);

  // บันทึกรายชื่อผู้แสดงที่เลือก
  const save = async (ids: string[]) => {
    setBusy(true);
    setError(null);
    try {
      setData(await setTestSplit(ids));
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const selected = useMemo(() => data?.signers.filter((s) => s.test).map((s) => s.id) ?? [], [data]);
  // สลับผู้แสดงหนึ่งคน
  const toggle = (id: string, on: boolean) => void save(on ? [...selected, id] : selected.filter((x) => x !== id));
  const groups = useMemo(() => {
    const m = new Map<string, TestSplit["signers"]>();
    for (const s of data?.signers ?? []) {
      if (q.trim() && !s.name.toLowerCase().includes(q.trim().toLowerCase())) continue;
      m.set(s.source, [...(m.get(s.source) ?? []), s]);
    }
    return [...m.entries()];
  }, [data, q]);
  const testClips = data?.signers.filter((s) => s.test).reduce((n, s) => n + s.clips, 0) ?? 0;
  const allClips = data?.signers.reduce((n, s) => n + s.clips, 0) ?? 0;

  return (
    <Card
      title="ชุดทดสอบ"
      action={
        data && (
          <Badge tone={data.mode === "auto" ? "neutral" : "brand"}>{data.mode === "auto" ? "สุ่มอัตโนมัติ" : `เลือกเอง ${selected.length} คน`}</Badge>
        )
      }
    >
      <p className="mb-2 text-xs text-ink/60">
        ผู้แสดงที่เลือกจะไม่ถูกใช้ตอนเทรนรอบวัดผล ตัวเลข % จึงบอกว่าโมเดลทายคน "ที่ไม่เคยเห็น" ได้แค่ไหน · โมเดลจริงยังเทรนด้วยข้อมูลทุกคน
        · ไม่เลือกใครเลย = สุ่ม 20% ให้เอง · เลือกรายคลิปได้ในแผงคำของแท็บคลังคำศัพท์
      </p>
      {data && selected.length > 0 && (
        <p className="mb-2 text-xs text-navy">
          ชุดทดสอบ {testClips.toLocaleString("th-TH")} จาก {allClips.toLocaleString("th-TH")} คลิป ({allClips ? Math.round((testClips / allClips) * 100) : 0}%)
          <button type="button" className="ml-2 font-semibold text-brand hover:underline" disabled={busy} onClick={() => void save([])}>
            กลับไปสุ่มอัตโนมัติ
          </button>
        </p>
      )}
      {data && data.words_without_test.length > 0 && (
        <p className="mb-2 flex gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
          คำที่ไม่มีคลิปทดสอบ (จะวัดความแม่นยำคำนี้ไม่ได้): {data.words_without_test.join(", ")}
        </p>
      )}
      {data && data.words_without_train.length > 0 && (
        <p className="mb-2 flex gap-1.5 rounded-lg bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
          คำที่ทุกคลิปอยู่ในชุดทดสอบ (เหลือให้เทรน 0): {data.words_without_train.join(", ")}
        </p>
      )}
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      <SearchInput value={q} onChange={setQ} placeholder="ค้นหาผู้แสดง" />
      <div className="scrollbar-thin mt-2 max-h-72 overflow-y-auto rounded-xl bg-white/70 ring-1 ring-sky">
        {!data && <p className="px-3 py-6 text-center text-sm text-ink/50">กำลังโหลด…</p>}
        {groups.map(([source, list]) => (
          <section key={source}>
            <h4 className="sticky top-0 border-b border-sky/60 bg-cream/95 px-3 py-1 text-xs font-bold text-navy">
              {source === "ล่าม" ? "ทีมที่อัดผ่านระบบ" : source} · {list.length} คน
            </h4>
            <ul className="divide-y divide-sky/40">
              {list.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-navy">{s.name}</span>
                    <span className="text-[11px] text-ink/50">
                      {s.clips} คลิป · {s.words} คำ
                    </span>
                  </span>
                  <Switch checked={s.test} disabled={busy} onChange={(on) => toggle(s.id, on)} label={`ใช้ ${s.name} เป็นชุดทดสอบ`} size="sm" />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  );
}

// ประวัติเวอร์ชันทั้งหมด พร้อมปุ่มย้อนกลับไปใช้เวอร์ชันเก่า
function HistoryCard({ models, onActivate }: { models: ModelFile[]; onActivate: (m: ModelFile) => void }) {
  return (
    <Card title={`ประวัติเวอร์ชัน (${models.length})`}>
      {models.length === 0 ? (
        <p className="text-sm text-ink/60">ยังไม่มีโมเดล</p>
      ) : (
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-ink/50">
              <tr>
                <th className="py-1.5 pr-3 font-semibold">เวอร์ชัน</th>
                <th className="py-1.5 pr-3 font-semibold">ทายถูก</th>
                <th className="py-1.5 pr-3 font-semibold">คำ / คลิป</th>
                <th className="py-1.5 pr-3 font-semibold">เทรนเมื่อ</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/50">
              {models.map((m) => (
                <tr key={m.version}>
                  <td className="py-2 pr-3">
                    <span className="font-semibold text-navy">{m.label}</span>
                    {m.active && <Badge tone="success" className="ml-1.5">ใช้งานอยู่</Badge>}
                    {m.draft && <Badge tone="warning" className="ml-1.5">Draft</Badge>}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {pct(m.val_accuracy)}
                    <span className="text-xs text-ink/45"> (3 อันดับ {pct(m.val_top3)})</span>
                  </td>
                  <td className="py-2 pr-3 text-ink/70">
                    {m.words ?? "–"} / {m.samples ?? "–"}
                  </td>
                  <td className="py-2 pr-3 text-xs text-ink/60">
                    {fmtDate(m.modified_at)} · {fmtBytes(m.bytes)}
                  </td>
                  <td className="py-2 text-right">
                    {!m.active &&
                      (m.compatible === false || m.file_missing ? (
                        <span className="text-xs text-ink/45" title={m.file_missing ? "ไม่พบไฟล์โมเดลในเครื่องเซิร์ฟเวอร์" : "เทรนด้วยรูปแบบข้อมูลเก่า ต้องเทรนใหม่"}>
                          {m.file_missing ? "ไม่มีไฟล์" : "รูปแบบเก่า ใช้ไม่ได้"}
                        </span>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => onActivate(m)}>
                          ใช้เวอร์ชันนี้
                        </Button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
