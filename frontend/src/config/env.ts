// ที่อยู่หน้าเว็บปัจจุบัน ใช้สร้างที่อยู่ backend อัตโนมัติเมื่อไม่ได้ตั้ง env
const loc = typeof window !== "undefined" ? window.location : undefined;
const host = loc?.hostname ?? "localhost";
// build จริง (npm run build) ที่ไม่ได้ตั้ง env = backend เสิร์ฟหน้าเว็บเอง อยู่โดเมนเดียวกัน (https → wss)
//   ตอนพัฒนา (npm run dev) = backend อยู่พอร์ต 8000 ของเครื่องเดียวกันเหมือนเดิม
const sameOrigin = import.meta.env.PROD && loc !== undefined;

// ที่อยู่ REST API ของ backend
export const API_URL: string =
  import.meta.env.VITE_API_URL ?? (sameOrigin ? loc.origin : `http://${host}:8000`);

// ที่อยู่ WebSocket ของ backend
export const WS_URL: string =
  import.meta.env.VITE_WS_URL ??
  (sameOrigin ? `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}` : `ws://${host}:8000`);

// ไฟล์ wasm ของ MediaPipe (โหลดจาก CDN)
export const MEDIAPIPE_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";

// โมเดลตรวจจับมือทั้งภาพ (ใช้เสริม Holistic ตอนหามือไม่เจอ)
export const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";

// โมเดล Holistic ตรวจจับตัว มือ และใบหน้า
export const HOLISTIC_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task";
