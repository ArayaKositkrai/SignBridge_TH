import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Card from "../../components/ui/Card";
import ClipViewer from "./components/ClipViewer";
import ModelBadge from "./components/ModelBadge";
import RecorderPanel from "./components/RecorderPanel";
import SampleList from "./components/SampleList";
import WordCombobox from "./components/WordCombobox";
import { TARGET_SAMPLES } from "./constants";
import { logEvent } from "../../lib/activityLog";
import { useContributor } from "./context";
import { deleteSample, listSamples, type SampleMeta } from "./services/contributorApi";

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

  const info = vocab.find((v) => v.word === current);
  const external = info ? Object.entries(info.external) : [];
  const progress = Math.min(1, samples.length / TARGET_SAMPLES);

  return (
    <div className="grid gap-4 xl:h-[calc(100dvh-12.75rem)] xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-5">
      <div className="scrollbar-thin flex min-h-0 min-w-0 flex-col gap-4 xl:overflow-y-auto xl:pr-1">
        {/* เลือกคำ + อัดคลิปในการ์ดเดียว ให้เห็นส่วนอัดทันทีไม่ต้องเลื่อน */}
        <Card className="shrink-0">
          <div className="mb-3">
            <WordCombobox value={word} onChange={changeWord} vocab={vocab} words={words} target={TARGET_SAMPLES} />
            {/* ข้อมูลย่อของคำที่เลือกจากคลังคำศัพท์ (บรรทัดเดียว) */}
            {info && (
              <p className="mt-1.5 flex items-center gap-x-3 overflow-hidden whitespace-nowrap text-xs text-ink/70">
                <ModelBadge status={info.model} models={models} />
                {info.category && <span>หมวด: {info.category}</span>}
                {info.priority && (
                  <span className={info.priority === "สูง" ? "font-semibold text-danger" : ""}>ความสำคัญ: {info.priority}</span>
                )}
                {external.map(([src, e]) => (
                  <span key={src}>
                    {src} {e.clips} คลิป
                  </span>
                ))}
                {info.note && (
                  <span className="truncate text-ink/55" title={info.note}>
                    · {info.note}
                  </span>
                )}
              </p>
            )}
          </div>
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
