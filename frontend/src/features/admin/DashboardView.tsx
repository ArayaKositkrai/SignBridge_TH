import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card from "../../components/ui/Card";
import Icon, { type IconName } from "../../components/ui/Icon";
import { fmtNumber, fmtPct } from "../../lib/format";
import { TARGET_SAMPLES } from "../contributor/constants";
import ModelHealth from "./components/ModelHealth";
import PageHeader from "./components/PageHeader";
import { getDashboard, versionLabel, type Dashboard } from "./services/adminApi";

// ป้ายตัวเลขสรุปหนึ่งช่อง (กดแล้วไปหน้าที่เกี่ยวข้อง)
function Kpi({ icon, label, value, hint, to, go }: { icon: IconName; label: string; value: string; hint?: string; to: string; go: string }) {
  return (
    <Link
      to={to}
      title={`ไปที่หน้า${go}`}
      className="glass-card flex items-center gap-3 transition hover:ring-2 hover:ring-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand to-royal text-white">
        <Icon name={icon} size={20} />
      </span>
      <div className="min-w-0">
        <div className="truncate text-xl font-bold tabular-nums text-navy">{value}</div>
        <div className="text-xs text-ink/60">
          {label}
          {hint && <span className="ml-1 text-ink/45">· {hint}</span>}
        </div>
      </div>
    </Link>
  );
}

// แท่งแนวนอนหนึ่งแถว (ชื่อ แท่ง ค่า) พร้อมเส้นเป้าหมาย
function BarRow({ label, value, max, target }: { label: string; value: number; max: number; target?: number }) {
  const width = max ? (value / max) * 100 : 0;
  const done = target !== undefined && value >= target;
  return (
    <li className="grid grid-cols-[minmax(0,7rem)_1fr_2.5rem] items-center gap-2 text-sm">
      <span className="truncate font-medium text-navy" title={label}>
        {label}
      </span>
      <div className="relative h-3 rounded-full bg-sky/40">
        <div
          className={`h-full rounded-full ${done ? "bg-emerald-500" : "bg-brand"}`}
          style={{ width: `${width}%` }}
        />
        {target !== undefined && max > 0 && target <= max && (
          <span
            className="absolute -top-0.5 h-4 w-0.5 rounded bg-deep/50"
            style={{ left: `${(target / max) * 100}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      <span className="text-right tabular-nums text-ink/70">{value}</span>
    </li>
  );
}

// แดชบอร์ดแอดมิน: ตัวเลขรวม คลิปต่อคำ ล่าม คุณภาพข้อมูล และโมเดล
export default function DashboardView() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  // โหลดข้อมูลแดชบอร์ดตอนเปิดหน้า
  useEffect(() => {
    getDashboard()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ"));
  }, []);

  const header = <PageHeader title="ภาพรวม" description="จำนวนคำ คลิป ล่าม คุณภาพข้อมูล และโมเดลที่ใช้อยู่" />;
  if (error)
    return (
      <>
        {header}
        <p className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>
      </>
    );
  if (!data)
    return (
      <>
        {header}
        <p className="text-sm text-ink/60">กำลังโหลด…</p>
      </>
    );

  const t = data.totals;
  const maxSamples = Math.max(TARGET_SAMPLES, ...data.words.map((w) => w.samples));
  const maxSigner = Math.max(1, ...data.signers.map((s) => s.samples));
  const belowTarget = data.words.filter((w) => w.samples < TARGET_SAMPLES).length;

  return (
    <div className="flex flex-col gap-4">
      {header}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icon="book" label="คำศัพท์" value={fmtNumber(t.words)} to="/admin/vocabulary" go="คลังคำศัพท์" />
        <Kpi icon="camera" label="คลิป" value={fmtNumber(t.samples)} to="/admin/vocabulary" go="คลังคำศัพท์" />
        <Kpi icon="user" label="ล่าม" value={fmtNumber(t.signers)} to="/admin/users?tab=contributor" go="ผู้ใช้ (ล่าม)" />
        <Kpi icon="users" label="ผู้ใช้" value={fmtNumber(t.users)} to="/admin/users" go="ผู้ใช้" />
      </div>

      <ModelHealth />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={`คลิปต่อคำ (เส้นตั้ง = เป้า ${TARGET_SAMPLES} คลิป)`} className="lg:col-span-2">
          {data.words.length ? (
            <ul className="scrollbar-thin flex max-h-80 flex-col gap-2 overflow-y-auto pr-2">
              {data.words.map((w) => (
                <BarRow key={w.word} label={w.word} value={w.samples} max={maxSamples} target={TARGET_SAMPLES} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink/60">ยังไม่มีข้อมูล</p>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card title="คุณภาพข้อมูล">
            <ul className="flex flex-col gap-2 text-sm">
              <li className="flex justify-between">
                <span className="text-ink/70">เห็นมือเฉลี่ย</span>
                <b className={t.hand_rate >= 0.6 ? "text-emerald-700" : "text-amber-700"}>{fmtPct(t.hand_rate)}</b>
              </li>
              <li className="flex justify-between">
                <span className="text-ink/70">คำที่ยังไม่ครบ {TARGET_SAMPLES} คลิป</span>
                <b className={belowTarget ? "text-amber-700" : "text-emerald-700"}>{belowTarget}</b>
              </li>
              <li className="flex justify-between">
                <span className="text-ink/70">คลิปที่ไม่มี skeleton</span>
                <b className={t.without_landmarks ? "text-danger" : "text-emerald-700"}>{t.without_landmarks}</b>
              </li>
            </ul>
          </Card>

          <Card
            title="โมเดลที่ใช้"
            action={
              <Link to="/admin/models" className="text-xs font-semibold text-brand hover:underline">
                จัดการ
              </Link>
            }
          >
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-ink/70">ใช้งานอยู่</dt>
                <dd className="truncate font-semibold text-navy">{versionLabel(data.model.active_version) ?? "-"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink/70">Draft</dt>
                <dd className="truncate font-semibold text-navy">{versionLabel(data.model.draft_version) ?? "ไม่มี"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink/70">คำที่โมเดลรู้จัก</dt>
                <dd className="font-semibold text-navy">{data.model.words.length}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>

      <Card title="คลิปต่อล่าม">
        {data.signers.length ? (
          <ul className="scrollbar-thin flex max-h-72 flex-col gap-2 overflow-y-auto pr-2">
            {data.signers.map((s) => (
              <BarRow key={s.name} label={s.name} value={s.samples} max={maxSigner} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink/60">ยังไม่มีข้อมูล</p>
        )}
      </Card>
    </div>
  );
}
