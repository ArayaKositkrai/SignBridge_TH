import { useCallback, useEffect, useRef, useState } from "react";
import { logEvent } from "../../../lib/activityLog";
import Button from "../../../components/ui/Button";
import { getTrainStatus, publishModel, startTraining, versionLabel, type TrainStatus } from "../services/adminApi";

// ค่าที่แผงโมเดลรับ: จำนวนคลิปและจำนวนคำทั้งหมด (ไม่มีคลิปจะกดเทรนไม่ได้)
interface Props {
  totalSamples: number;
  totalWords: number;
  onChange?: () => void;
}

// ข้อความสถานะการเทรนภาษาไทย
const STATUS_LABEL: Record<TrainStatus["status"], string> = {
  idle: "ยังไม่ได้เทรน",
  running: "กำลังเทรน…",
  succeeded: "เทรนเสร็จแล้ว",
  failed: "เทรนไม่สำเร็จ",
};

// สีป้ายสถานะการเทรน
const STATUS_TONE: Record<TrainStatus["status"], string> = {
  idle: "bg-sky/50 text-navy",
  running: "bg-amber-100 text-amber-700 animate-pulse",
  succeeded: "bg-emerald-100 text-emerald-700",
  failed: "bg-danger/10 text-danger",
};

// แผงจัดการโมเดล: เทรน (ได้ draft) ทดสอบ และเผยแพร่
export default function ModelPanel({ totalSamples, totalWords, onChange }: Props) {
  const [info, setInfo] = useState<TrainStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // ดึงสถานะล่าสุดจาก backend
  const refresh = useCallback(async () => {
    try {
      setInfo(await getTrainStatus());
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "โหลดสถานะไม่สำเร็จ" });
    }
  }, []);

  // โหลดสถานะตอนเปิดหน้า
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ระหว่างเทรน ถามสถานะทุก 2 วินาทีจนเสร็จ
  const running = info?.status === "running";
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(id);
  }, [running, refresh]);

  // เทรนเสร็จ (สำเร็จหรือล้ม) ให้หน้าที่ครอบอยู่โหลดรายการโมเดลใหม่
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const finished = info?.status === "succeeded" || info?.status === "failed";
  useEffect(() => {
    if (finished) onChangeRef.current?.();
  }, [finished, info?.started_at]);

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
      {info && (
        <span className={`self-start rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[info.status]}`}>
          {STATUS_LABEL[info.status]}
        </span>
      )}

      {info && info.log.length > 0 && (
        <pre className="max-h-40 overflow-auto rounded-lg bg-navy/90 p-2 text-[11px] leading-relaxed text-sky">
          {info.log.join("\n")}
        </pre>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          icon="refresh"
          onClick={() => void run(startTraining)}
          disabled={busy || running || totalSamples === 0}
        >
          {running ? "กำลังเทรน…" : "เทรนโมเดล"}
        </Button>
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
      <p className="text-xs text-ink/50">เทรนจากชุดข้อมูล TSL (คำใน ml/configs/train_words.json) และคลิปที่ล่ามอัดตั้งแต่ 5 คลิปต่อคำ ใช้เวลาประมาณ 4 นาที</p>
    </div>
  );
}
