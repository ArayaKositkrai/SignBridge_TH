import { useCallback, useEffect, useRef, useState } from "react";
import { logEvent } from "../../../lib/activityLog";
import Button from "../../../components/ui/Button";
import { getTrainStatus, publishModel, versionLabel, type TrainProgress, type TrainStatus } from "../services/adminApi";

// ค่าที่แผงโมเดลรับ: จำนวนคลิปและจำนวนคำทั้งหมด
interface Props {
  totalSamples: number;
  totalWords: number;
  onChange?: () => void;
}

// ข้อความสถานะการเทรนภาษาไทย
const STATUS_LABEL: Record<TrainStatus["status"], string> = {
  idle: "ยังไม่เคยเทรน",
  running: "กำลังเทรน…",
  stalled: "ขาดการติดต่อ (เครื่องที่เทรนเงียบไป)",
  succeeded: "เทรนเสร็จแล้ว",
  failed: "เทรนไม่สำเร็จ",
};

// สีป้ายสถานะการเทรน
const STATUS_TONE: Record<TrainStatus["status"], string> = {
  idle: "bg-sky/50 text-navy",
  running: "bg-amber-100 text-amber-700 animate-pulse",
  stalled: "bg-amber-100 text-amber-800",
  succeeded: "bg-emerald-100 text-emerald-700",
  failed: "bg-danger/10 text-danger",
};

// ชื่อขั้นการเทรน และช่วงของแถบความคืบหน้า (0-1) ที่แต่ละขั้นใช้
const STAGES: Record<NonNullable<TrainProgress["stage"]>, { label: string; from: number; to: number }> = {
  load: { label: "โหลดข้อมูล", from: 0, to: 0.05 },
  validate: { label: "เทรนเพื่อวัดความแม่นยำ", from: 0.05, to: 0.5 },
  final: { label: "เทรนรอบสุดท้ายด้วยข้อมูลทั้งหมด", from: 0.5, to: 0.95 },
  save: { label: "บันทึกโมเดล", from: 0.95, to: 1 },
  done: { label: "เสร็จ", from: 1, to: 1 },
  failed: { label: "หยุด", from: 0, to: 0 },
};

// สัดส่วนความคืบหน้าทั้งหมด (0-1) จากขั้นและรอบที่รายงานมา
function overall(p: TrainProgress): number {
  const stage = STAGES[p.stage ?? "load"];
  const inStage = p.epoch && p.epochs ? p.epoch / p.epochs : 0;
  return stage.from + (stage.to - stage.from) * inStage;
}

// แสดงเปอร์เซ็นต์
const pct = (v: number | undefined) => (v === undefined ? "-" : `${(v * 100).toFixed(1)}%`);

// แผงจัดการโมเดล: ดูความคืบหน้าการเทรน (รันจากเครื่องด้วย python train.py) ทดสอบ และเผยแพร่
export default function ModelPanel({ totalSamples, totalWords, onChange }: Props) {
  const [info, setInfo] = useState<TrainStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // ดึงสถานะล่าสุดจาก backend
  const refresh = useCallback(async () => {
    try {
      setInfo(await getTrainStatus());
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "โหลดสถานะไม่สำเร็จ" });
    }
  }, []);

  // โหลดสถานะตอนเปิดหน้า แล้วถามทุก 3 วินาทีขณะเทรน (ไม่ได้เทรนถามทุก 15 วินาที เผื่อมีคนเริ่มเทรนจากเครื่อง)
  const running = info?.status === "running";
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), running ? 3000 : 15000);
    return () => window.clearInterval(id);
  }, [running, refresh]);

  // เทรนเสร็จ (สำเร็จหรือล้ม) ให้หน้าที่ครอบอยู่โหลดรายการโมเดลใหม่
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const finished = info?.status === "succeeded" || info?.status === "failed";
  useEffect(() => {
    if (finished) onChangeRef.current?.();
  }, [finished, info?.run?.id]);

  // เรียก API แล้วแสดงผล พร้อมโหลดสถานะใหม่
  const run = async (action: () => Promise<{ message: string }>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ ok: true, text: (await action()).message });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "เกิดข้อผิดพลาด" });
    } finally {
      setBusy(false);
      void refresh();
      onChange?.();
    }
  };

  // คัดลอกคำสั่งเทรนไปวางใน terminal
  const copyCommand = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setMessage({ ok: false, text: "คัดลอกไม่ได้ กรุณาคัดลอกเอง" });
    }
  };

  const r = info?.run;
  const prog = r?.progress ?? {};
  const fraction = info?.status === "succeeded" ? 1 : overall(prog);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink/70">
        ข้อมูลทั้งหมด <b className="text-navy">{totalWords}</b> คำ · <b className="text-navy">{totalSamples}</b> คลิป
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-white/70 p-2 ring-1 ring-sky">
          <div className="text-[11px] text-ink/60">ใช้งานอยู่</div>
          <div className="truncate text-xs font-bold text-navy" title={info?.active_version ?? ""}>
            {versionLabel(info?.active_version) ?? "-"}
          </div>
        </div>
        <div className="rounded-xl bg-white/70 p-2 ring-1 ring-sky">
          <div className="text-[11px] text-ink/60">Draft (รอทดสอบ)</div>
          <div className="truncate text-xs font-bold text-navy" title={info?.draft_version ?? ""}>
            {versionLabel(info?.draft_version) ?? "ไม่มี"}
          </div>
        </div>
      </div>

      {/* วิธีเทรน: รันคำสั่งบนเครื่องที่มี torch (เครื่องเดียวกับ backend ไฟล์โมเดลจะอยู่ใน ml/models ทันที) */}
      {info && (
        <div className="rounded-xl bg-white/70 p-2.5 ring-1 ring-sky">
          <div className="mb-1.5 text-[11px] text-ink/60">เทรนโมเดลจากเครื่อง (ที่รากโปรเจกต์)</div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-navy/90 px-2 py-1.5 text-xs text-sky">{info.command}</code>
            <Button size="sm" variant="ghost" icon={copied ? "check" : "text"} onClick={() => void copyCommand()}>
              {copied ? "คัดลอกแล้ว" : "คัดลอก"}
            </Button>
          </div>
        </div>
      )}

      {/* การเทรนล่าสุด: สถานะ ขั้น แถบความคืบหน้า ความแม่นยำ และ log */}
      {info && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[info.status]}`}>
              {STATUS_LABEL[info.status]}
            </span>
            {r?.host && <span className="text-xs text-ink/55">เครื่อง {r.host}</span>}
            {r?.started_at && <span className="text-xs text-ink/55">เริ่ม {r.started_at.replace("T", " ")}</span>}
          </div>

          {r && (info.status === "running" || info.status === "stalled") && (
            <div>
              <div className="mb-1 flex justify-between text-xs text-ink/60">
                <span>
                  {STAGES[prog.stage ?? "load"].label}
                  {prog.epoch && prog.epochs ? ` · รอบ ${prog.epoch}/${prog.epochs}` : ""}
                  {prog.loss !== undefined ? ` · loss ${prog.loss.toFixed(3)}` : ""}
                </span>
                <span className="font-semibold text-navy">{Math.round(fraction * 100)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-sky/50">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand to-royal transition-[width] duration-700"
                  style={{ width: `${fraction * 100}%` }}
                />
              </div>
            </div>
          )}

          {(prog.val_accuracy !== undefined || prog.val_top3 !== undefined) && (
            <p className="text-xs text-ink/70">
              ทายถูกกับผู้แสดงใหม่ <b className="text-navy">{pct(prog.val_accuracy)}</b> · ติด 3 อันดับ{" "}
              <b className="text-navy">{pct(prog.val_top3)}</b>
              {r?.model && <> · ได้ {versionLabel(r.model)}</>}
            </p>
          )}
          {r?.error && <p className="text-xs text-danger">{r.error}</p>}

          {r && r.log.length > 0 && (
            <pre className="max-h-40 overflow-auto rounded-lg bg-navy/90 p-2 text-[11px] leading-relaxed text-sky">
              {r.log.join("\n")}
            </pre>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="ghost"
          icon="play"
          onClick={() => {
            logEvent("ทดสอบโมเดล Draft", versionLabel(info?.draft_version) ?? undefined);
            window.open("/?version=draft", "_blank");
          }}
          disabled={!info?.draft_version}
        >
          ทดสอบ Draft
        </Button>
        <Button
          size="sm"
          variant="soft"
          icon="check"
          onClick={() => void run(publishModel)}
          disabled={busy || running || !info?.draft_version}
        >
          เผยแพร่
        </Button>
      </div>

      {message && <p className={message.ok ? "text-emerald-700" : "text-danger"}>{message.text}</p>}
      <p className="text-xs text-ink/50">
        เทรนเฉพาะคำที่ติ๊กคอลัมน์ "เทรน" ในตารางคลังคำศัพท์ด้านล่าง ใช้คลิปจากชุดข้อมูล TSL และคลิปที่ล่ามอัดตั้งแต่ 5 คลิปต่อคำ ผลที่ได้เป็นเวอร์ชัน Draft
        ให้ทดสอบก่อนกดเผยแพร่
      </p>
    </div>
  );
}
