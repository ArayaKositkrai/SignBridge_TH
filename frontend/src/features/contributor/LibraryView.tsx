import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "../../components/ui/Card";
import Icon from "../../components/ui/Icon";
import { fmtDate, fmtDuration, fmtNumber, fmtPct } from "../../lib/format";
import ModelBadge from "./components/ModelBadge";
import { TARGET_SAMPLES } from "./constants";
import { useContributor } from "./context";
import type { VocabEntry } from "./services/contributorApi";

// กลุ่มคำที่ดู: ทั้งหมด / ควรอัดเพิ่ม / อยู่ในโมเดล / อัดแล้ว
type Tab = "all" | "weak" | "model" | "recorded";

// วิธีเรียงคำในคลัง
type SortKey = "need" | "accuracy" | "samples" | "updated" | "word";

// ความแม่นยำของคำในโมเดลที่ใช้งาน (ไม่อยู่ในโมเดลหรือไม่ได้วัด = null)
const acc = (v: VocabEntry) => (v.model?.active.included ? v.model.active.accuracy : null);

// ตัวเลือกกลุ่มคำ ("ควรอัดเพิ่ม" = อยู่ในโมเดลแต่ทายถูกไม่ถึง 70%)
const TABS: { value: Tab; label: string; test: (v: VocabEntry) => boolean }[] = [
  { value: "all", label: "ทั้งหมด", test: () => true },
  { value: "weak", label: "ควรอัดเพิ่ม (แม่นต่ำ)", test: (v) => (acc(v) ?? 1) < 0.7 },
  { value: "model", label: "อยู่ในโมเดล", test: (v) => !!v.model?.active.included || !!v.model?.draft.included },
  { value: "recorded", label: "อัดแล้ว", test: (v) => !!v.data?.samples },
];

// ตัวเลือกการเรียง
const SORTS: { value: SortKey; label: string }[] = [
  { value: "need", label: "ต้องอัดเพิ่มก่อน" },
  { value: "accuracy", label: "แม่นน้อย → มาก" },
  { value: "samples", label: "คลิปมาก → น้อย" },
  { value: "updated", label: "อัดล่าสุด" },
  { value: "word", label: "ชื่อคำ ก-ฮ" },
];

// ลำดับความสำคัญ (ใช้เรียง)
const PRIORITY_RANK: Record<string, number> = { สูง: 0, กลาง: 1, ต่ำ: 2 };

// จำนวนคลิปที่อัดของคำ
const n = (v: VocabEntry) => v.data?.samples ?? 0;

// ฟังก์ชันเรียงแต่ละแบบ ("ต้องอัดเพิ่มก่อน" = ยังไม่ครบก่อน แล้วตามความสำคัญ แล้วคลิปน้อยก่อน)
const SORTERS: Record<SortKey, (a: VocabEntry, b: VocabEntry) => number> = {
  need: (a, b) =>
    Number(n(a) >= TARGET_SAMPLES) - Number(n(b) >= TARGET_SAMPLES) ||
    (PRIORITY_RANK[a.priority ?? ""] ?? 9) - (PRIORITY_RANK[b.priority ?? ""] ?? 9) ||
    n(a) - n(b),
  accuracy: (a, b) => (acc(a) ?? 2) - (acc(b) ?? 2),
  samples: (a, b) => n(b) - n(a),
  updated: (a, b) => (b.data?.updated_at ?? "").localeCompare(a.data?.updated_at ?? ""),
  word: (a, b) => a.word.localeCompare(b.word, "th"),
};

// คลังคำศัพท์: คำที่ต้องอัด คำจากชุดข้อมูล TSL และคำที่อัดแล้ว พร้อมสถิติและปุ่มไปอัด
export default function LibraryView() {
  const { vocab, models } = useContributor();
  const [tab, setTab] = useState<Tab>("all");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("need");

  const inTab = useMemo(() => vocab.filter(TABS.find((t) => t.value === tab)!.test), [vocab, tab]);
  const categories = useMemo(
    () => [...new Set(inTab.map((v) => v.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "th")),
    [inTab],
  );
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inTab
      .filter((v) => (!category || v.category === category) && (!q || v.word.toLowerCase().includes(q)))
      .sort(SORTERS[sort]);
  }, [inTab, category, query, sort]);

  return (
    <Card title={`คลังคำศัพท์ · ${vocab.length} คำ`} className="min-w-0">
      {/* โมเดลที่ใช้งานอยู่ */}
      {models?.active.label && (
        <p className="mb-3 text-sm text-ink/70">
          โมเดลที่ใช้งาน <b className="text-navy">{models.active.label}</b> รู้จัก {models.active.word_count} คำ
          {models.draft.label && (
            <>
              {" "}· มี Draft <b className="text-navy">{models.draft.label}</b> รอทดสอบ
            </>
          )}
        </p>
      )}
      {/* กลุ่มคำ */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => {
              setTab(t.value);
              setCategory("");
            }}
            className={`rounded-full px-3 py-1 text-sm font-semibold transition ${
              tab === t.value ? "bg-deep text-white" : "bg-sky/50 text-navy hover:bg-sky"
            }`}
          >
            {t.label} <span className="opacity-70">{vocab.filter(t.test).length}</span>
          </button>
        ))}
      </div>

      {/* ค้นหา กรองหมวด เรียง */}
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาคำ"
            className="h-10 w-full rounded-xl border border-sky bg-surface pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-10 rounded-xl border border-sky bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
          aria-label="หมวด"
        >
          <option value="">ทุกหมวด</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="h-10 rounded-xl border border-sky bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
          aria-label="เรียงตาม"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-sky px-4 py-10 text-center text-sm text-ink/60">
          ไม่พบคำในกลุ่มนี้
        </p>
      ) : (
        <div className="scrollbar-thin max-h-[calc(100dvh-22rem)] min-h-[16rem] overflow-auto rounded-xl ring-1 ring-sky">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="sticky top-0 z-10 bg-sky/90 text-left text-xs text-navy backdrop-blur">
              <tr>
                <th className="px-3 py-2 font-bold">คำ</th>
                <th className="px-3 py-2 font-bold">หมวด</th>
                <th className="px-3 py-2 font-bold">โมเดล</th>
                <th className="px-3 py-2 text-right font-bold">คลิปที่อัด</th>
                <th className="px-3 py-2 text-right font-bold">เฟรม</th>
                <th className="px-3 py-2 text-right font-bold">ความยาว</th>
                <th className="px-3 py-2 text-right font-bold">เห็นมือ</th>
                <th className="px-3 py-2 font-bold">ชุดข้อมูล TSL</th>
                <th className="px-3 py-2 font-bold">อัดล่าสุด</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/60 bg-surface/70">
              {rows.map((v) => {
                const d = v.data;
                return (
                  <tr key={v.word} className="transition hover:bg-sky/20">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 font-semibold text-navy">
                        {v.priority === "สูง" && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" title="ความสำคัญสูง" />}
                        {v.word}
                      </div>
                      {v.note && <div className="max-w-[16rem] truncate text-xs text-ink/50" title={v.note}>{v.note}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink/70">{v.category ?? "-"}</td>
                    <td className="px-3 py-2">
                      <ModelBadge status={v.model} models={models} compact />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{n(v)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d ? fmtNumber(d.frames) : "-"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d ? fmtDuration(d.duration_ms) : "-"}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${!d ? "" : d.hand_rate >= 0.6 ? "text-emerald-700" : "text-amber-700"}`}>
                      {d ? fmtPct(d.hand_rate) : "-"}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink/70">
                      {Object.entries(v.external).length
                        ? Object.entries(v.external)
                            .map(([src, e]) => `${src} ${e.clips}`)
                            .join(" · ")
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink/60">{fmtDate(d?.updated_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        to={`/contributor?word=${encodeURIComponent(v.word)}`}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-sky/50 px-2.5 py-1 text-xs font-semibold text-navy hover:bg-sky"
                      >
                        <Icon name="camera" size={14} />
                        {n(v) ? "อัดเพิ่ม" : "อัด"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
