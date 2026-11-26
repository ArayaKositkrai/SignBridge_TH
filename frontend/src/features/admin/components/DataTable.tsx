// ตารางข้อมูลที่ใช้ในหน้าแอดมิน: เรียงคอลัมน์ แบ่งหน้า (ฝั่งหน้าเว็บหรือ backend)

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Icon from "../../../components/ui/Icon";

// คอลัมน์หนึ่งคอลัมน์ของตาราง
export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  // ค่าที่ใช้เรียง (ไม่ใส่ = เรียงคอลัมน์นี้ไม่ได้)
  sort?: (row: T) => string | number | null | undefined;
  align?: "left" | "right" | "center";
  // ซ่อนคอลัมน์บนจอที่เล็กกว่านี้
  hideBelow?: "sm" | "md" | "lg";
  width?: string;
}

// แบ่งหน้าจากฝั่ง backend (เช่น log ที่มีเป็นพัน ๆ รายการ)
export interface ServerPaging {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}

// ค่าที่ตารางรับ
interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  // จำนวนแถวต่อหน้า (แบ่งหน้าในเครื่อง) ไม่ใส่ = 50
  pageSize?: number;
  paging?: ServerPaging;
  initialSort?: { key: string; dir: "asc" | "desc" };
  loading?: boolean;
  empty?: ReactNode;
  // ความสูงสูงสุดของพื้นที่ตาราง (เลื่อนในตาราง หัวคอลัมน์ติดอยู่ด้านบน)
  maxHeight?: string;
}

// คลาสซ่อนคอลัมน์ตามขนาดจอ
const HIDE = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" } as const;
// คลาสจัดตำแหน่งข้อความ
const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

// เทียบค่าสำหรับเรียง (ค่าว่างไปท้ายเสมอ, ข้อความเรียงแบบภาษาไทย)
function compare(a: unknown, b: unknown): number {
  const empty = (v: unknown) => v === null || v === undefined || v === "";
  if (empty(a) && empty(b)) return 0;
  if (empty(a)) return 1;
  if (empty(b)) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "th");
}

// ตารางกลางของหน้าแอดมิน: หัวคอลัมน์ติดบน กดหัวเพื่อเรียง แบ่งหน้า คลิกแถวได้ และข้อความเมื่อไม่มีข้อมูล
export default function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  rowClassName,
  pageSize = 50,
  paging,
  initialSort,
  loading,
  empty = "ไม่มีข้อมูล",
  maxHeight = "calc(100dvh - 22rem)",
}: Props<T>) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);

  // ข้อมูลเปลี่ยน (ค้นหา/กรอง) → กลับไปหน้าแรก
  useEffect(() => setPage(0), [rows]);

  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!col?.sort || paging) return rows;
    const get = col.sort;
    const out = [...rows].sort((a, b) => compare(get(a), get(b)));
    return sort!.dir === "desc" ? out.reverse() : out;
  }, [rows, sort, columns, paging]);

  const total = paging ? paging.total : sorted.length;
  const size = paging ? paging.pageSize : pageSize;
  const current = paging ? paging.page : Math.min(page, Math.max(0, Math.ceil(total / size) - 1));
  const pages = Math.max(1, Math.ceil(total / size));
  const visible = paging ? sorted : sorted.slice(current * size, current * size + size);

  // เปลี่ยนหน้า (ในเครื่องหรือแจ้ง backend)
  const go = (p: number) => (paging ? paging.onPage(p) : setPage(p));

  // กดหัวคอลัมน์: เรียงน้อย→มาก, กดซ้ำ มาก→น้อย
  const toggleSort = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  return (
    <div className="overflow-hidden rounded-2xl bg-surface/80 ring-1 ring-sky">
      <div className="scrollbar-thin overflow-auto" style={{ maxHeight }}>
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    style={c.width ? { width: c.width } : undefined}
                    aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={`sticky top-0 z-10 whitespace-nowrap border-b border-sky bg-panel px-4 py-2.5 text-xs font-semibold text-ink/60 ${
                      ALIGN[c.align ?? "left"]
                    } ${c.hideBelow ? HIDE[c.hideBelow] : ""}`}
                  >
                    {c.sort && !paging ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className={`inline-flex items-center gap-1 hover:text-navy ${active ? "text-navy" : ""}`}
                      >
                        {c.header}
                        <span aria-hidden="true" className={`text-[10px] ${active ? "text-brand" : "opacity-35"}`}>
                          {active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={`${onRowClick ? "cursor-pointer" : ""} transition hover:bg-sky/25 ${rowClassName?.(r) ?? ""}`}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`border-b border-sky/50 px-4 py-2.5 align-middle ${ALIGN[c.align ?? "left"]} ${c.hideBelow ? HIDE[c.hideBelow] : ""}`}
                  >
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <div className="px-4 py-12 text-center text-sm text-ink/50">{loading ? "กำลังโหลด…" : empty}</div>}
      </div>
      <footer className="flex items-center justify-between gap-2 border-t border-sky/70 px-4 py-2 text-xs text-ink/55">
        <span>
          {total === 0 ? "0 รายการ" : `${(current * size + 1).toLocaleString("th-TH")}–${Math.min(total, (current + 1) * size).toLocaleString("th-TH")} จาก ${total.toLocaleString("th-TH")} รายการ`}
        </span>
        {pages > 1 && (
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => go(current - 1)}
              disabled={current === 0}
              className="grid h-7 w-7 place-items-center rounded-lg text-navy hover:bg-sky/50 disabled:opacity-30"
              aria-label="หน้าก่อน"
            >
              <Icon name="chevronLeft" size={16} />
            </button>
            <span className="tabular-nums">
              {current + 1} / {pages}
            </span>
            <button
              type="button"
              onClick={() => go(current + 1)}
              disabled={current >= pages - 1}
              className="grid h-7 w-7 place-items-center rounded-lg text-navy hover:bg-sky/50 disabled:opacity-30"
              aria-label="หน้าถัดไป"
            >
              <Icon name="chevronRight" size={16} />
            </button>
          </span>
        )}
      </footer>
    </div>
  );
}
