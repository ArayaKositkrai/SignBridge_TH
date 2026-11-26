// เก็บ event การใช้งานบนหน้าเว็บแล้วทยอยส่งไป backend (log)

import { API_URL } from "../config/env";

// ประเภท event จากหน้าเว็บ: กดปุ่ม หรือเปิดหน้า
type Kind = "ปุ่ม" | "เปิดหน้า";

// event หนึ่งรายการที่รอส่ง
interface PendingEvent {
  action: string;
  detail?: string;
  page: string;
  kind: Kind;
  ts: string;
}

// key ที่จำรหัสเครื่องไว้ในเบราว์เซอร์
const DEVICE_KEY = "signbridge.device";
// ส่ง event ที่ค้างทุกกี่มิลลิวินาที
const FLUSH_MS = 3000;
// จำนวน event สูงสุดต่อครั้ง (ตรงกับ backend)
const BATCH = 50;
// ที่อยู่ API รับ event
const EVENTS_URL = `${API_URL}/api/logs/events`;

// คิว event ที่ยังไม่ได้ส่ง
const queue: PendingEvent[] = [];
// ตัวจับเวลาส่ง event
let timer: number | undefined;
// รหัสเครื่องที่อ่านแล้ว
let cachedDevice: string | null = null;

// รหัสสุ่มประจำเบราว์เซอร์ (ใช้แยกเครื่องใน log เพราะยังไม่มีล็อกอิน)
export function deviceId(): string {
  if (cachedDevice) return cachedDevice;
  let id: string | null = null;
  try {
    id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      localStorage.setItem(DEVICE_KEY, id);
    }
  } catch {
    id = id ?? Math.random().toString(36).slice(2, 10);
  }
  cachedDevice = id;
  return id;
}

// header ที่แนบไปกับทุกคำขอ: รหัสเครื่อง และหน้าที่กำลังใช้ (backend ใช้บันทึก log)
export function logHeaders(): Record<string, string> {
  return { "X-Device-Id": deviceId(), "X-Page": window.location.pathname };
}

// เวลาท้องถิ่นแบบ ISO (ให้ตรงกับเวลาที่ backend บันทึก)
function localIso(d = new Date()): string {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 19);
}

// ส่ง event ที่ค้างทั้งหมด (beacon = ตอนปิดหน้า ใช้ sendBeacon เพื่อให้ส่งทันแน่นอน)
function flush(beacon = false) {
  window.clearTimeout(timer);
  timer = undefined;
  while (queue.length) {
    const events = queue.splice(0, BATCH);
    const body = JSON.stringify({ events, device: deviceId() });
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(EVENTS_URL, new Blob([body], { type: "application/json" }));
    } else {
      void fetch(EVENTS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...logHeaders() },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
  }
}

// บันทึกการกดปุ่ม/การกระทำ (เก็บแค่ชื่อปุ่ม/การกระทำ ห้ามส่งข้อความที่ผู้ใช้พิมพ์)
export function logEvent(action: string, detail?: string, kind: Kind = "ปุ่ม") {
  queue.push({ action, detail, page: window.location.pathname, kind, ts: localIso() });
  if (queue.length >= BATCH) flush();
  else if (timer === undefined) timer = window.setTimeout(() => flush(), FLUSH_MS);
}

// ส่ง event ที่ค้างตอนผู้ใช้ปิดหรือสลับแท็บ
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush(true));
}
