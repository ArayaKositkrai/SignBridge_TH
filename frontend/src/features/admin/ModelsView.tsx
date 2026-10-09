import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import Icon from "../../components/ui/Icon";
import { HintIcon } from "../../components/ui/Tooltip";
import SearchInput from "../../components/ui/SearchInput";
import Switch from "../../components/ui/Switch";
import { logEvent } from "../../lib/activityLog";
import { fmtBytes, fmtDate } from "../../lib/format";
import DataTable, { type Column } from "./components/DataTable";
import ModelMetrics from "./components/ModelMetrics";
import PageHeader from "./components/PageHeader";
import SubTabs from "./components/SubTabs";
import Toolbar, { FilterSelect } from "./components/Toolbar";
import {
  getTestSplit,
  deleteModel,
  getTrainStatus,
  runModelTest,
  startTraining,
  getVocabulary,
  listModels,
  publishModel,
  setActiveModel,
  setTestSplit,
  type ModelFile,
  type SplitSigner,
  type TestSplit,
  type TrainProgress,
  type TrainStatus,
  type VocabItem,
} from "./services/adminApi";

// แท็บย่อยของหน้าโมเดล
type Tab = "overview" | "train" | "split" | "history";

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

// หน้าโมเดล: ปุ่มลองใช้/เผยแพร่ Draft ด้านบน แล้วแบ่งแท็บ ภาพรวม · การเทรน · ชุดทดสอบ · ประวัติเวอร์ชัน
export default function ModelsView() {
  const [tab, setTab] = useState<Tab>("overview");
  const [models, setModels] = useState<ModelFile[]>([]);
  const [status, setStatus] = useState<TrainStatus | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<
    { kind: "publish" } | { kind: "activate"; model: ModelFile } | { kind: "delete"; model: ModelFile } | null
  >(null);
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

  // โหลดตอนเปิดหน้า แล้วถามสถานะทุก 3 วินาทีขณะเทรน/วัดผล (ไม่ได้เทรน 15 วินาที เผื่อมีคนเริ่มเทรนจากเครื่อง)
  const running = status?.status === "running";
  const evaluating = status?.evaluation?.status === "running";
  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);
  useEffect(() => {
    void refreshStatus();
    const id = window.setInterval(() => void refreshStatus(), running || evaluating ? 3000 : 15000);
    return () => window.clearInterval(id);
  }, [running, evaluating, refreshStatus]);

  // Run Test เสร็จ: โหลดรายการโมเดลใหม่ (ผล Run Test ในตาราง) และแจ้งผล
  const toast = useToast();
  const prevEval = useRef(status?.evaluation?.status);
  useEffect(() => {
    const now = status?.evaluation?.status;
    if (prevEval.current === "running" && (now === "succeeded" || now === "failed")) {
      void refreshModels();
      if (now === "succeeded") toast.success("Run Test เสร็จแล้ว");
      else toast.error("Run Test ไม่สำเร็จ: " + (status?.evaluation?.log.slice(-1)[0] ?? "ดู log"));
    }
    prevEval.current = now;
  }, [status, refreshModels, toast]);

  // สั่ง Run Test ทุกเวอร์ชัน
  const [runBusy, setRunBusy] = useState(false);
  const runTest = async () => {
    setRunBusy(true);
    try {
      toast.info((await runModelTest()).message);
      await refreshStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "เริ่ม Run Test ไม่สำเร็จ");
    } finally {
      setRunBusy(false);
    }
  };

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
      if (confirm.kind === "delete") {
        await deleteModel(confirm.model.version);
        setMessage({ ok: true, text: `ลบโมเดล ${confirm.model.label} แล้ว` });
      } else {
        const r = confirm.kind === "publish" ? await publishModel() : await setActiveModel(confirm.model.version);
        setMessage({ ok: true, text: r.message });
      }
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
    <>
      <PageHeader
        title="โมเดล"
        description="เทียบโมเดลที่ใช้อยู่กับ Draft ตัวใหม่ เทรน เลือกชุดทดสอบ และย้อนเวอร์ชัน"
        actions={
          <>
            <Button
              variant="ghost"
              icon="play"
              disabled={!draft}
              onClick={() => {
                logEvent("ทดสอบโมเดล Draft", draft?.label);
                window.open("/?version=draft", "_blank");
              }}
            >
              ลองใช้ Draft
            </Button>
            <Button icon="check" disabled={!draft || busy || running} onClick={() => setConfirm({ kind: "publish" })}>
              เผยแพร่ Draft
            </Button>
          </>
        }
      />
      {message && (
        <p
          className={`mb-4 rounded-xl px-4 py-2 text-sm ${
            message.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300" : "bg-danger/10 text-danger"
          }`}
        >
          {message.text}
        </p>
      )}
      <SubTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "overview", label: "ภาพรวม" },
          { value: "train", label: "การเทรน", badge: running ? "กำลังเทรน" : undefined },
          { value: "split", label: "ชุดทดสอบ" },
          { value: "history", label: "ประวัติเวอร์ชัน", badge: models.length },
        ]}
      />

      {tab === "overview" && (
        <>
          <ModelMetrics models={models} status={status} onRunTest={() => void runTest()} runBusy={runBusy} />
          <Overview active={active} draft={draft} />
        </>
      )}
      {tab === "train" && <Training status={status} onStarted={() => void refreshStatus()} />}
      {tab === "split" && <SplitTab />}
      {tab === "history" && (
        <History
          models={models}
          onActivate={(m) => setConfirm({ kind: "activate", model: m })}
          onDelete={(m) => setConfirm({ kind: "delete", model: m })}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === "publish" ? "เผยแพร่โมเดล Draft" : confirm?.kind === "delete" ? "ลบโมเดล" : "เปลี่ยนเวอร์ชันที่ใช้"}
        busy={busy}
        danger={confirm?.kind === "delete"}
        confirmLabel={confirm?.kind === "publish" ? "เผยแพร่" : confirm?.kind === "delete" ? "ลบโมเดล" : "ใช้เวอร์ชันนี้"}
        onClose={() => setConfirm(null)}
        onConfirm={() => void doConfirm()}
      >
        {confirm?.kind === "publish" ? (
          <>
            ผู้ใช้ทุกคนจะใช้ <b>{draft?.label}</b> แปลภาษามือทันที (ทายถูก {pct(draft?.val_accuracy)} เทียบกับตัวเดิม {pct(active?.val_accuracy)})
            · ย้อนกลับได้ที่แท็บประวัติเวอร์ชัน
          </>
        ) : (
          confirm?.kind === "activate" ? (
            <>
              เปลี่ยนโมเดลที่ใช้แปลภาษามือเป็น <b>{confirm.model.label}</b> ใช่ไหม?
            </>
          ) : (
            confirm?.kind === "delete" && (
              <>
                ลบโมเดล <b>{confirm.model.label}</b>
                {confirm.model.draft && " (Draft)"} ออกจากระบบ ใช่ไหม?
                <p className="mt-2 text-ink/60">
                  ข้อมูลโมเดลและผลรายคำจะหายจากหน้านี้ ไฟล์ใน Storage ถูกย้ายไปเก็บที่ models/deleted/ (กู้คืนได้โดยผู้ดูแล)
                </p>
              </>
            )
          )
        )}
      </ConfirmDialog>
    </>
  );
}

// การ์ดโมเดลหนึ่งตัว (ใช้งานอยู่ / Draft) ขนาดเท่ากัน: ความแม่นยำ ติด 3 อันดับ จำนวนคำ/คลิป วันที่เทรน
function ModelCard({ title, model, compare, empty, highlight }: { title: string; model: ModelFile | null; compare?: ModelFile | null; empty: string; highlight?: boolean }) {
  const diff = model?.val_accuracy != null && compare?.val_accuracy != null ? model.val_accuracy - compare.val_accuracy : null;
  return (
    <section className={`flex h-full flex-col rounded-2xl bg-surface/80 p-5 ring-1 ${highlight ? "ring-2 ring-emerald-400/60" : "ring-sky"}`}>
      <header className="flex items-center justify-between">
        <span className="text-sm font-semibold text-ink/60">{title}</span>
        {model && <span className="text-lg font-bold text-navy">{model.label}</span>}
      </header>
      {model ? (
        <>
          <div className="mt-2 flex flex-wrap items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums text-navy">{pct(model.val_accuracy)}</span>
            <span className="text-sm text-ink/55">ทายถูกกับผู้แสดงที่ไม่เคยเห็น</span>
            {diff != null && (
              <span className={`text-sm font-semibold ${diff >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-danger"}`}>
                {diff >= 0 ? "▲" : "▼"} {Math.abs(Math.round(diff * 100))}%
              </span>
            )}
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-sky/60 pt-3 text-sm">
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
          <p className="mt-auto pt-3 text-xs text-ink/45">เทรนเมื่อ {fmtDate(model.modified_at)}</p>
        </>
      ) : (
        <p className="grid flex-1 place-items-center py-8 text-center text-sm text-ink/50">{empty}</p>
      )}
    </section>
  );
}

// แถวเทียบความแม่นยำรายคำ
interface WordRow {
  word: string;
  active: number | null;
  draft: number | null;
  inActive: boolean;
  inDraft: boolean;
}

// ป้ายความแม่นยำ (เขียว ≥70 / เหลือง ≥40 / แดง)
function AccBadge({ v, included }: { v: number | null; included: boolean }) {
  if (!included) return <span className="text-ink/30">–</span>;
  if (v == null) return <span className="text-xs text-ink/45">ไม่ได้วัด</span>;
  return <Badge tone={v >= 0.7 ? "success" : v >= 0.4 ? "warning" : "danger"}>{Math.round(v * 100)}%</Badge>;
}

// แท็บภาพรวม: การ์ดใช้งานอยู่ vs Draft และตารางเทียบความแม่นยำรายคำ
function Overview({ active, draft }: { active: ModelFile | null; draft: ModelFile | null }) {
  const [items, setItems] = useState<VocabItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  // โหลดผลรายคำของทั้งสองเวอร์ชัน (จากคลังคำ)
  useEffect(() => {
    getVocabulary()
      .then((v) => setItems(v.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [active?.version, draft?.version]);

  const rows: WordRow[] = useMemo(
    () =>
      items
        .filter((v) => (v.in_active_model || v.in_draft_model) && (!q.trim() || v.word.includes(q.trim())))
        .map((v) => ({
          word: v.word,
          active: v.model?.active.accuracy ?? null,
          draft: v.model?.draft.accuracy ?? null,
          inActive: v.in_active_model,
          inDraft: v.in_draft_model,
        })),
    [items, q],
  );

  const columns: Column<WordRow>[] = [
    { key: "word", header: "คำ", sort: (r) => r.word, cell: (r) => <span className="font-semibold text-navy">{r.word}</span> },
    {
      key: "active",
      header: `ใช้งานอยู่ ${active?.label ?? ""}`,
      align: "center",
      sort: (r) => r.active,
      cell: (r) => <AccBadge v={r.active} included={r.inActive} />,
    },
    ...(draft
      ? [
          {
            key: "draft",
            header: `Draft ${draft.label}`,
            align: "center" as const,
            sort: (r: WordRow) => r.draft,
            cell: (r: WordRow) => <AccBadge v={r.draft} included={r.inDraft} />,
          },
          {
            key: "diff",
            header: "เปลี่ยนแปลง",
            align: "center" as const,
            sort: (r: WordRow) => (r.active != null && r.draft != null ? r.draft - r.active : null),
            cell: (r: WordRow) => {
              if (r.active == null || r.draft == null) return <span className="text-ink/30">–</span>;
              const d = Math.round((r.draft - r.active) * 100);
              return (
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    d > 0 ? "text-emerald-600 dark:text-emerald-400" : d < 0 ? "text-danger" : "text-ink/45"
                  }`}
                >
                  {d > 0 ? `+${d}` : d}%
                </span>
              );
            },
          },
        ]
      : []),
  ];

  return (
    <>
      <div className="mb-5 grid gap-4 md:grid-cols-2">
        <ModelCard title="ใช้งานอยู่" model={active} empty="ยังไม่มีโมเดลที่ใช้งาน" highlight />
        <ModelCard title="Draft (รอทดสอบ)" model={draft} compare={active} empty='ยังไม่มี Draft — เทรนใหม่ได้ที่แท็บ "การเทรน"' />
      </div>
      <h2 className="mb-2 text-base font-bold text-navy">ความแม่นยำรายคำ</h2>
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="ค้นหาคำ" className="min-w-[220px] flex-1" />
      </Toolbar>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.word}
        loading={loading}
        initialSort={{ key: draft ? "diff" : "active", dir: "asc" }}
        empty="ยังไม่มีคำในโมเดล"
      />
    </>
  );
}

// แท็บการเทรน: ปุ่มเริ่มเทรน ขั้นตอน คำสั่ง ความคืบหน้า และ log
function Training({ status, onStarted }: { status: TrainStatus | null; onStarted: () => void }) {
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const toast = useToast();
  const busyRun = status?.status === "running";
  const canTrain = status?.can_train_here ?? false;

  // สั่งเทรนจากหน้าเว็บ (รอเช็กว่าสคริปต์เริ่มได้ ~4 วินาที)
  const start = async () => {
    setStarting(true);
    try {
      const r = await startTraining();
      toast.success(r.message);
      onStarted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "เริ่มเทรนไม่สำเร็จ");
    } finally {
      setStarting(false);
    }
  };
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

  const steps = [
    { title: "เลือกคำ", text: 'เปิดสวิตช์ "เทรน" ของคำที่ต้องการในหน้าคลังคำศัพท์' },
    { title: "เลือกชุดทดสอบ", text: 'แท็บ "ชุดทดสอบ" (ไม่เลือก = สุ่มให้เอง)' },
    { title: "เริ่มเทรน", text: 'กดปุ่ม "เริ่มเทรน" ด้านล่าง หรือรันคำสั่งบนเครื่องที่มี torch (~1 นาที)' },
    { title: "ลองใช้แล้วเผยแพร่", text: 'ได้ Draft แล้วกด "ลองใช้ Draft" ด้านบน ถ้าดีกว่าค่อยเผยแพร่' },
  ];

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <section className="rounded-2xl bg-surface/80 p-5 ring-1 ring-sky">
        <h2 className="mb-3 text-base font-bold text-navy">ขั้นตอน</h2>
        <ol className="flex flex-col gap-3">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/15 text-sm font-bold text-brand">{i + 1}</span>
              <span>
                <span className="block text-sm font-semibold text-navy">{s.title}</span>
                <span className="block text-xs text-ink/60">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-4">
          <Button icon="play" className="w-full" onClick={() => void start()} disabled={!status || !canTrain || busyRun || starting}>
            {starting ? "กำลังเริ่ม…" : busyRun ? "กำลังเทรนอยู่" : "เริ่มเทรน"}
          </Button>
          {status && !canTrain && (
            <p className="mt-2 text-xs text-ink/60">เครื่องเซิร์ฟเวอร์ไม่มี torch จึงเทรนจากหน้าเว็บไม่ได้ ให้รันคำสั่งด้านล่างบนเครื่องที่มี torch แทน</p>
          )}
        </div>
        {status && (
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-deep px-3 py-2 font-mono text-xs text-white">{status.command}</code>
            <Button size="sm" variant="ghost" icon={copied ? "check" : "text"} onClick={() => void copy()}>
              {copied ? "คัดลอกแล้ว" : "คัดลอก"}
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-surface/80 p-5 ring-1 ring-sky">
        <header className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-navy">การเทรนล่าสุด</h2>
          <Badge tone={st.tone}>{st.label}</Badge>
        </header>
        {!r ? (
          <p className="py-6 text-center text-sm text-ink/50">ยังไม่เคยเทรน</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-ink/55">เริ่ม</dt>
                <dd className="font-semibold text-navy">{r.started_at ? fmtDate(r.started_at) : "–"}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink/55">เครื่อง</dt>
                <dd className="truncate font-semibold text-navy" title={r.host ?? ""}>
                  {r.host ?? "–"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink/55">ทายถูก</dt>
                <dd className="font-semibold text-navy">{pct(prog.val_accuracy)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink/55">ได้โมเดล</dt>
                <dd className="font-semibold text-navy">{r.model ? r.model.replace(/^model_signBridge_|\.npz$/g, "") : "–"}</dd>
              </div>
            </dl>
            {(status?.status === "running" || status?.status === "stalled") && (
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs text-ink/60">
                  <span>
                    {STAGES[prog.stage ?? "load"].label}
                    {prog.epoch && prog.epochs ? ` · รอบ ${prog.epoch}/${prog.epochs}` : ""}
                  </span>
                  <span className="font-semibold text-navy">{Math.round(fraction * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-sky/50">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand to-royal transition-[width] duration-700"
                    style={{ width: `${fraction * 100}%` }}
                  />
                </div>
                {status?.status === "stalled" && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">เครื่องที่เทรนเงียบไปเกิน 2 นาที อาจถูกปิดหรือหลุดการเชื่อมต่อ</p>
                )}
              </div>
            )}
            {r.error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{r.error}</p>}
            {r.log.length > 0 && (
              <>
                <h3 className="mb-1 mt-4 text-xs font-semibold text-ink/55">log การเทรน</h3>
                <pre className="scrollbar-thin max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-deep p-3 font-mono text-[11px] leading-relaxed text-white/85">
                  {r.log.join("\n")}
                </pre>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// แท็บชุดทดสอบ: ตารางผู้แสดงทุกคน เปิดสวิตช์เพื่อกันไว้ทดสอบ (ไม่เลือกเลย = สุ่ม 20%)
function SplitTab() {
  const [data, setData] = useState<TestSplit | null>(null);
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
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
  const sources = useMemo(() => [...new Set(data?.signers.map((s) => s.source) ?? [])], [data]);
  const rows = useMemo(
    () =>
      (data?.signers ?? []).filter(
        (s) => (!source || s.source === source) && (!q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase())),
      ),
    [data, q, source],
  );
  const testClips = data?.signers.filter((s) => s.test).reduce((n, s) => n + s.clips, 0) ?? 0;
  const allClips = data?.signers.reduce((n, s) => n + s.clips, 0) ?? 0;
  // ชื่อชุดข้อมูลที่อ่านง่าย
  const sourceLabel = (s: string) => (s === "ล่าม" ? "ทีม (อัดผ่านระบบ)" : s);

  const columns: Column<SplitSigner>[] = [
    { key: "name", header: "ผู้แสดง", sort: (s) => s.name, cell: (s) => <span className="font-semibold text-navy">{s.name}</span> },
    { key: "source", header: "ชุดข้อมูล", sort: (s) => s.source, cell: (s) => <span className="text-ink/65">{sourceLabel(s.source)}</span> },
    { key: "clips", header: "คลิป", align: "right", sort: (s) => s.clips, cell: (s) => <span className="tabular-nums">{s.clips}</span> },
    { key: "words", header: "คำ", align: "right", hideBelow: "sm", sort: (s) => s.words, cell: (s) => <span className="tabular-nums">{s.words}</span> },
    {
      key: "test",
      header: "ใช้เป็นชุดทดสอบ",
      align: "center",
      sort: (s) => (s.test ? 1 : 0),
      cell: (s) => <Switch checked={s.test} disabled={busy} onChange={(on) => toggle(s.id, on)} label={`ใช้ ${s.name} เป็นชุดทดสอบ`} size="sm" />,
    },
  ];

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-surface/80 px-4 py-3 ring-1 ring-sky">
          <span className="block text-xs text-ink/55">วิธีเลือก</span>
          <span className="mt-1 block text-lg font-bold text-navy">
            {data?.mode === "manual" ? `เลือกเอง ${selected.length} คน` : "สุ่มอัตโนมัติ 20%"}
          </span>
        </div>
        <div className="rounded-2xl bg-surface/80 px-4 py-3 ring-1 ring-sky">
          <span className="block text-xs text-ink/55">คลิปในชุดทดสอบ</span>
          <span className="mt-1 block text-lg font-bold text-navy">
            {selected.length ? `${testClips.toLocaleString("th-TH")} (${allClips ? Math.round((testClips / allClips) * 100) : 0}%)` : "–"}
            {data && data.recorded_test_clips > 0 && (
              <span className="ml-1 text-xs font-normal text-ink/55">+ เลือกรายคลิป {data.recorded_test_clips}</span>
            )}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-2xl bg-surface/80 px-4 py-3 ring-1 ring-sky">
          <span className="text-xs text-ink/60">ชุดทดสอบใช้วัดผลเท่านั้น โมเดลจริงยังเทรนด้วยข้อมูลทุกคน</span>
          {selected.length > 0 && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save([])}>
              สุ่มอัตโนมัติ
            </Button>
          )}
        </div>
      </div>
      {data && data.words_without_test.length > 0 && (
        <p className="mb-3 flex gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">
          <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
          คำที่ไม่มีคลิปทดสอบ (วัดความแม่นยำคำนี้ไม่ได้): {data.words_without_test.join(", ")}
        </p>
      )}
      {data && data.words_without_train.length > 0 && (
        <p className="mb-3 flex gap-2 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">
          <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
          คำที่ทุกคลิปอยู่ในชุดทดสอบ (ไม่เหลือให้เทรน): {data.words_without_train.join(", ")}
        </p>
      )}
      {error && <p className="mb-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="ค้นหาผู้แสดง" className="min-w-[220px] flex-1" />
        <FilterSelect
          label="ชุดข้อมูล"
          value={source}
          onChange={setSource}
          options={[{ value: "", label: "ทุกชุดข้อมูล" }, ...sources.map((s) => ({ value: s, label: sourceLabel(s) }))]}
        />
      </Toolbar>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(s) => s.id}
        loading={!data && !error}
        initialSort={{ key: "source", dir: "asc" }}
        empty="ไม่พบผู้แสดง"
      />
    </>
  );
}

// แท็บประวัติเวอร์ชัน: ทุกเวอร์ชันพร้อมปุ่มย้อนไปใช้เวอร์ชันเก่า (รูปแบบเก่า/ไม่มีไฟล์ = ใช้ไม่ได้)
function History({
  models,
  onActivate,
  onDelete,
}: {
  models: ModelFile[];
  onActivate: (m: ModelFile) => void;
  onDelete: (m: ModelFile) => void;
}) {
  const columns: Column<ModelFile>[] = [
    {
      key: "label",
      header: "เวอร์ชัน",
      sort: (m) => m.modified_at,
      cell: (m) => (
        <span className="flex items-center gap-2">
          <span className="font-semibold text-navy">{m.label}</span>
          {m.active && <Badge tone="success">ใช้งานอยู่</Badge>}
          {m.draft && <Badge tone="warning">Draft</Badge>}
        </span>
      ),
    },
    { key: "acc", header: "ทายถูก", align: "right", sort: (m) => m.val_accuracy, cell: (m) => <span className="tabular-nums">{pct(m.val_accuracy)}</span> },
    {
      key: "f1",
      header: "F1",
      align: "right",
      hideBelow: "sm",
      sort: (m) => m.validation?.f1,
      cell: (m) => <span className="tabular-nums text-ink/65">{pct(m.validation?.f1)}</span>,
    },
    {
      key: "test",
      header: "Run Test",
      align: "right",
      sort: (m) => m.test?.accuracy,
      cell: (m) =>
        m.test?.accuracy == null ? (
          <span className="text-ink/30">–</span>
        ) : (
          <span className="inline-flex items-center gap-1 tabular-nums">
            {pct(m.test.accuracy)}
            {m.test.seen_test && <HintIcon text="เวอร์ชันนี้เคยเห็นชุดทดสอบตอนเทรน ผล Run Test สูงเกินจริง" />}
          </span>
        ),
    },
    {
      key: "top3",
      header: "ติด 3 อันดับ",
      align: "right",
      hideBelow: "sm",
      sort: (m) => m.val_top3,
      cell: (m) => <span className="tabular-nums text-ink/65">{pct(m.val_top3)}</span>,
    },
    { key: "words", header: "คำ", align: "right", hideBelow: "md", sort: (m) => m.words, cell: (m) => <span className="tabular-nums">{m.words ?? "–"}</span> },
    { key: "samples", header: "คลิป", align: "right", hideBelow: "md", sort: (m) => m.samples, cell: (m) => <span className="tabular-nums">{m.samples ?? "–"}</span> },
    {
      key: "date",
      header: "เทรนเมื่อ",
      hideBelow: "lg",
      sort: (m) => m.modified_at,
      cell: (m) => (
        <span className="text-xs text-ink/60">
          {fmtDate(m.modified_at)} · {fmtBytes(m.bytes)}
        </span>
      ),
    },
    {
      key: "act",
      header: <span className="sr-only">ใช้งาน</span>,
      align: "right",
      cell: (m) => (
        <span className="inline-flex items-center justify-end gap-1">
          {m.active ? null : m.compatible === false || m.file_missing ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink/50">
              {m.file_missing ? "ไม่มีไฟล์" : "รูปแบบเก่า"}
              <HintIcon
                text={
                  m.file_missing
                    ? "ไม่พบไฟล์โมเดลนี้ทั้งในเครื่องเซิร์ฟเวอร์และใน Storage จึงเปิดใช้ไม่ได้ (ให้คนที่เทรนรัน upload_models)"
                    : "โมเดลนี้เทรนด้วยรูปแบบข้อมูลเก่า ใช้กับตัวแปลปัจจุบันไม่ได้ ต้องเทรนใหม่"
                }
              />
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => onActivate(m)}>
              ใช้เวอร์ชันนี้
            </Button>
          )}
          {/* ลบได้ทุกเวอร์ชันยกเว้นตัวที่ใช้งานอยู่ */}
          {!m.active && (
            <button
              type="button"
              onClick={() => onDelete(m)}
              className="grid h-8 w-8 place-items-center rounded-lg text-danger transition hover:bg-danger/10"
              aria-label={`ลบโมเดล ${m.label}`}
              title="ลบโมเดล"
            >
              <Icon name="trash" size={15} />
            </button>
          )}
        </span>
      ),
    },
  ];
  return <DataTable rows={models} columns={columns} rowKey={(m) => m.version} initialSort={{ key: "label", dir: "desc" }} empty="ยังไม่มีโมเดล" />;
}
