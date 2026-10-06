import { useCallback, useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card";
import Icon from "../../components/ui/Icon";
import { fmtBytes, fmtDate } from "../../lib/format";
import type { ModelsBrief } from "../contributor/services/contributorApi";
import ModelPanel from "./components/ModelPanel";
import { getVocabulary, listModels, setActiveModel, setTrainWord, type ModelFile, type VocabItem } from "./services/adminApi";

// จำนวนคลิปที่ล่ามอัดขั้นต่ำต่อคำ ที่ train.py นำไปเทรน (ตรงกับ min_recorded_clips ใน ml/configs/train_words.json)
const MIN_RECORDED_CLIPS = 5;

// คำนี้มีข้อมูลพอเทรนไหม: มีคลิปในชุด TSL หรือล่ามอัดครบจำนวนขั้นต่ำ
const trainable = (v: VocabItem) =>
  Object.values(v.external ?? {}).some((e) => e.clips > 0) || (v.data?.samples ?? 0) >= MIN_RECORDED_CLIPS;

// ตัวกรองคลังคำศัพท์
type Filter = "all" | "train" | "to_record" | "in_model" | "weak" | "not_in_model" | "no_avatar" | "no_data";

// ตัวเลือกตัวกรอง
const FILTERS: { value: Filter; label: string; test: (v: VocabItem) => boolean }[] = [
  { value: "all", label: "ทั้งหมด", test: () => true },
  { value: "train", label: "เลือกไว้เทรน", test: (v) => v.in_train_set },
  { value: "to_record", label: "ต้องอัดเอง", test: (v) => v.to_record },
  { value: "in_model", label: "อยู่ในโมเดลที่ใช้", test: (v) => v.in_active_model },
  { value: "weak", label: "แม่นต่ำ (<70%)", test: (v) => (v.model?.active.accuracy ?? 1) < 0.7 },
  { value: "not_in_model", label: "ยังไม่อยู่ในโมเดล", test: (v) => !v.in_active_model },
  { value: "no_data", label: "ยังไม่มีคลิป", test: (v) => !v.data?.samples },
  { value: "no_avatar", label: "ยังไม่มีท่าอวตาร", test: (v) => !v.avatar?.has_motion },
];

// ช่องสถานะในโมเดลหนึ่งเวอร์ชัน: ✓ + ทายถูกกี่ % (ทดสอบกับคนใหม่)
function InModel({ included, accuracy }: { included: boolean; accuracy: number | null }) {
  if (!included) return <span className="text-ink/35">–</span>;
  const tone =
    accuracy == null ? "text-navy" : accuracy >= 0.7 ? "text-emerald-700" : accuracy >= 0.4 ? "text-amber-700" : "text-danger";
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${tone}`}>
      <Icon name="check" size={15} />
      {accuracy == null ? <span className="font-normal text-ink/50">ไม่ได้วัด</span> : `${Math.round(accuracy * 100)}%`}
    </span>
  );
}

// เครื่องหมายถูก/ขีด ในตาราง
function Mark({ ok, label }: { ok: boolean; label?: string }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-emerald-700">
      <Icon name="check" size={15} />
      {label}
    </span>
  ) : (
    <span className="text-ink/35">–</span>
  );
}

// คลังคำ & เวอร์ชัน: เทรน/เผยแพร่ เลือกเวอร์ชันโมเดลที่ใช้ และดูคลังคำศัพท์กับท่า
export default function VersionsView() {
  const [models, setModels] = useState<ModelFile[]>([]);
  const [vocab, setVocab] = useState<VocabItem[]>([]);
  const [brief, setBrief] = useState<ModelsBrief | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // โหลดรายการโมเดลและคลังคำใหม่
  const refresh = useCallback(async () => {
    try {
      const [m, v] = await Promise.all([listModels(), getVocabulary()]);
      setModels(m);
      setVocab(v.items);
      setBrief(v.models);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ" });
    }
  }, []);

  // โหลดตอนเปิดหน้า
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ตั้งเวอร์ชันที่ระบบใช้ (ถามยืนยันก่อน)
  const activate = async (m: ModelFile) => {
    if (!window.confirm(`ใช้โมเดล ${m.label} ในระบบแปลภาษามือใช่ไหม?`)) return;
    try {
      setMessage({ ok: true, text: (await setActiveModel(m.version)).message });
      void refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "ตั้งเวอร์ชันไม่สำเร็จ" });
    }
  };

  // ติ๊ก/เอาติ๊กออกคอลัมน์ "เทรน" (อัปเดตหน้าจอทันที ถ้าบันทึกไม่สำเร็จค่อยคืนค่าเดิม)
  const toggleTrain = async (v: VocabItem) => {
    const next = !v.in_train_set;
    setVocab((list) => list.map((x) => (x.word === v.word ? { ...x, in_train_set: next } : x)));
    try {
      await setTrainWord(v.word, next);
    } catch (e) {
      setVocab((list) => list.map((x) => (x.word === v.word ? { ...x, in_train_set: !next } : x)));
      setMessage({ ok: false, text: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" });
    }
  };

  const trainCount = vocab.filter((v) => v.in_train_set).length;
  const rows = useMemo(() => vocab.filter(FILTERS.find((f) => f.value === filter)!.test), [vocab, filter]);
  const totalSamples = vocab.reduce((n, v) => n + (v.data?.samples ?? 0), 0);
  const totalWords = vocab.filter((v) => v.data?.samples).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card title="เทรนและเผยแพร่">
          <ModelPanel totalSamples={totalSamples} totalWords={totalWords} onChange={() => void refresh()} />
        </Card>

        <Card title={`เวอร์ชันโมเดลทั้งหมด (${models.length})`}>
          {message && (
            <p className={`mb-2 text-sm ${message.ok ? "text-emerald-700" : "text-danger"}`}>{message.text}</p>
          )}
          {models.length === 0 ? (
            <p className="text-sm text-ink/60">ยังไม่มีไฟล์โมเดลในโฟลเดอร์ ml/models</p>
          ) : (
            <ul className="scrollbar-thin flex max-h-80 flex-col gap-2 overflow-y-auto pr-2">
              {models.map((m) => (
                <li
                  key={m.version}
                  className={`flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 ring-1 ${
                    m.active ? "bg-emerald-50 ring-emerald-200" : "bg-white/70 ring-sky"
                  }`}
                >
                  <Icon name="layers" size={18} className="text-brand" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-base font-bold text-navy">{m.label}</span>
                      <span className="truncate text-xs text-ink/50">{m.version}</span>
                    </div>
                    <div className="text-xs text-ink/60">
                      {fmtDate(m.modified_at)} · {fmtBytes(m.bytes)}
                      {m.words != null && ` · ${m.words} คำ`}
                      {m.samples != null && ` · ${m.samples} คลิป`}
                      {m.val_accuracy != null && (
                        <span className="font-semibold text-navy">
                          {" "}
                          · ทดสอบกับคนใหม่: ถูก {Math.round(m.val_accuracy * 100)}%
                          {m.val_top3 != null && ` (3 อันดับ ${Math.round(m.val_top3 * 100)}%)`}
                        </span>
                      )}
                    </div>
                  </div>
                  {m.active && (
                    <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-semibold text-white">
                      ใช้งานอยู่
                    </span>
                  )}
                  {m.draft && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      Draft
                    </span>
                  )}
                  {!m.active && (
                    <button
                      type="button"
                      onClick={() => void activate(m)}
                      className="rounded-lg bg-sky/50 px-2.5 py-1 text-xs font-semibold text-navy hover:bg-sky"
                    >
                      ใช้เวอร์ชันนี้
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={`คลังคำศัพท์และท่า (${vocab.length} คำ)`}>
        <p className="mb-2 text-sm text-ink/70">
          ติ๊กคอลัมน์ <b className="text-navy">เทรน</b> เพื่อเลือกคำที่จะให้โมเดลเรียนรู้ (เลือกไว้{" "}
          <b className="text-navy">{trainCount}</b> คำ) มีผลเมื่อเทรนครั้งถัดไป
        </p>
        <p className="mb-3 text-sm text-ink/70">
          ตัวเลข % คือคำนั้นทายถูกกี่ครั้ง เมื่อทดสอบกับผู้แสดงที่โมเดลไม่เคยเห็น
          {brief?.active.label && (
            <>
              {" "}· ใช้งาน <b className="text-navy">{brief.active.label}</b> ({brief.active.word_count} คำ
              {brief.active.val_accuracy != null && `, รวม ${Math.round(brief.active.val_accuracy * 100)}%`})
            </>
          )}
          {brief?.draft.label && (
            <>
              {" "}· Draft <b className="text-navy">{brief.draft.label}</b> ({brief.draft.word_count} คำ
              {brief.draft.val_accuracy != null && `, รวม ${Math.round(brief.draft.val_accuracy * 100)}%`})
            </>
          )}
        </p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`rounded-full px-3 py-1 text-sm font-semibold transition ${
                filter === f.value ? "bg-navy text-white" : "bg-sky/50 text-navy hover:bg-sky"
              }`}
            >
              {f.label} <span className="opacity-70">{vocab.filter(f.test).length}</span>
            </button>
          ))}
        </div>
        <div className="scrollbar-thin max-h-[60vh] overflow-auto rounded-xl ring-1 ring-sky">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="sticky top-0 z-10 bg-sky/80 text-left text-xs text-navy backdrop-blur">
              <tr>
                <th className="px-3 py-2 font-bold">เทรน</th>
                <th className="px-3 py-2 font-bold">คำ</th>
                <th className="px-3 py-2 font-bold">หมวด</th>
                <th className="px-3 py-2 text-right font-bold">คลิปที่อัด</th>
                <th className="px-3 py-2 font-bold">ชุดข้อมูล TSL</th>
                <th className="px-3 py-2 font-bold">ใช้งาน {brief?.active.label ?? ""}</th>
                <th className="px-3 py-2 font-bold">Draft {brief?.draft.label ?? ""}</th>
                <th className="px-3 py-2 font-bold">ท่าอวตาร (ข้อความ→ภาษามือ)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/60 bg-white/70">
              {rows.map((v) => (
                <tr key={v.word}>
                  <td className="px-3 py-2">
                    <label
                      className="flex items-center gap-1.5"
                      title={trainable(v) ? "เลือกคำนี้ไว้เทรนโมเดล" : `ยังไม่มีข้อมูลพอเทรน (ไม่มีคลิป TSL และคลิปที่อัดยังไม่ถึง ${MIN_RECORDED_CLIPS})`}
                    >
                      <input
                        type="checkbox"
                        checked={v.in_train_set}
                        onChange={() => void toggleTrain(v)}
                        aria-label={`เลือก ${v.word} ไว้เทรน`}
                        className="h-4 w-4 accent-brand"
                      />
                      {v.in_train_set && !trainable(v) && <Icon name="alert" size={14} className="text-amber-600" />}
                    </label>
                  </td>
                  <td className="px-3 py-2 font-semibold text-navy">
                    {v.word}
                    {v.to_record && (
                      <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                        ต้องอัด{v.priority ? ` · ${v.priority}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink/70">{v.category ?? "-"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{v.data?.samples ?? 0}</td>
                  <td className="px-3 py-2 text-xs text-ink/70">
                    {Object.entries(v.external ?? {}).length
                      ? Object.entries(v.external)
                          .map(([src, e]) => `${src} ${e.clips}`)
                          .join(" · ")
                      : "-"}
                  </td>
                  <td className="px-3 py-2">
                    <InModel included={v.in_active_model} accuracy={v.model?.active.accuracy ?? null} />
                  </td>
                  <td className="px-3 py-2">
                    <InModel included={v.in_draft_model} accuracy={v.model?.draft.accuracy ?? null} />
                  </td>
                  <td className="px-3 py-2">
                    {v.avatar ? (
                      <span className="flex gap-3">
                        <Mark ok={v.avatar.has_motion} label="ท่า" />
                        <Mark ok={v.avatar.has_clip} label="วิดีโอ" />
                      </span>
                    ) : (
                      <span className="text-ink/35">ไม่อยู่ในคลัง</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
