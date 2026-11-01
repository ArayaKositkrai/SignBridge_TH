import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import Dialog from "../../components/ui/Dialog";
import Field from "../../components/ui/Field";
import Icon from "../../components/ui/Icon";
import Modal from "../../components/ui/Modal";
import SearchInput from "../../components/ui/SearchInput";
import Switch from "../../components/ui/Switch";
import { useToast } from "../../components/ui/Toast";
import { HintIcon } from "../../components/ui/Tooltip";
import { fmtDate } from "../../lib/format";
import { listSamples, type ModelsBrief, type SampleMeta } from "../contributor/services/contributorApi";
import DataTable, { type Column } from "./components/DataTable";
import PageHeader from "./components/PageHeader";
import StatCards, { type Stat } from "./components/StatCards";
import Toolbar, { FilterSelect } from "./components/Toolbar";
import {
  addWord,
  buildMotions,
  getMotionBuild,
  getVocabulary,
  setSampleSplit,
  setTrainWord,
  setTrainWords,
  type MotionBuild,
  type VocabItem,
} from "./services/adminApi";

// จำนวนคลิปที่ล่ามอัดขั้นต่ำต่อคำ ที่ train.py นำไปเทรน (ตรงกับ min_recorded_clips ใน ml/configs/train_words.json)
const MIN_RECORDED_CLIPS = 5;

// จำนวนคลิปในชุด TSL ของคำ (รวมทุกชุดข้อมูล)
const tslClips = (v: VocabItem) => Object.values(v.external ?? {}).reduce((n, e) => n + e.clips, 0);
// คำนี้มีข้อมูลพอเทรนไหม: มีคลิปในชุด TSL หรือล่ามอัดครบจำนวนขั้นต่ำ
const trainable = (v: VocabItem) => tslClips(v) > 0 || (v.data?.samples ?? 0) >= MIN_RECORDED_CLIPS;

// ตัวกรองคลังคำศัพท์ (การ์ดตัวเลขและ dropdown ใช้ชุดเดียวกัน)
const FILTERS: { value: string; label: string; test: (v: VocabItem) => boolean }[] = [
  { value: "all", label: "ทุกคำ", test: () => true },
  { value: "train", label: "เลือกไว้เทรน", test: (v) => v.in_train_set },
  { value: "in_model", label: "โมเดลรู้จักแล้ว", test: (v) => v.in_active_model },
  { value: "weak", label: "ทายพลาดบ่อย (<70%)", test: (v) => v.in_active_model && (v.model?.active.accuracy ?? 1) < 0.7 },
  { value: "to_record", label: "ต้องอัดเพิ่ม", test: (v) => v.to_record },
  { value: "no_data", label: "ยังไม่มีคลิปเลย", test: (v) => !v.data?.samples && tslClips(v) === 0 },
  { value: "no_avatar", label: "อวตารยังทำท่าไม่ได้", test: (v) => !v.avatar?.has_motion },
];

// ความแม่นยำของคำในโมเดล: ป้ายสี (เขียว ≥70 / เหลือง ≥40 / แดง) หรือขีด ถ้าไม่อยู่ในโมเดล
function Accuracy({ included, accuracy }: { included: boolean; accuracy: number | null | undefined }) {
  if (!included) return <span className="text-ink/30">–</span>;
  if (accuracy == null) return <span className="text-xs text-ink/50">ไม่ได้วัด</span>;
  const tone = accuracy >= 0.7 ? "success" : accuracy >= 0.4 ? "warning" : "danger";
  return <Badge tone={tone}>{Math.round(accuracy * 100)}%</Badge>;
}

// ตัวเลขจำนวนคลิป (ศูนย์ = สีจาง)
function Num({ n }: { n: number }) {
  return <span className={`tabular-nums ${n ? "text-ink" : "text-ink/30"}`}>{n.toLocaleString("th-TH")}</span>;
}

// หน้าคลังคำศัพท์: ตัวเลขสรุป (กดกรองได้) ค้นหา/หมวด ตารางเรียงได้ เลือกคำไว้เทรน และเพิ่มคำใหม่ (คลิกคำเพื่อดูคลิป)
export default function VocabularyView() {
  const [vocab, setVocab] = useState<VocabItem[]>([]);
  const [brief, setBrief] = useState<ModelsBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("");
  const [open, setOpen] = useState<VocabItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  // งานเลือก/ยกเลิกเทรนหลายคำที่รอยืนยัน
  const [bulk, setBulk] = useState<{ next: boolean; words: string[]; skipped: number } | null>(null);
  // การสร้างท่าอวตาร (null = ยังไม่ได้สั่งในรอบนี้)
  const [motion, setMotion] = useState<MotionBuild | null>(null);
  const toast = useToast();
  const navigate = useNavigate();

  // โหลดคลังคำ
  const refresh = useCallback(async () => {
    try {
      const v = await getVocabulary();
      setVocab(v.items);
      setBrief(v.models);
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดคลังคำไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  // โหลดตอนเปิดหน้า (และดูว่ามีการสร้างท่าอวตารค้างอยู่ไหม)
  useEffect(() => {
    void refresh();
    getMotionBuild()
      .then((s) => s.status === "running" && setMotion(s))
      .catch(() => undefined);
  }, [refresh]);

  // ระหว่างสร้างท่าอวตาร: ถามสถานะทุก 3 วินาที เสร็จแล้วโหลดคลังคำใหม่
  const motionRunning = motion?.status === "running";
  useEffect(() => {
    if (!motionRunning) return;
    const id = window.setInterval(() => {
      getMotionBuild()
        .then((s) => {
          setMotion(s);
          if (s.status === "succeeded") {
            toast.success("สร้างท่าอวตารเสร็จแล้ว");
            void refresh();
          } else if (s.status === "failed") toast.error("สร้างท่าอวตารไม่สำเร็จ ดูรายละเอียดในแถบด้านบน");
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(id);
  }, [motionRunning, refresh, toast]);

  // สั่งสร้างท่าอวตารจาก skeleton จริง
  const startMotions = async () => {
    try {
      const r = await buildMotions();
      setMotion({ status: "running", log: [] });
      toast.info(r.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "สั่งสร้างท่าอวตารไม่สำเร็จ");
    }
  };
  const motionSummary = motion?.log.filter((l) => l.startsWith("สร้างท่า") || l.startsWith("ไม่มีข้อมูลจริง")) ?? [];

  // สลับเลือกคำไว้เทรน (อัปเดตหน้าจอทันที ถ้าบันทึกไม่สำเร็จค่อยคืนค่าเดิม)
  const toggleTrain = async (v: VocabItem, next: boolean) => {
    setVocab((list) => list.map((x) => (x.word === v.word ? { ...x, in_train_set: next } : x)));
    try {
      await setTrainWord(v.word, next);
      toast.success(next ? `เลือก "${v.word}" ไว้เทรนแล้ว` : `เลิกเลือก "${v.word}" แล้ว`);
    } catch (e) {
      setVocab((list) => list.map((x) => (x.word === v.word ? { ...x, in_train_set: !next } : x)));
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    }
  };

  // เลือก/ยกเลิกเทรนทุกคำที่แสดงอยู่ (ตามคำค้น หมวด และตัวกรอง) → เปิดกล่องยืนยันก่อน
  //   ตอนเลือก: เอาเฉพาะคำที่มีข้อมูลพอเทรน (มีคลิป TSL หรือล่ามอัดครบ) คำที่ไม่มีข้อมูลเลือกไปก็ไม่ถูกเทรน
  const askBulkTrain = (next: boolean) => {
    const words = rows.filter((v) => v.in_train_set !== next && (!next || trainable(v))).map((v) => v.word);
    const skipped = next ? rows.filter((v) => !v.in_train_set && !trainable(v)).length : 0;
    if (!words.length) {
      toast.info(next ? "คำที่แสดงอยู่ถูกเลือกไว้เทรนครบแล้ว (หรือยังไม่มีข้อมูลพอเทรน)" : "ไม่มีคำที่เลือกไว้เทรนในรายการนี้");
      return;
    }
    setBulk({ next, words, skipped });
  };

  // บันทึกหลังกดยืนยัน (อัปเดตหน้าจอทันที ถ้าบันทึกไม่สำเร็จค่อยคืนค่าเดิม)
  const runBulkTrain = async () => {
    if (!bulk) return;
    const { next, words } = bulk;
    const set = new Set(words);
    setBulkBusy(true);
    setVocab((list) => list.map((x) => (set.has(x.word) ? { ...x, in_train_set: next } : x)));
    try {
      await setTrainWords(words, next);
      toast.success(next ? `เลือก ${words.length} คำไว้เทรนแล้ว มีผลเมื่อเทรนครั้งถัดไป` : `ยกเลิกการเทรน ${words.length} คำแล้ว`);
    } catch (e) {
      setVocab((list) => list.map((x) => (set.has(x.word) ? { ...x, in_train_set: !next } : x)));
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBulkBusy(false);
      setBulk(null);
    }
  };

  const categories = useMemo(() => [...new Set(vocab.map((v) => v.category).filter(Boolean) as string[])].sort(), [vocab]);
  const sources = useMemo(() => [...new Set(vocab.flatMap((v) => v.sources ?? []))].sort(), [vocab]);
  const rows = useMemo(() => {
    const test = FILTERS.find((f) => f.value === filter)!.test;
    const needle = q.trim();
    return vocab.filter(
      (v) => test(v) && (!category || v.category === category) && (!source || (v.sources ?? []).includes(source)) && (!needle || v.word.includes(needle)),
    );
  }, [vocab, filter, category, source, q]);
  // จำนวนคำของตัวกรอง
  const count = (f: string) => vocab.filter(FILTERS.find((x) => x.value === f)!.test).length;
  const hasDraft = !!brief?.draft.label;

  const stats: Stat[] = [
    { label: "คำทั้งหมด", value: vocab.length, filter: "all" },
    { label: "เลือกไว้เทรน", value: count("train"), filter: "train", hint: "มีผลเมื่อเทรนครั้งถัดไป" },
    { label: "โมเดลรู้จักแล้ว", value: count("in_model"), filter: "in_model", hint: brief?.active.label ? `โมเดล ${brief.active.label}` : undefined },
    { label: "ทายพลาดบ่อย (<70%)", value: count("weak"), filter: "weak", tone: count("weak") ? "warning" : "default" },
    { label: "ต้องอัดเพิ่ม", value: count("to_record"), filter: "to_record" },
  ];

  const columns: Column<VocabItem>[] = [
    {
      key: "word",
      header: "คำ",
      sort: (v) => v.word,
      cell: (v) => (
        <span className="font-semibold text-navy">
          {v.word}
          {v.to_record && (
            <Badge tone="warning" className="ml-2">
              ต้องอัด
            </Badge>
          )}
        </span>
      ),
    },
    { key: "category", header: "หมวดหมู่", hideBelow: "md", sort: (v) => v.category, cell: (v) => <span className="text-ink/65">{v.category ?? "–"}</span> },
    {
      key: "source",
      header: "แหล่งที่มา",
      hideBelow: "md",
      sort: (v) => (v.sources ?? []).join(" "),
      cell: (v) =>
        v.sources?.length ? (
          <span className="flex flex-wrap gap-1">
            {v.sources.map((s) => (
              <Badge key={s} tone="neutral">
                {s}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-ink/30">–</span>
        ),
    },
    { key: "rec", header: "คลิปล่าม", align: "right", sort: (v) => v.data?.samples ?? 0, cell: (v) => <Num n={v.data?.samples ?? 0} /> },
    { key: "tsl", header: "คลิป TSL", align: "right", hideBelow: "sm", sort: (v) => tslClips(v), cell: (v) => <Num n={tslClips(v)} /> },
    {
      key: "train",
      header: "เทรน",
      align: "center",
      sort: (v) => (v.in_train_set ? 1 : 0),
      cell: (v) => (
        <span className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Switch checked={v.in_train_set} onChange={(next) => void toggleTrain(v, next)} label={`เลือก ${v.word} ไว้เทรน`} size="sm" />
          {v.in_train_set && !trainable(v) && (
            <HintIcon text={`ยังเทรนคำนี้ไม่ได้: ไม่มีคลิป TSL และคลิปล่ามยังไม่ถึง ${MIN_RECORDED_CLIPS} คลิป (ตอนเทรนจะข้ามคำนี้)`} />
          )}
        </span>
      ),
    },
    {
      key: "acc",
      header: `แม่นยำ${brief?.active.label ? ` (${brief.active.label})` : ""}`,
      align: "center",
      sort: (v) => (v.in_active_model ? v.model?.active.accuracy ?? -1 : null),
      cell: (v) => <Accuracy included={v.in_active_model} accuracy={v.model?.active.accuracy} />,
    },
    ...(hasDraft
      ? [
          {
            key: "draft",
            header: `Draft (${brief?.draft.label})`,
            align: "center" as const,
            hideBelow: "lg" as const,
            sort: (v: VocabItem) => (v.in_draft_model ? v.model?.draft.accuracy ?? -1 : null),
            cell: (v: VocabItem) => <Accuracy included={v.in_draft_model} accuracy={v.model?.draft.accuracy} />,
          },
        ]
      : []),
    {
      key: "avatar",
      header: "ท่าอวตาร",
      align: "center",
      hideBelow: "sm",
      sort: (v) => (v.avatar?.has_motion ? 1 : 0),
      cell: (v) => (v.avatar?.has_motion ? <Badge tone="success">มีท่า</Badge> : <span className="text-xs text-ink/40">ยังไม่มี</span>),
    },
  ];

  return (
    <>
      <PageHeader
        title="คลังคำศัพท์"
        description="คำทั้งหมดในระบบ จำนวนคลิป คำที่จะใช้เทรน และความแม่นยำของโมเดล — คลิกคำเพื่อดูคลิปและเลือกคลิปทดสอบ"
        actions={
          <>
            <Button variant="ghost" icon="hand" onClick={() => void startMotions()} disabled={motionRunning}>
              {motionRunning ? "กำลังสร้างท่าอวตาร…" : "สร้างท่าอวตาร"}
            </Button>
            <HintIcon
              icon="help"
              tone="info"
              wide
              text="สร้างท่าให้อวตาร (หน้า ข้อความ → ภาษามือ) จาก skeleton ของคนทำท่าจริง ทั้งชุด TSL และคลิปที่อัดผ่านระบบ ทำให้ทุกคำที่เลือกเทรนหรือมีคลิป เลือกคลิปที่ดีที่สุดคำละ 1 คลิป ท่าเดิมจะถูกแทนที่ · ข้อจำกัด: ชุด TSL ไม่มีสีหน้า และรูปมือเป็นภาพ 2 มิติ ท่าจึงใกล้เคียงแต่ไม่ละเอียดเท่าคลิปที่อัดผ่านระบบ"
            />
            <Button variant="ghost" icon="plus" onClick={() => setAdding(true)}>
              เพิ่มคำ
            </Button>
            {/* คำที่เปิดสวิตช์ "เทรน" จะถูกใช้ตอนกดเริ่มเทรนในหน้าโมเดล */}
            <Button icon="layers" onClick={() => navigate("/admin/models?tab=train")}>
              ไปเทรนคำที่เลือก ({count("train")})
            </Button>
          </>
        }
      />
      {motion && motion.status !== "idle" && (
        <div
          className={`mb-3 rounded-xl px-4 py-2 text-sm ring-1 ${
            motion.status === "failed"
              ? "bg-danger/10 text-danger ring-danger/20"
              : motion.status === "succeeded"
                ? "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-300"
                : "bg-sky/40 text-ink/80 ring-sky"
          }`}
        >
          {motion.status === "running" && <p>กำลังสร้างท่าอวตารจาก skeleton… {motion.log[motion.log.length - 1] ?? ""}</p>}
          {motion.status === "succeeded" && (motionSummary.length ? motionSummary.map((l) => <p key={l}>{l}</p>) : <p>สร้างท่าอวตารเสร็จแล้ว</p>)}
          {motion.status === "failed" && (
            <>
              <p className="font-semibold">สร้างท่าอวตารไม่สำเร็จ</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs">{motion.log.slice(-8).join("\n")}</pre>
            </>
          )}
        </div>
      )}
      <StatCards stats={stats} active={filter} onSelect={(f) => setFilter(f || "all")} />
      <Toolbar>
        {/* เลือก/ยกเลิกเทรนทุกคำที่แสดงอยู่ (ใช้ร่วมกับคำค้น หมวด และตัวกรองข้างขวา) */}
        <Button variant="soft" size="sm" icon="check" onClick={() => askBulkTrain(true)} disabled={loading || bulkBusy}>
          เลือกเทรนทั้งหมด
        </Button>
        <Button variant="ghost" size="sm" icon="close" onClick={() => askBulkTrain(false)} disabled={loading || bulkBusy}>
          ยกเลิกทั้งหมด
        </Button>
        <SearchInput value={q} onChange={setQ} placeholder="ค้นหาคำ" className="min-w-[220px] flex-1" />
        <FilterSelect
          label="หมวดหมู่"
          value={category}
          onChange={setCategory}
          options={[{ value: "", label: "ทุกหมวดหมู่" }, ...categories.map((c) => ({ value: c, label: c }))]}
        />
        <FilterSelect
          label="แหล่งที่มา"
          value={source}
          onChange={setSource}
          options={[{ value: "", label: "ทุกแหล่งที่มา" }, ...sources.map((s) => ({ value: s, label: s }))]}
        />
        <FilterSelect
          label="ตัวกรอง"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({ value: f.value, label: `${f.label} (${count(f.value)})` }))}
        />
      </Toolbar>
      {error && <p className="mb-3 rounded-xl bg-danger/10 px-4 py-2 text-sm text-danger">{error}</p>}
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(v) => v.word}
        onRowClick={setOpen}
        loading={loading}
        initialSort={{ key: "rec", dir: "desc" }}
        empty="ไม่พบคำตามที่ค้นหา"
      />

      <ConfirmDialog
        open={!!bulk}
        title={bulk?.next ? "เลือกคำไว้เทรน" : "ยกเลิกการเทรน"}
        confirmLabel={bulk?.next ? `เลือก ${bulk.words.length} คำ` : `ยกเลิก ${bulk?.words.length ?? 0} คำ`}
        danger={bulk ? !bulk.next : false}
        busy={bulkBusy}
        onConfirm={() => void runBulkTrain()}
        onClose={() => setBulk(null)}
      >
        {bulk?.next ? (
          <>
            เลือกคำที่แสดงอยู่ <b>{bulk.words.length} คำ</b> ไว้เทรน มีผลเมื่อเทรนครั้งถัดไป
            {bulk.skipped > 0 && <p className="mt-2 text-ink/60">ข้าม {bulk.skipped} คำที่ยังไม่มีข้อมูลพอเทรน</p>}
          </>
        ) : (
          <>
            เอาคำที่แสดงอยู่ <b>{bulk?.words.length ?? 0} คำ</b> ออกจากการเทรน มีผลเมื่อเทรนครั้งถัดไป
          </>
        )}
      </ConfirmDialog>
      <WordDialog item={open} brief={brief} onClose={() => setOpen(null)} onChanged={() => void refresh()} />
      <AddWordDialog
        open={adding}
        categories={categories}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          void refresh();
        }}
      />
    </>
  );
}

// หน้าต่างเพิ่มคำใหม่: คำ หมวด และให้ล่ามอัดไหม
function AddWordDialog({ open, categories, onClose, onAdded }: { open: boolean; categories: string[]; onClose: () => void; onAdded: () => void }) {
  const [word, setWord] = useState("");
  const [category, setCategory] = useState("");
  const [toRecord, setToRecord] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toast = useToast();
  // บันทึกคำใหม่ (คำซ้ำ/ผิดรูปแบบ = แสดงใต้ช่องกรอก)
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!word.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addWord(word.trim(), category.trim(), toRecord);
      toast.success(`เพิ่มคำ "${word.trim()}" แล้ว`);
      setWord("");
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เพิ่มคำไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="เพิ่มคำในคลัง" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <Field label="คำ" value={word} onChange={(e) => setWord(e.target.value)} maxLength={50} autoFocus error={error} />
        <Field label="หมวด (ไม่ใส่ก็ได้)" value={category} onChange={(e) => setCategory(e.target.value)} list="vocab-categories" maxLength={60} />
        <datalist id="vocab-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2 ring-1 ring-sky">
          <span>
            <span className="block text-sm font-semibold text-navy">ให้ล่ามอัดคำนี้</span>
            <span className="block text-xs text-ink/55">คำจะขึ้นในรายการ "ต้องอัด" ของพื้นที่ล่าม</span>
          </span>
          <Switch checked={toRecord} onChange={setToRecord} label="ให้ล่ามอัดคำนี้" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="submit" icon="plus" disabled={busy || !word.trim()}>
            เพิ่มคำ
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// หน้าต่างรายละเอียดคำ (กลางจอ): สถานะในโมเดล ท่าอวตาร และคลิปที่ล่ามอัด (สลับเทรน/ทดสอบรายคลิป)
function WordDialog({ item, brief, onClose, onChanged }: { item: VocabItem | null; brief: ModelsBrief | null; onClose: () => void; onChanged: () => void }) {
  const [samples, setSamples] = useState<SampleMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // โหลดคลิปของคำที่เปิด
  useEffect(() => {
    if (!item) return;
    setSamples(null);
    setError(null);
    listSamples(item.word)
      .then(setSamples)
      .catch((e) => setError(e instanceof Error ? e.message : "โหลดคลิปไม่สำเร็จ"));
  }, [item]);

  const toast = useToast();
  // สลับคลิปเป็นชุดเทรน/ทดสอบ (สวิตช์เปลี่ยนทันที บันทึกไม่สำเร็จค่อยคืนค่าเดิมและแจ้ง)
  const toggleSplit = async (s: SampleMeta) => {
    const next = s.split === "test" ? "train" : "test";
    setSamples((list) => list?.map((x) => (x.id === s.id ? { ...x, split: next } : x)) ?? null);
    try {
      await setSampleSplit(s.id, next);
      toast.success(next === "test" ? "ตั้งคลิปเป็นชุดเทสแล้ว" : "ตั้งคลิปเป็นชุดเทรนแล้ว");
      onChanged();
    } catch (e) {
      setSamples((list) => list?.map((x) => (x.id === s.id ? { ...x, split: s.split } : x)) ?? null);
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    }
  };

  // จัดกลุ่มคลิปตามล่าม
  const bySigner = useMemo(() => {
    const m = new Map<string, SampleMeta[]>();
    for (const s of samples ?? []) {
      const k = s.signer ?? "ไม่ระบุล่าม";
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()];
  }, [samples]);

  const ext = Object.entries(item?.external ?? {});
  return (
    <Dialog open={!!item} title={item?.word ?? ""} subtitle={item ? [item.category, ...(item.sources ?? [])].filter(Boolean).join(" · ") || undefined : undefined} onClose={onClose}>
      {item && (
        <div className="flex flex-col gap-5 text-sm">
          <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <InfoBox label={`โมเดลที่ใช้ ${brief?.active.label ?? ""}`}>
              <Accuracy included={item.in_active_model} accuracy={item.model?.active.accuracy} />
            </InfoBox>
            <InfoBox label={`Draft ${brief?.draft.label ?? ""}`}>
              {brief?.draft.label ? <Accuracy included={item.in_draft_model} accuracy={item.model?.draft.accuracy} /> : <span className="text-ink/40">ไม่มี</span>}
            </InfoBox>
            <InfoBox label="ชุดข้อมูล TSL">{ext.length ? ext.map(([src, e]) => `${src} ${e.clips} คลิป`).join(" · ") : <span className="text-ink/40">ไม่มี</span>}</InfoBox>
            <InfoBox label="ท่าอวตาร">{item.avatar?.has_motion ? <Badge tone="success">มีท่าแล้ว</Badge> : <span className="text-ink/40">ยังไม่มี</span>}</InfoBox>
          </section>

          <section>
            <h3 className="mb-1 font-bold text-navy">คลิปที่ล่ามอัด ({samples?.length ?? "…"})</h3>
            <p className="mb-2 text-xs text-ink/55">
              คลิปของล่ามที่ตั้งเป็นชุดเทส (หน้าผู้ใช้) เป็น <b>ทดสอบ</b> ทั้งหมดอยู่แล้ว · ล่ามคนอื่นสลับเป็นทดสอบทีละคลิปได้ถ้าต้องการ
            </p>
            {error && <p className="mb-2 text-xs text-danger">{error}</p>}
            {samples && samples.length === 0 && <p className="rounded-xl border border-dashed border-sky px-3 py-6 text-center text-ink/50">ยังไม่มีคลิป</p>}
            <div className="flex flex-col gap-3">
              {bySigner.map(([signer, list]) => (
                <div key={signer} className="rounded-xl bg-panel ring-1 ring-sky">
                  <p className="border-b border-sky/60 px-3 py-1.5 text-xs font-semibold text-navy">
                    {signer} · {list.length} คลิป
                  </p>
                  <ul className="divide-y divide-sky/40">
                    {list.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-xs text-ink/70">{s.id}</span>
                          <span className="text-[11px] text-ink/45">
                            {fmtDate(s.created_at)} · {s.frame_count} เฟรม
                          </span>
                        </span>
                        {s.split_by_signer ? (
                          // ล่ามคนนี้เป็นชุดเทส: ทุกคลิปเป็นทดสอบเสมอ (เปลี่ยนที่หน้าผู้ใช้)
                          <span
                            className="shrink-0 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-400/30"
                            title="ล่ามคนนี้ถูกตั้งเป็นชุดเทส ทุกคลิปของเขาจึงเป็นทดสอบ (เปลี่ยนได้ที่ แอดมิน › ผู้ใช้)"
                          >
                            ทดสอบ · ตามล่าม
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void toggleSplit(s)}
                            className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 transition ${
                              s.split === "test"
                                ? "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-400/30"
                                : "bg-surface text-navy ring-sky hover:bg-sky/40"
                            }`}
                            title="คลิกเพื่อสลับ เทรน/ทดสอบ เฉพาะคลิปนี้"
                          >
                            {s.split === "test" ? "ทดสอบ" : "เทรน"}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </Dialog>
  );
}

// ช่องสรุปเล็ก ๆ ในแผงคำ: หัวข้อ + ค่า
function InfoBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-panel px-3 py-2 ring-1 ring-sky">
      <div className="text-[11px] text-ink/55">{label}</div>
      <div className="mt-0.5 font-semibold text-navy">{children}</div>
    </div>
  );
}
