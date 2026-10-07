import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Badge from "../../components/ui/Badge";
import Card from "../../components/ui/Card";
import Drawer from "../../components/ui/Drawer";
import Icon from "../../components/ui/Icon";
import SearchInput from "../../components/ui/SearchInput";
import Switch from "../../components/ui/Switch";
import { fmtDate } from "../../lib/format";
import { listSamples, type ModelsBrief, type SampleMeta } from "../contributor/services/contributorApi";
import { getVocabulary, setSampleSplit, setTrainWord, type VocabItem } from "./services/adminApi";

// จำนวนคลิปที่ล่ามอัดขั้นต่ำต่อคำ ที่ train.py นำไปเทรน (ตรงกับ min_recorded_clips ใน ml/configs/train_words.json)
const MIN_RECORDED_CLIPS = 5;

// จำนวนคลิปในชุด TSL ของคำ (รวมทุกชุดข้อมูล)
const tslClips = (v: VocabItem) => Object.values(v.external ?? {}).reduce((n, e) => n + e.clips, 0);
// คำนี้มีข้อมูลพอเทรนไหม: มีคลิปในชุด TSL หรือล่ามอัดครบจำนวนขั้นต่ำ
const trainable = (v: VocabItem) => tslClips(v) > 0 || (v.data?.samples ?? 0) >= MIN_RECORDED_CLIPS;

// ตัวกรองคลังคำศัพท์
const FILTERS: { value: string; label: string; test: (v: VocabItem) => boolean }[] = [
  { value: "all", label: "ทุกคำ", test: () => true },
  { value: "train", label: "เลือกไว้เทรน", test: (v) => v.in_train_set },
  { value: "in_model", label: "โมเดลรู้จักแล้ว", test: (v) => v.in_active_model },
  { value: "weak", label: "โมเดลทายพลาดบ่อย (<70%)", test: (v) => v.in_active_model && (v.model?.active.accuracy ?? 1) < 0.7 },
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

// หน้าคลังคำศัพท์: ค้นหา กรอง เลือกคำไว้เทรน ดูความแม่นยำ และท่าอวตาร (คลิกคำเพื่อดูคลิปและสลับเทรน/ทดสอบ)
export default function VocabularyView() {
  const [vocab, setVocab] = useState<VocabItem[]>([]);
  const [brief, setBrief] = useState<ModelsBrief | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [category, setCategory] = useState("");
  const [open, setOpen] = useState<VocabItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  // โหลดคลังคำ
  const refresh = useCallback(async () => {
    try {
      const v = await getVocabulary();
      setVocab(v.items);
      setBrief(v.models);
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดคลังคำไม่สำเร็จ");
    }
  }, []);

  // โหลดตอนเปิดหน้า
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // สลับเลือกคำไว้เทรน (อัปเดตหน้าจอทันที ถ้าบันทึกไม่สำเร็จค่อยคืนค่าเดิม)
  const toggleTrain = async (v: VocabItem, next: boolean) => {
    setVocab((list) => list.map((x) => (x.word === v.word ? { ...x, in_train_set: next } : x)));
    try {
      await setTrainWord(v.word, next);
    } catch (e) {
      setVocab((list) => list.map((x) => (x.word === v.word ? { ...x, in_train_set: !next } : x)));
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    }
  };

  const categories = useMemo(() => [...new Set(vocab.map((v) => v.category).filter(Boolean) as string[])].sort(), [vocab]);
  const rows = useMemo(() => {
    const test = FILTERS.find((f) => f.value === filter)!.test;
    const needle = q.trim();
    return vocab.filter((v) => test(v) && (!category || v.category === category) && (!needle || v.word.includes(needle)));
  }, [vocab, filter, category, q]);
  const trainCount = vocab.filter((v) => v.in_train_set).length;
  const hasDraft = !!brief?.draft.label;
  const select = "h-10 rounded-xl border border-sky bg-white px-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

  return (
    <Card title={`คลังคำศัพท์ (${vocab.length} คำ)`}>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="ค้นหาคำ" className="min-w-[200px] flex-1" />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="ตัวกรอง" className={select}>
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label} ({vocab.filter(f.test).length})
            </option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="หมวด" className={select}>
          <option value="">ทุกหมวด</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-2 text-xs text-ink/55">
        เลือกไว้เทรน <b className="text-navy">{trainCount}</b> คำ (มีผลเมื่อเทรนครั้งถัดไป) · % = ทายถูกเมื่อทดสอบกับผู้แสดงที่โมเดลไม่เคยเห็น
        {brief?.active.label && <> · โมเดลที่ใช้ {brief.active.label}</>}
      </p>
      {error && <p className="mt-2 rounded-xl bg-danger/10 px-4 py-2 text-sm text-danger">{error}</p>}

      <div className="scrollbar-thin mt-3 max-h-[calc(100dvh-20rem)] min-h-[16rem] overflow-auto rounded-xl bg-white/70 ring-1 ring-sky">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="sticky top-0 z-10 bg-cream/95 text-left text-xs text-ink/55 backdrop-blur">
            <tr>
              <th className="px-3 py-2 font-semibold">คำ</th>
              <th className="px-3 py-2 font-semibold">หมวด</th>
              <th className="px-3 py-2 text-right font-semibold">คลิปล่าม</th>
              <th className="px-3 py-2 text-right font-semibold">คลิป TSL</th>
              <th className="px-3 py-2 font-semibold">เทรน</th>
              <th className="px-3 py-2 font-semibold">แม่นยำ{brief?.active.label ? ` (${brief.active.label})` : ""}</th>
              {hasDraft && <th className="px-3 py-2 font-semibold">Draft {brief?.draft.label}</th>}
              <th className="px-3 py-2 font-semibold">อวตาร</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sky/50">
            {rows.map((v) => (
              <tr key={v.word} onClick={() => setOpen(v)} className="cursor-pointer transition hover:bg-sky/20">
                <td className="px-3 py-2 font-semibold text-navy">
                  {v.word}
                  {v.to_record && (
                    <Badge tone="warning" className="ml-1.5">
                      ต้องอัด
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-ink/60">{v.category ?? "-"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{v.data?.samples || <span className="text-ink/30">0</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{tslClips(v) || <span className="text-ink/30">0</span>}</td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    <Switch checked={v.in_train_set} onChange={(next) => void toggleTrain(v, next)} label={`เลือก ${v.word} ไว้เทรน`} size="sm" />
                    {v.in_train_set && !trainable(v) && (
                      <span title={`ยังไม่มีข้อมูลพอเทรน (ไม่มีคลิป TSL และคลิปล่ามยังไม่ถึง ${MIN_RECORDED_CLIPS})`}>
                        <Icon name="alert" size={14} className="text-amber-600" />
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Accuracy included={v.in_active_model} accuracy={v.model?.active.accuracy} />
                </td>
                {hasDraft && (
                  <td className="px-3 py-2">
                    <Accuracy included={v.in_draft_model} accuracy={v.model?.draft.accuracy} />
                  </td>
                )}
                <td className="px-3 py-2">
                  {v.avatar?.has_motion ? <Badge tone="success">มีท่า</Badge> : <span className="text-xs text-ink/40">ยังไม่มี</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-10 text-center text-sm text-ink/55">ไม่พบคำตามที่ค้นหา</p>}
      </div>

      <WordDrawer item={open} brief={brief} onClose={() => setOpen(null)} onChanged={() => void refresh()} />
    </Card>
  );
}

// แผงรายละเอียดคำ: สถานะในโมเดล ท่าอวตาร และคลิปที่ล่ามอัด (สลับเทรน/ทดสอบรายคลิป)
function WordDrawer({ item, brief, onClose, onChanged }: { item: VocabItem | null; brief: ModelsBrief | null; onClose: () => void; onChanged: () => void }) {
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

  // สลับคลิปเป็นชุดเทรน/ทดสอบ
  const toggleSplit = async (s: SampleMeta) => {
    const next = s.split === "test" ? "train" : "test";
    setSamples((list) => list?.map((x) => (x.id === s.id ? { ...x, split: next } : x)) ?? null);
    try {
      await setSampleSplit(s.id, next);
      onChanged();
    } catch (e) {
      setSamples((list) => list?.map((x) => (x.id === s.id ? { ...x, split: s.split } : x)) ?? null);
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    }
  };

  // จัดกลุ่มคลิปตามผู้แสดง
  const bySigner = useMemo(() => {
    const m = new Map<string, SampleMeta[]>();
    for (const s of samples ?? []) {
      const k = s.signer ?? "ไม่ระบุผู้แสดง";
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()];
  }, [samples]);

  const ext = Object.entries(item?.external ?? {});
  return (
    <Drawer open={!!item} title={item?.word ?? ""} subtitle={item?.category ?? undefined} onClose={onClose}>
      {item && (
        <div className="flex flex-col gap-5 text-sm">
          <section className="grid grid-cols-2 gap-2">
            <Stat label={`โมเดลที่ใช้ ${brief?.active.label ?? ""}`}>
              <Accuracy included={item.in_active_model} accuracy={item.model?.active.accuracy} />
            </Stat>
            <Stat label={`Draft ${brief?.draft.label ?? ""}`}>
              {brief?.draft.label ? <Accuracy included={item.in_draft_model} accuracy={item.model?.draft.accuracy} /> : <span className="text-ink/40">ไม่มี</span>}
            </Stat>
            <Stat label="ชุดข้อมูล TSL">{ext.length ? ext.map(([src, e]) => `${src} ${e.clips} คลิป`).join(" · ") : <span className="text-ink/40">ไม่มี</span>}</Stat>
            <Stat label="ท่าอวตาร">{item.avatar?.has_motion ? <Badge tone="success">มีท่าแล้ว</Badge> : <span className="text-ink/40">ยังไม่มี</span>}</Stat>
          </section>

          <section>
            <h3 className="mb-1 font-bold text-navy">คลิปที่ล่ามอัด ({samples?.length ?? "…"})</h3>
            <p className="mb-2 text-xs text-ink/55">
              สลับเป็น <b>ทดสอบ</b> เพื่อกันคลิปไว้วัดความแม่นยำ (ไม่ใช้ตอนวัดผล) · เลือกทั้งคนได้ที่แท็บ "โมเดล → ชุดทดสอบ"
            </p>
            {error && <p className="mb-2 text-xs text-danger">{error}</p>}
            {samples && samples.length === 0 && <p className="rounded-xl border border-dashed border-sky px-3 py-6 text-center text-ink/50">ยังไม่มีคลิป</p>}
            <div className="flex flex-col gap-3">
              {bySigner.map(([signer, list]) => (
                <div key={signer} className="rounded-xl bg-white/70 ring-1 ring-sky">
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
                        <button
                          type="button"
                          onClick={() => void toggleSplit(s)}
                          className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 transition ${
                            s.split === "test" ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-white text-navy ring-sky hover:bg-sky/40"
                          }`}
                          title="คลิกเพื่อสลับ เทรน/ทดสอบ"
                        >
                          {s.split === "test" ? "ทดสอบ" : "เทรน"}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </Drawer>
  );
}

// ช่องสรุปเล็ก ๆ: หัวข้อ + ค่า
function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-white/70 px-3 py-2 ring-1 ring-sky">
      <div className="text-[11px] text-ink/55">{label}</div>
      <div className="mt-0.5 font-semibold text-navy">{children}</div>
    </div>
  );
}
