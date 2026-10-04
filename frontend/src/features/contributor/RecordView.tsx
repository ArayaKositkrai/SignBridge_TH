import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Card from "../../components/ui/Card";
import Icon from "../../components/ui/Icon";
import ClipViewer from "./components/ClipViewer";
import ModelBadge from "./components/ModelBadge";
import RecorderPanel from "./components/RecorderPanel";
import SampleList from "./components/SampleList";
import { TARGET_SAMPLES } from "./constants";
import { logEvent } from "../../lib/activityLog";
import { useContributor } from "./context";
import { deleteSample, listSamples, type SampleMeta } from "./services/contributorApi";

// ลำดับความสำคัญ (ใช้เรียงคำแนะนำ)
const PRIORITY_RANK: Record<string, number> = { สูง: 0, กลาง: 1, ต่ำ: 2 };

// หน้าอัดคลิป (พอดีจอบนจอกว้าง): เลือกคำ → อัด/อัปโหลด → ตรวจ → เก็บ พร้อมคลิปของคำนั้นด้านขวา
export default function RecordView() {
  const { words, vocab, models, refresh, signer, setError } = useContributor();
  const [params, setParams] = useSearchParams();
  const [word, setWord] = useState(params.get("word") ?? "");
  const [samples, setSamples] = useState<SampleMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const current = word.trim();

  // เปลี่ยนคำจากลิงก์ภายนอก (เช่น กดจาก sidebar หรือคลังคำศัพท์)
  const fromUrl = params.get("word") ?? "";
  useEffect(() => setWord(fromUrl), [fromUrl]);

  // พิมพ์คำแล้วจำไว้ใน URL (กดย้อนกลับ/แชร์ลิงก์ได้)
  const changeWord = (w: string) => {
    setWord(w);
    setParams(w.trim() ? { word: w.trim() } : {}, { replace: true });
  };

  // โหลดคลิปของคำที่เลือก
  const refreshSamples = useCallback(
    async (w: string) => {
      if (!w) {
        setSamples([]);
        return;
      }
      setLoading(true);
      try {
        setSamples(await listSamples(w));
      } catch (e) {
        setSamples([]);
        setError(e instanceof Error ? e.message : "โหลดคลิปไม่สำเร็จ");
      } finally {
        setLoading(false);
      }
    },
    [setError],
  );

  // พิมพ์คำเสร็จ 300 ms แล้วค่อยโหลดคลิปของคำนั้น
  useEffect(() => {
    setViewing(null);
    const id = window.setTimeout(() => void refreshSamples(current), 300);
    return () => window.clearTimeout(id);
  }, [current, refreshSamples]);

  // บันทึกคลิปสำเร็จ: เพิ่มเข้ารายการและอัปเดตสถิติ
  const handleSaved = (s: SampleMeta) => {
    if (s.word === current) setSamples((prev) => [...prev, s]);
    void refresh();
  };

  // ลบคลิป (ถามยืนยันก่อน) ถ้าเปิดดูจอใหญ่อยู่ให้เลื่อนไปคลิปที่เหลือ
  const handleDelete = async (s: SampleMeta) => {
    if (!window.confirm("ลบคลิปนี้ใช่ไหม? ลบแล้วกู้คืนไม่ได้")) return;
    try {
      await deleteSample(s.word, s.id);
      const next = samples.filter((x) => x.id !== s.id);
      setSamples(next);
      setViewing((v) => (v === null || !next.length ? null : Math.min(v, next.length - 1)));
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ลบคลิปไม่สำเร็จ");
    }
  };

  // คำแนะนำ: คำที่ต้องอัด (ยังไม่ครบก่อน เรียงตามความสำคัญ) ตามด้วยคำอื่นที่อัดไว้แล้ว
  const suggestions = useMemo(() => {
    const count = (w: string) => words.find((x) => x.word === w)?.samples ?? 0;
    const plan = vocab
      .filter((v) => v.to_record)
      .map((v) => ({ word: v.word, samples: count(v.word), priority: v.priority }))
      .sort(
        (a, b) =>
          Number(a.samples >= TARGET_SAMPLES) - Number(b.samples >= TARGET_SAMPLES) ||
          (PRIORITY_RANK[a.priority ?? ""] ?? 9) - (PRIORITY_RANK[b.priority ?? ""] ?? 9),
      );
    const planned = new Set(plan.map((p) => p.word));
    const others = words.filter((w) => !planned.has(w.word)).map((w) => ({ ...w, priority: null }));
    return [...plan, ...others];
  }, [vocab, words]);

  const info = vocab.find((v) => v.word === current);
  const external = info ? Object.entries(info.external) : [];
  const progress = Math.min(1, samples.length / TARGET_SAMPLES);
  const isNewWord = !!current && !info && !words.some((w) => w.word === current);

  return (
    <div className="grid gap-4 xl:h-[calc(100dvh-12.75rem)] xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-5">
      <div className="scrollbar-thin flex min-h-0 min-w-0 flex-col gap-4 xl:overflow-y-auto xl:pr-1">
        {/* ขั้นที่ 1: เลือกคำ */}
        <Card title="1 · เลือกคำศัพท์" className="shrink-0">
          <div className="relative">
            <Icon name="text" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand" />
            <input
              type="text"
              value={word}
              onChange={(e) => changeWord(e.target.value)}
              list="vocab-words"
              maxLength={50}
              placeholder="พิมพ์หรือเลือกคำ เช่น โรงพยาบาล"
              className="h-11 w-full rounded-xl border border-sky bg-white pl-10 pr-24 text-base outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
            <datalist id="vocab-words">
              {vocab.map((v) => (
                <option key={v.word} value={v.word}>
                  {v.category ?? ""}
                </option>
              ))}
            </datalist>
            {isNewWord && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                คำใหม่
              </span>
            )}
          </div>

          {/* ข้อมูลของคำที่เลือกจากคลังคำศัพท์ */}
          {info && (
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/70">
              <ModelBadge status={info.model} models={models} />
              {info.category && <span>หมวด: {info.category}</span>}
              {info.priority && (
                <span className={info.priority === "สูง" ? "font-semibold text-danger" : ""}>
                  ความสำคัญ: {info.priority}
                </span>
              )}
              {external.map(([src, e]) => (
                <span key={src}>
                  มีใน {src} {e.clips} คลิป
                </span>
              ))}
              {info.note && <span className="text-ink/55">· {info.note}</span>}
            </p>
          )}

          {suggestions.length > 0 && (
            <div className="scrollbar-thin mt-2.5 flex max-h-[4.5rem] flex-wrap gap-1.5 overflow-y-auto pr-1">
              {suggestions.map((w) => {
                const done = w.samples >= TARGET_SAMPLES;
                const active = w.word === current;
                return (
                  <button
                    key={w.word}
                    type="button"
                    onClick={() => changeWord(w.word)}
                    title={w.priority ? `ต้องอัด · ความสำคัญ${w.priority}` : undefined}
                    className={`flex items-center gap-1.5 rounded-full py-0.5 pl-2.5 pr-1 text-sm font-semibold transition ${
                      active ? "bg-navy text-white shadow" : "bg-sky/50 text-navy hover:bg-sky"
                    }`}
                  >
                    {w.priority === "สูง" && !done && <span className="h-1.5 w-1.5 rounded-full bg-danger" />}
                    {w.word}
                    <span
                      className={`flex items-center gap-0.5 rounded-full px-1.5 text-xs ${
                        done ? "bg-emerald-500 text-white" : active ? "bg-white/20" : "bg-white/70 text-ink/70"
                      }`}
                    >
                      {done && <Icon name="check" size={11} />}
                      {w.samples}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {/* ขั้นที่ 2: อัดคลิป */}
        <Card title="2 · อัดหรืออัปโหลดคลิป" className="shrink-0">
          <RecorderPanel
            word={word}
            signer={signer}
            savedCount={samples.length}
            target={TARGET_SAMPLES}
            onSaved={handleSaved}
          />
        </Card>
      </div>

      {/* คลิปของคำนี้ (รายการเลื่อนในกรอบ) */}
      <Card
        title={current ? `คลิปของ "${current}" (${samples.length})` : "คลิปที่เก็บแล้ว"}
        className="flex min-h-0 min-w-0 flex-col"
      >
        {current && (
          <div className="mb-3 shrink-0">
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="text-ink/60">
                {samples.length >= TARGET_SAMPLES ? "ครบตามที่แนะนำแล้ว อัดเพิ่มได้อีก" : `แนะนำอย่างน้อย ${TARGET_SAMPLES} คลิป`}
              </span>
              <span className="font-bold text-navy">
                {samples.length}/{TARGET_SAMPLES}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-sky/50">
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${
                  progress >= 1 ? "bg-emerald-500" : "bg-gradient-to-r from-brand to-royal"
                }`}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>
        )}
        <div className="h-80 min-h-0 xl:h-auto xl:flex-1">
          <SampleList
            word={current}
            samples={samples}
            loading={loading}
            onOpen={(i) => {
              logEvent("ดูคลิปจอใหญ่", current);
              setViewing(i);
            }}
            onDelete={(s) => void handleDelete(s)}
          />
        </div>
        {samples.length > 0 && <p className="mt-2 shrink-0 text-xs text-ink/50">กดคลิปเพื่อดูจอใหญ่พร้อม skeleton</p>}
      </Card>

      {viewing !== null && samples[viewing] && (
        <ClipViewer
          samples={samples}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          onDelete={(s) => void handleDelete(s)}
        />
      )}
    </div>
  );
}
