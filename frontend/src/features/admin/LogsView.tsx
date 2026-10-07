import { useCallback, useEffect, useMemo, useState } from "react";
import Badge, { type Tone } from "../../components/ui/Badge";
import Card from "../../components/ui/Card";
import Icon from "../../components/ui/Icon";
import SearchInput from "../../components/ui/SearchInput";
import Switch from "../../components/ui/Switch";
import { fmtNumber } from "../../lib/format";
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
] as const;
// ช่วงเวลาด่วน (จำนวนวันย้อนหลัง, 0 = วันนี้)
const PERIODS = [
  { value: "today", label: "วันนี้", days: 0 },
  { value: "7d", label: "7 วัน", days: 6 },
  { value: "30d", label: "30 วัน", days: 29 },
  { value: "all", label: "ทั้งหมด", days: null },
  { value: "custom", label: "กำหนดเอง", days: null },
] as const;
type Period = (typeof PERIODS)[number]["value"];

// สีป้ายบทบาท
const ACTOR_TONE: Record<string, Tone> = { แอดมิน: "navy", ล่าม: "brand", ผู้ใช้: "neutral" };

// วันที่รูปแบบ YYYY-MM-DD ของเวลาท้องถิ่น
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// วันถัดไปของวันที่ (ใช้เป็นขอบบนของช่วงวันที่ เพื่อให้รวมทั้งวันสุดท้าย)
const nextDay = (d: string) => {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + 1);
  return isoDay(x);
};

// หัวข้อวันแบบอ่านง่าย: วันนี้ / เมื่อวาน / วันที่เต็ม
function dayLabel(day: string) {
  const today = isoDay(new Date());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (day === today) return "วันนี้";
  if (day === isoDay(y)) return "เมื่อวาน";
  return new Date(`${day}T00:00:00`).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
}

// เวลาแบบ ชม:นาที:วินาที
const timeOf = (ts: string) => new Date(ts).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// หน้า Log: ใครทำอะไร เมื่อไร สำเร็จไหม (ไม่แสดง IP/รหัสเครื่อง — เก็บไว้ในระบบเพื่อความปลอดภัยเท่านั้น)
export default function LogsView() {
  const [actor, setActor] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [period, setPeriod] = useState<Period>("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showPages, setShowPages] = useState(false);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [page, setPage] = useState(0);
  const [auto, setAuto] = useState(false);
  const [items, setItems] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [today, setToday] = useState<Record<string, number>>({});
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
    hide_pages: !showPages,
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
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลด log ไม่สำเร็จ");
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

  // จัดกลุ่มรายการตามวัน (เรียงใหม่ → เก่าตามที่ backend ส่งมา)
  const groups = useMemo(() => {
    const out: { day: string; rows: LogEntry[] }[] = [];
    for (const r of items) {
      const day = r.ts.slice(0, 10);
      if (out[out.length - 1]?.day !== day) out.push({ day, rows: [] });
      out[out.length - 1].rows.push(r);
    }
    return out;
  }, [items]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilter = actor || kind || q.trim() || period !== "7d" || onlyFailed || showPages;
  const todayTotal = ACTORS.reduce((n, a) => n + (today[a] ?? 0), 0);

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

  const select = "h-10 rounded-xl border border-sky bg-white px-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

  return (
    <Card
      title="บันทึกการใช้งาน"
      action={
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-ink/60 sm:inline">
            วันนี้ <b className="text-navy">{fmtNumber(todayTotal)}</b> รายการ
          </span>
          <label className="flex items-center gap-2 text-ink/70">
            <Switch checked={auto} onChange={setAuto} label="อัปเดตอัตโนมัติ" size="sm" />
            สด
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="grid h-9 w-9 place-items-center rounded-xl text-navy hover:bg-sky/50"
            aria-label="รีเฟรช"
            title="รีเฟรช"
          >
            <Icon name="refresh" size={17} className={loading ? "animate-spin" : ""} />
          </button>
          <a href={logsCsvUrl(filter)} className="flex h-9 items-center gap-1.5 rounded-xl bg-sky/60 px-3 font-semibold text-navy hover:bg-sky" title="ดาวน์โหลดตามตัวกรอง">
            <Icon name="upload" size={15} className="rotate-180" />
            CSV
          </a>
        </div>
      }
    >
      {/* ตัวกรอง */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="ค้นหาชื่อผู้ใช้ การกระทำ รายละเอียด" className="min-w-[220px] flex-1" />
        <select value={actor} onChange={(e) => setActor(e.target.value)} aria-label="บทบาท" className={select}>
          <option value="">ทุกบทบาท</option>
          {ACTORS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="ประเภท" className={select}>
          <option value="">ทุกประเภท</option>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <div className="flex rounded-xl bg-sky/40 p-0.5" role="group" aria-label="ช่วงเวลา">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                period === p.value ? "bg-white text-navy shadow-sm" : "text-navy/70 hover:text-navy"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink/70">
        {period === "custom" && (
          <span className="flex items-center gap-1.5">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="ตั้งแต่วันที่" className={select} />
            ถึง
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="ถึงวันที่" className={select} />
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
        <span className="ml-auto text-xs text-ink/50">
          พบ {fmtNumber(total)} รายการ
          {hasFilter && (
            <button type="button" onClick={reset} className="ml-2 font-semibold text-brand hover:underline">
              ล้างตัวกรอง
            </button>
          )}
        </span>
      </div>

      {error && <p className="mt-3 rounded-xl bg-danger/10 px-4 py-2 text-sm text-danger">{error}</p>}

      {/* รายการ จัดกลุ่มตามวัน */}
      {items.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-sky px-4 py-12 text-center text-sm text-ink/55">
          {loading ? "กำลังโหลด…" : hasFilter ? "ไม่พบรายการตามตัวกรอง" : "ยังไม่มีบันทึก"}
        </p>
      ) : (
        <div className="scrollbar-thin mt-3 max-h-[calc(100dvh-22rem)] min-h-[16rem] overflow-auto rounded-xl bg-white/70 ring-1 ring-sky">
          {groups.map((g) => (
            <section key={g.day}>
              <h4 className="sticky top-0 z-10 border-b border-sky/60 bg-cream/95 px-4 py-1.5 text-xs font-bold text-navy backdrop-blur">
                {dayLabel(g.day)}
              </h4>
              <ul className="divide-y divide-sky/40">
                {g.rows.map((r) => (
                  <LogRow key={r.id} r={r} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* แบ่งหน้า */}
      {total > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-lg px-3 py-1.5 font-semibold text-navy hover:bg-sky/50 disabled:opacity-40"
          >
            ← ใหม่กว่า
          </button>
          <span className="tabular-nums text-ink/60">
            หน้า {page + 1} / {pages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            disabled={page >= pages - 1}
            className="rounded-lg px-3 py-1.5 font-semibold text-navy hover:bg-sky/50 disabled:opacity-40"
          >
            เก่ากว่า →
          </button>
        </div>
      )}
      <p className="mt-2 text-xs text-ink/45">ไม่เก็บข้อความที่ผู้ใช้พิมพ์ · เก็บย้อนหลัง 180 วัน</p>
    </Card>
  );
}

// แถว log หนึ่งรายการ: เวลา · ผู้ใช้ · การกระทำ · รายละเอียด · ผล (แสดงเฉพาะที่ไม่สำเร็จ)
function LogRow({ r }: { r: LogEntry }) {
  const failed = r.status != null && r.status >= 400;
  return (
    <li className={`grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 px-4 py-2 text-sm sm:grid-cols-[4.5rem_12rem_minmax(0,1fr)_auto] ${failed ? "bg-danger/5" : ""}`}>
      <span className="pt-0.5 tabular-nums text-xs text-ink/50">{timeOf(r.ts)}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <Badge tone={ACTOR_TONE[r.actor] ?? "neutral"}>{r.actor}</Badge>
        <span className="truncate text-ink/75" title={r.user_name ?? undefined}>
          {r.user_name ?? <span className="text-ink/40">ไม่ทราบชื่อ</span>}
        </span>
      </span>
      <span className="col-start-2 min-w-0 sm:col-start-auto">
        <span className="font-semibold text-navy">{r.action}</span>
        {r.detail && <span className="ml-1.5 text-ink/55">· {r.detail}</span>}
      </span>
      <span className="col-start-2 sm:col-start-auto">
        {failed && <Badge tone="danger">ไม่สำเร็จ</Badge>}
      </span>
    </li>
  );
}
