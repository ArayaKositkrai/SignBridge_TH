import { useCallback, useEffect, useState } from "react";
import Card from "../../components/ui/Card";
import Icon from "../../components/ui/Icon";
import { fmtNumber } from "../../lib/format";
import { listLogs, logsCsvUrl, type LogEntry, type LogFilter } from "./services/adminApi";

// จำนวนแถวต่อหน้า
const PAGE_SIZE = 50;
// รีเฟรชอัตโนมัติทุกกี่มิลลิวินาที
const AUTO_REFRESH_MS = 5000;
// ผู้ทำที่กรองได้
const ACTORS = ["แอดมิน", "ล่าม", "ผู้ใช้"] as const;
// ประเภทที่กรองได้
const KINDS = ["ปุ่ม", "ฟังก์ชัน", "เปิดหน้า"] as const;

// สีป้ายของผู้ทำแต่ละกลุ่ม
const ACTOR_TONE: Record<string, string> = {
  แอดมิน: "bg-navy text-white",
  ล่าม: "bg-brand/15 text-brand",
  ผู้ใช้: "bg-sky/60 text-navy",
};

// สีป้ายของประเภท
const KIND_TONE: Record<string, string> = {
  ปุ่ม: "bg-amber-100 text-amber-800",
  ฟังก์ชัน: "bg-emerald-100 text-emerald-800",
  เปิดหน้า: "bg-ink/5 text-ink/70",
};

// แยกวันที่และเวลาแบบไทยจากเวลา ISO
function splitTs(ts: string) {
  const d = new Date(ts);
  return {
    date: d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }),
    time: d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
}

// วันถัดไปของวันที่ (ใช้เป็นขอบบนของช่วงวันที่ เพื่อให้รวมทั้งวันสุดท้าย)
const nextDay = (d: string) => {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

// หน้า Log: ใครทำอะไร กดปุ่มไหน ใช้ฟังก์ชันไหน วันที่และเวลา (กรอง ค้นหา แบ่งหน้า ดาวน์โหลด CSV)
export default function LogsView() {
  const [actor, setActor] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [auto, setAuto] = useState(false);
  const [items, setItems] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [today, setToday] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filter: LogFilter = {
    actor,
    kind,
    q: q.trim(),
    date_from: from ? `${from}T00:00:00` : undefined,
    date_to: to ? `${nextDay(to)}T00:00:00` : undefined,
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

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilter = actor || kind || q.trim() || from || to;

  return (
    <div className="flex flex-col gap-4">
      {/* สรุปวันนี้ */}
      <div className="grid grid-cols-3 gap-3">
        {ACTORS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setActor(actor === a ? "" : a)}
            className={`glass-card flex items-center justify-between text-left transition hover:ring-2 hover:ring-brand/30 ${
              actor === a ? "ring-2 ring-brand" : ""
            }`}
          >
            <div>
              <div className="text-xs text-ink/60">วันนี้ · {a}</div>
              <div className="text-xl font-bold tabular-nums text-navy">{fmtNumber(today[a] ?? 0)}</div>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ACTOR_TONE[a]}`}>{a}</span>
          </button>
        ))}
      </div>

      <Card title={`Log การใช้งาน (${fmtNumber(total)} รายการ)`} className="min-w-0">
        {/* ตัวกรอง */}
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหา การกระทำ / รายละเอียด / หน้า / เครื่อง"
              className="h-10 w-full rounded-xl border border-sky bg-white pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <select
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            aria-label="ใคร"
            className="h-10 rounded-xl border border-sky bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
          >
            <option value="">ทุกคน</option>
            {ACTORS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            aria-label="ประเภท"
            className="h-10 rounded-xl border border-sky bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
          >
            <option value="">ทุกประเภท</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <label className="flex flex-col text-[11px] text-ink/60">
            ตั้งแต่
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-10 rounded-xl border border-sky bg-white px-2 text-sm text-ink outline-none focus:ring-2 focus:ring-brand/30"
            />
          </label>
          <label className="flex flex-col text-[11px] text-ink/60">
            ถึง
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-10 rounded-xl border border-sky bg-white px-2 text-sm text-ink outline-none focus:ring-2 focus:ring-brand/30"
            />
          </label>
          {hasFilter && (
            <button
              type="button"
              onClick={() => {
                setActor("");
                setKind("");
                setQ("");
                setFrom("");
                setTo("");
              }}
              className="h-10 rounded-xl px-3 text-sm font-semibold text-brand hover:bg-sky/40"
            >
              ล้างตัวกรอง
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <label className="flex cursor-pointer select-none items-center gap-1.5 text-sm text-navy">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="h-4 w-4 accent-brand" />
              อัปเดตอัตโนมัติ
            </label>
            <button
              type="button"
              onClick={() => void load()}
              className="grid h-10 w-10 place-items-center rounded-xl bg-sky/50 text-navy hover:bg-sky"
              aria-label="รีเฟรช"
              title="รีเฟรช"
            >
              <Icon name="refresh" size={17} className={loading ? "animate-spin" : ""} />
            </button>
            <a
              href={logsCsvUrl(filter)}
              className="flex h-10 items-center gap-1.5 rounded-xl bg-gradient-to-br from-brand to-navy px-3 text-sm font-semibold text-white"
            >
              <Icon name="upload" size={16} className="rotate-180" />
              CSV
            </a>
          </div>
        </div>

        {error && <p className="mb-3 rounded-xl bg-danger/10 px-4 py-2 text-sm text-danger">{error}</p>}

        {/* ตาราง */}
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-sky px-4 py-10 text-center text-sm text-ink/60">
            {loading ? "กำลังโหลด…" : hasFilter ? "ไม่พบ log ตามตัวกรอง" : "ยังไม่มี log"}
          </p>
        ) : (
          <div className="scrollbar-thin max-h-[calc(100dvh-24rem)] min-h-[16rem] overflow-auto rounded-xl ring-1 ring-sky">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="sticky top-0 z-10 bg-sky/90 text-left text-xs text-navy backdrop-blur">
                <tr>
                  <th className="px-3 py-2 font-bold">วันที่</th>
                  <th className="px-3 py-2 font-bold">เวลา</th>
                  <th className="px-3 py-2 font-bold">ใคร</th>
                  <th className="px-3 py-2 font-bold">ประเภท</th>
                  <th className="px-3 py-2 font-bold">ทำอะไร</th>
                  <th className="px-3 py-2 font-bold">รายละเอียด</th>
                  <th className="px-3 py-2 font-bold">หน้า / ฟังก์ชัน</th>
                  <th className="px-3 py-2 font-bold">ผล</th>
                  <th className="px-3 py-2 font-bold">เครื่อง · IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky/60 bg-white/70">
                {items.map((r) => {
                  const t = splitTs(r.ts);
                  const ok = r.status == null || r.status < 400;
                  return (
                    <tr key={r.id} className="align-top transition hover:bg-sky/20">
                      <td className="whitespace-nowrap px-3 py-2 text-ink/70">{t.date}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink/70">{t.time}</td>
                      <td className="px-3 py-2">
                        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${ACTOR_TONE[r.actor]}`}>
                          {r.actor}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${KIND_TONE[r.kind]}`}>{r.kind}</span>
                      </td>
                      <td className="px-3 py-2 font-semibold text-navy">{r.action}</td>
                      <td className="max-w-[14rem] truncate px-3 py-2 text-ink/70" title={r.detail ?? ""}>
                        {r.detail ?? "-"}
                      </td>
                      <td className="max-w-[16rem] px-3 py-2 text-xs text-ink/60">
                        {r.page && <div className="truncate">{r.page}</div>}
                        {r.method && (
                          <div className="truncate font-mono" title={`${r.method} ${r.path}`}>
                            {r.method} {r.path}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.status == null ? (
                          <span className="text-ink/35">–</span>
                        ) : (
                          <span className={`text-xs font-semibold ${ok ? "text-emerald-700" : "text-danger"}`}>
                            {ok ? "สำเร็จ" : "ไม่สำเร็จ"} ({r.status})
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink/60">
                        {r.device ?? "-"}
                        <span className="text-ink/40"> · {r.ip ?? "-"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* แบ่งหน้า */}
        {total > PAGE_SIZE && (
          <div className="mt-3 flex items-center justify-end gap-2 text-sm">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-lg bg-sky/50 px-3 py-1.5 font-semibold text-navy hover:bg-sky disabled:opacity-40"
            >
              ก่อนหน้า
            </button>
            <span className="tabular-nums text-ink/70">
              หน้า {page + 1} / {pages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              disabled={page >= pages - 1}
              className="rounded-lg bg-sky/50 px-3 py-1.5 font-semibold text-navy hover:bg-sky disabled:opacity-40"
            >
              ถัดไป
            </button>
          </div>
        )}
        <p className="mt-2 text-xs text-ink/50">
          ยังไม่มีระบบล็อกอิน "ใคร" จึงดูจากพื้นที่ที่ใช้งาน (หน้าแอดมิน = แอดมิน, หน้าล่าม = ล่าม, หน้าอื่น = ผู้ใช้)
          และแยกเครื่องด้วยรหัสเครื่องกับ IP · ไม่เก็บข้อความที่ผู้ใช้พิมพ์ · เก็บย้อนหลัง 180 วัน
        </p>
      </Card>
    </div>
  );
}
