// แอดมิน → บันทึกการใช้งาน: ตาราง log พร้อมตัวกรอง รีเฟรชอัตโนมัติ และดาวน์โหลด CSV

import { useCallback, useEffect, useMemo, useState } from "react";
import Badge, { type Tone } from "../../components/ui/Badge";
import Icon from "../../components/ui/Icon";
import SearchInput from "../../components/ui/SearchInput";
import Switch from "../../components/ui/Switch";
import { fmtNumber } from "../../lib/format";
import DataTable, { type Column } from "./components/DataTable";
import PageHeader from "./components/PageHeader";
import StatCards, { type Stat } from "./components/StatCards";
import Toolbar, { FilterSelect } from "./components/Toolbar";
import { listLogs, logsCsvUrl, type LogEntry, type LogFilter } from "./services/adminApi";

// จำนวนแถวต่อหน้า
const PAGE_SIZE = 50;
// รีเฟรชอัตโนมัติทุกกี่มิลลิวินาที
const AUTO_REFRESH_MS = 5000;
// บทบาทที่กรองได้
const ACTORS = ["แอดมิน", "ล่าม", "ผู้ใช้"] as const;
// ประเภทที่กรองได้ (ภาษาที่คนทั่วไปเข้าใจ)
const KINDS = [
  { value: "ปุ่ม", label: "กดปุ่ม" },
  { value: "ฟังก์ชัน", label: "บันทึก/แก้ไขข้อมูล" },
  { value: "เปิดหน้า", label: "เปิดหน้า" },
];
// ชื่อประเภทที่แสดงในตาราง
const KIND_LABEL: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.value, k.label]));
// ช่วงเวลา (จำนวนวันย้อนหลัง, 0 = วันนี้)
const PERIODS = [
  { value: "today", label: "วันนี้", days: 0 },
  { value: "7d", label: "7 วันล่าสุด", days: 6 },
  { value: "30d", label: "30 วันล่าสุด", days: 29 },
  { value: "all", label: "ทั้งหมด (180 วัน)", days: null },
  { value: "custom", label: "กำหนดช่วงเอง…", days: null },
];

// สีป้ายบทบาท
const ACTOR_TONE: Record<string, Tone> = { แอดมิน: "navy", ล่าม: "brand", ผู้ใช้: "neutral" };

// วันที่รูปแบบ YYYY-MM-DD ของเวลาท้องถิ่น
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// วันถัดไปของวันที่ (ใช้เป็นขอบบนของช่วงวันที่ เพื่อให้รวมทั้งวันสุดท้าย)
const nextDay = (d: string) => {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + 1);
  return isoDay(x);
};

// วันที่แบบสั้น: วันนี้ / เมื่อวาน / 5 ต.ค. 69
function dayLabel(ts: string) {
  const day = ts.slice(0, 10);
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (day === isoDay(new Date())) return "วันนี้";
  if (day === isoDay(y)) return "เมื่อวาน";
  return new Date(`${day}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
}

// เวลาแบบ ชม:นาที:วินาที
const timeOf = (ts: string) => new Date(ts).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// หน้าบันทึกการใช้งาน: ใครทำอะไร เมื่อไร สำเร็จไหม (ไม่แสดง IP/รหัสเครื่อง — เก็บไว้ในระบบเพื่อความปลอดภัยเท่านั้น)
export default function LogsView() {
  const [actor, setActor] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [period, setPeriod] = useState("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showPages, setShowPages] = useState(false);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [page, setPage] = useState(0);
  const [auto, setAuto] = useState(false);
  const [items, setItems] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [today, setToday] = useState<Record<string, number>>({});
  const [summary, setSummary] = useState({ failed: 0, users: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ช่วงวันที่จากตัวเลือกช่วงเวลา
  const range = useMemo(() => {
    const p = PERIODS.find((x) => x.value === period)!;
    if (period === "custom") return { from, to };
    if (p.days === null) return { from: "", to: "" };
    const start = new Date();
    start.setDate(start.getDate() - p.days);
    return { from: isoDay(start), to: "" };
  }, [period, from, to]);

  const filter: LogFilter = {
    actor,
    kind,
    q: q.trim(),
    date_from: range.from ? `${range.from}T00:00:00` : undefined,
    date_to: range.to ? `${nextDay(range.to)}T00:00:00` : undefined,
    hide_pages: !showPages && kind !== "เปิดหน้า",
    failed: onlyFailed,
  };
  const key = JSON.stringify(filter);

  // โหลด log ตามตัวกรองและหน้าปัจจุบัน
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listLogs({ ...(JSON.parse(key) as LogFilter), limit: PAGE_SIZE, offset: page * PAGE_SIZE });
      setItems(r.items);
      setTotal(r.total);
      setToday(r.today);
      setSummary(r.today_summary);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดบันทึกไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [key, page]);

  // โหลดใหม่เมื่อตัวกรองหรือหน้าเปลี่ยน (หน่วงเล็กน้อยระหว่างพิมพ์ค้นหา)
  useEffect(() => {
    const id = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(id);
  }, [load]);

  // เปลี่ยนตัวกรองแล้วกลับไปหน้าแรก
  useEffect(() => setPage(0), [key]);

  // รีเฟรชอัตโนมัติเมื่อเปิดสวิตช์
  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => void load(), AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [auto, load]);

  const todayTotal = ACTORS.reduce((n, a) => n + (today[a] ?? 0), 0);
  const hasFilter = actor || kind || q.trim() || period !== "7d" || onlyFailed || showPages;

  // ล้างตัวกรองทั้งหมดกลับเป็นค่าเริ่มต้น
  const reset = () => {
    setActor("");
    setKind("");
    setQ("");
    setPeriod("7d");
    setFrom("");
    setTo("");
    setShowPages(false);
    setOnlyFailed(false);
  };

  // การ์ดสรุปของวันนี้ (กดเพื่อกรองตามบทบาท / เฉพาะที่ไม่สำเร็จ)
  const stats: Stat[] = [
    { label: "รายการวันนี้", value: fmtNumber(todayTotal), hint: `ผู้ใช้ที่เข้าสู่ระบบ ${summary.users} คน` },
    ...ACTORS.map((a) => ({ label: `วันนี้ · ${a}`, value: fmtNumber(today[a] ?? 0), filter: a })),
    { label: "ไม่สำเร็จวันนี้", value: fmtNumber(summary.failed), filter: "__failed", tone: summary.failed ? ("danger" as const) : ("default" as const) },
  ];
  // กดการ์ด: บทบาท → กรองบทบาท, ไม่สำเร็จ → สลับเฉพาะที่ไม่สำเร็จ
  const onStat = (f: string) => {
    setOnlyFailed(f === "__failed");
    setActor(f === "__failed" ? "" : f);
    if (f) setPeriod("today");
  };

  const columns: Column<LogEntry>[] = [
    {
      key: "ts",
      header: "วันที่ · เวลา",
      width: "9rem",
      cell: (r) => (
        <span className="whitespace-nowrap">
          <span className="block text-xs font-semibold text-navy">{dayLabel(r.ts)}</span>
          <span className="block tabular-nums text-xs text-ink/50">{timeOf(r.ts)}</span>
        </span>
      ),
    },
    {
      key: "user",
      header: "ผู้ใช้",
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <Badge tone={ACTOR_TONE[r.actor] ?? "neutral"}>{r.actor}</Badge>
          <span className="truncate text-ink/75">{r.user_name ?? <span className="text-ink/40">ไม่ทราบชื่อ</span>}</span>
        </span>
      ),
    },
    { key: "kind", header: "ประเภท", hideBelow: "lg", cell: (r) => <span className="text-xs text-ink/60">{KIND_LABEL[r.kind] ?? r.kind}</span> },
    { key: "action", header: "ทำอะไร", cell: (r) => <span className="font-semibold text-navy">{r.action}</span> },
    {
      key: "detail",
      header: "รายละเอียด",
      hideBelow: "md",
      cell: (r) => (
        <span className="block max-w-[18rem] truncate text-ink/60" title={r.detail ?? undefined}>
          {r.detail ?? "–"}
        </span>
      ),
    },
    {
      key: "result",
      header: "ผล",
      align: "center",
      width: "6rem",
      cell: (r) =>
        r.status == null ? (
          <span className="text-ink/30">–</span>
        ) : r.status < 400 ? (
          <Badge tone="success">สำเร็จ</Badge>
        ) : (
          <Badge tone="danger">ไม่สำเร็จ</Badge>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="บันทึกการใช้งาน"
        description="ใครทำอะไรในระบบ เมื่อไร และสำเร็จไหม · ไม่เก็บข้อความที่ผู้ใช้พิมพ์ · เก็บย้อนหลัง 180 วัน"
        actions={
          <>
            <label className="flex h-11 items-center gap-2 rounded-xl bg-surface px-3 text-sm text-navy ring-1 ring-sky">
              <Switch checked={auto} onChange={setAuto} label="อัปเดตอัตโนมัติ" size="sm" />
              อัปเดตสด
            </label>
            <a
              href={logsCsvUrl(filter)}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-surface px-4 text-sm font-semibold text-navy ring-1 ring-sky hover:bg-sky/40"
            >
              <Icon name="upload" size={17} className="rotate-180" />
              ดาวน์โหลด CSV
            </a>
          </>
        }
      />
      <StatCards stats={stats} active={onlyFailed ? "__failed" : actor} onSelect={onStat} />

      <Toolbar
        right={
          hasFilter && (
            <button type="button" onClick={reset} className="text-sm font-semibold text-brand hover:underline">
              ล้างตัวกรอง
            </button>
          )
        }
      >
        <SearchInput value={q} onChange={setQ} placeholder="ค้นหาชื่อผู้ใช้ การกระทำ รายละเอียด" className="min-w-[240px] flex-1" />
        <FilterSelect label="ช่วงเวลา" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p.value, label: p.label }))} />
        <FilterSelect label="บทบาท" value={actor} onChange={setActor} options={[{ value: "", label: "ทุกบทบาท" }, ...ACTORS.map((a) => ({ value: a, label: a }))]} />
        <FilterSelect label="ประเภท" value={kind} onChange={setKind} options={[{ value: "", label: "ทุกประเภท" }, ...KINDS]} />
      </Toolbar>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink/70">
        {period === "custom" && (
          <span className="flex items-center gap-2">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="ตั้งแต่วันที่"
              className="h-10 rounded-xl border border-sky bg-surface px-3 text-sm text-ink"
            />
            ถึง
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label="ถึงวันที่"
              className="h-10 rounded-xl border border-sky bg-surface px-3 text-sm text-ink"
            />
          </span>
        )}
        <label className="flex items-center gap-2">
          <Switch checked={onlyFailed} onChange={setOnlyFailed} label="เฉพาะที่ไม่สำเร็จ" size="sm" />
          เฉพาะที่ไม่สำเร็จ
        </label>
        <label className="flex items-center gap-2" title="การเปิดหน้ามีจำนวนมาก ซ่อนไว้เพื่อให้เห็นการกระทำสำคัญชัดขึ้น">
          <Switch checked={showPages || kind === "เปิดหน้า"} onChange={setShowPages} label="แสดงการเปิดหน้า" size="sm" disabled={kind !== ""} />
          แสดงการเปิดหน้า
        </label>
      </div>

      {error && <p className="mb-3 rounded-xl bg-danger/10 px-4 py-2 text-sm text-danger">{error}</p>}
      <DataTable
        rows={items}
        columns={columns}
        rowKey={(r) => r.id}
        loading={loading}
        rowClassName={(r) => (r.status != null && r.status >= 400 ? "bg-danger/5" : "")}
        paging={{ page, pageSize: PAGE_SIZE, total, onPage: setPage }}
        empty={hasFilter ? "ไม่พบรายการตามตัวกรอง" : "ยังไม่มีบันทึก"}
      />
    </>
  );
}
