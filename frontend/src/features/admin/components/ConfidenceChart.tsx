import { useState } from "react";
import { HintIcon } from "../../../components/ui/Tooltip";
import { HINTS } from "./metricInfo";
import type { MetricDetail } from "../services/adminApi";

// แสดงเปอร์เซ็นต์ (ไม่มีค่า = ขีด)
const pct = (v: number | null | undefined, digits = 0) => (v == null ? "–" : `${(v * 100).toFixed(digits)}%`);

// สีของแท่งในกราฟความมั่นใจ (ตรวจกับ validator แล้ว: ถูก/ผิด แยกได้ทั้งโหมดสว่าง/มืด
//   แต่คนตาบอดสีแยกได้ยาก จึงมีลายทแยงบนแท่ง "ทายผิด" + ป้ายกำกับ + ช่องว่างระหว่างแท่งช่วยแยก)
const BAR_CORRECT = "bg-[#059669] dark:bg-[#0e9f6e]";
const BAR_WRONG = "bg-[#d62839] dark:bg-[#e5484d]";
const HATCH = { backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,.45) 0 2px, transparent 2px 6px)" };

// ฮิสโตแกรมความมั่นใจของคำอันดับ 1: แท่งคู่ (ทายถูก / ทายผิด) ต่อช่วง 10% พร้อมเส้นเกณฑ์ความมั่นใจ
export function ConfidenceChart({ data, threshold }: { data: NonNullable<MetricDetail["confidence"]>; threshold?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.correct, ...data.wrong);
  const step = data.bins.length ? 1 / data.bins.length : 0.1;
  return (
    <figure>
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/70">
        <span className="inline-flex items-center gap-1 font-semibold text-navy">
          ระบบมั่นใจแค่ไหนตอนทายถูก/ผิด
          <HintIcon text={HINTS.chart} icon="help" tone="info" wide />
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-sm ${BAR_CORRECT}`} /> ทายถูก
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-sm ${BAR_WRONG}`} style={HATCH} /> ทายผิด
        </span>
        {threshold != null && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 border-l-2 border-dashed border-navy" /> ขั้นต่ำที่ขึ้นคำ {pct(threshold)}
          </span>
        )}
      </figcaption>
      <div className="relative h-40 border-b border-sky" aria-hidden="true">
        <div className="absolute inset-0 flex items-end">
          {data.bins.map((b, i) => (
            <div
              key={b}
              className="relative flex h-full flex-1 items-end justify-center gap-0.5 px-0.5"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {hover === i && <div className="absolute inset-0 rounded bg-sky/30" />}
              <div className={`relative w-1/3 rounded-t ${BAR_CORRECT}`} style={{ height: `${(data.correct[i] / max) * 100}%` }} />
              <div className={`relative w-1/3 rounded-t ${BAR_WRONG}`} style={{ height: `${(data.wrong[i] / max) * 100}%`, ...HATCH }} />
              {hover === i && (
                <div className="absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-lg bg-surface px-2.5 py-1.5 text-xs text-ink shadow-card ring-1 ring-sky">
                  <p className="font-semibold text-navy">
                    มั่นใจ {Math.round(b * 100)}–{Math.round((b + step) * 100)}%
                  </p>
                  <p>ทายถูก {data.correct[i]} · ทายผิด {data.wrong[i]}</p>
                </div>
              )}
            </div>
          ))}
        </div>
        {threshold != null && (
          <div className="pointer-events-none absolute inset-y-0 border-l-2 border-dashed border-navy" style={{ left: `${threshold * 100}%` }} />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink/50" aria-hidden="true">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
      {/* ตารางข้อมูลเดียวกันสำหรับโปรแกรมอ่านหน้าจอ */}
      <table className="sr-only">
        <caption>จำนวนคลิปที่ทายถูกและทายผิด แยกตามช่วงความมั่นใจ</caption>
        <thead>
          <tr>
            <th>ช่วงความมั่นใจ</th>
            <th>ทายถูก</th>
            <th>ทายผิด</th>
          </tr>
        </thead>
        <tbody>
          {data.bins.map((b, i) => (
            <tr key={b}>
              <td>
                {Math.round(b * 100)}–{Math.round((b + step) * 100)}%
              </td>
              <td>{data.correct[i]}</td>
              <td>{data.wrong[i]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
