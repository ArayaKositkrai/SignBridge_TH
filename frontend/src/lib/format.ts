// จัดรูปตัวเลขแบบมีคอมมา เช่น 12,345
export const fmtNumber = (n: number) => n.toLocaleString("th-TH");

// แปลงมิลลิวินาทีเป็นความยาวอ่านง่าย เช่น 2.2 วิ หรือ 3:05 นาที หรือ 1:02:03 ชม.
export function fmtDuration(ms: number) {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} วิ`;
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec} ชม.` : `${m}:${sec} นาที`;
}

// แปลงเวลา ISO เป็นวันที่และเวลาแบบไทยสั้น ๆ
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "-";

// แปลงสัดส่วน 0-1 เป็นเปอร์เซ็นต์จำนวนเต็ม
export const fmtPct = (r: number) => `${Math.round(r * 100)}%`;

// แปลงจำนวนไบต์เป็น KB / MB
export function fmtBytes(b: number) {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
