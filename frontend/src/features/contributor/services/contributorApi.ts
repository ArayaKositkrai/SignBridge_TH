import { API_URL } from "../../../config/env";
import { logHeaders } from "../../../lib/activityLog";
import type { Point } from "../../../types";

// ที่อยู่ API ของหน้า contributor
const BASE = `${API_URL}/api/contributor`;

// landmarks หนึ่งเฟรมที่เก็บไปเทรน (t = มิลลิวินาทีนับจากเริ่มอัด, ไม่เก็บใบหน้าเพื่อลดขนาดไฟล์)
export interface CapturedFrame {
  t: number;
  pose: Point[];
  leftHand: Point[];
  rightHand: Point[];
  // จุดสำคัญของใบหน้า ตามลำดับ FACE_KEYPOINTS (ว่าง = ไม่เห็นหน้า)
  face?: Point[];
}

// ข้อมูลสรุปของคลิปที่บันทึกแล้ว (fps = อัตราเฟรมของ skeleton)
export interface SampleMeta {
  id: string;
  word: string;
  source: "record" | "upload";
  signer: string | null;
  video: string | null;
  video_bytes: number;
  fps: number | null;
  camera_fps?: number | null;
  duration_ms: number | null;
  width?: number | null;
  height?: number | null;
  frame_count: number;
  lh_present_rate?: number;
  rh_present_rate?: number;
  created_at: string;
}

// สถิติของคำหนึ่งคำ: คลิป เฟรม ความยาวรวม ผู้แสดง และความครบของมือ
export interface WordStats {
  word: string;
  samples: number;
  frames: number;
  duration_ms: number;
  signers: string[];
  without_landmarks: number;
  hand_rate: number;
  updated_at: string | null;
}

// สถานะของคำในโมเดลหนึ่งเวอร์ชัน: อยู่ในโมเดลไหม และทายถูกกี่ส่วน (ทดสอบกับคนใหม่, null = ไม่ได้วัด)
export interface WordInModel {
  included: boolean;
  accuracy: number | null;
}

// สถานะของคำในโมเดลที่ใช้งานและ draft
export interface WordModelStatus {
  active: WordInModel;
  draft: WordInModel;
}

// ข้อมูลสรุปโมเดลหนึ่งเวอร์ชัน
export interface ModelBrief {
  file: string | null;
  label: string | null;
  val_accuracy: number | null;
  val_top3: number | null;
  trained_at: string | null;
  word_count: number;
}

// โมเดลที่ใช้งานและ draft
export interface ModelsBrief {
  active: ModelBrief;
  draft: ModelBrief;
}

// คำหนึ่งคำในคลังคำศัพท์: หมวด ความสำคัญ ต้องอัดเองไหม คลิปในชุดข้อมูล TSL และคลิปที่อัดแล้ว
export interface VocabEntry {
  word: string;
  category: string | null;
  priority: "สูง" | "กลาง" | "ต่ำ" | null;
  assigned?: string | null;
  note?: string | null;
  to_record: boolean;
  external: Record<string, { clips: number; signers: number }>;
  data: WordStats | null;
  model?: WordModelStatus;
}

// ส่งคำขอแล้วแปลงผลเป็น JSON ถ้าผิดพลาดโยน Error พร้อมข้อความ detail จาก backend
// ส่ง cookie session ไปด้วยทุกครั้ง (credentials: include)
export async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = { ...logHeaders(), ...(init?.headers as Record<string, string> | undefined) };
  const res = await fetch(url.startsWith("http") ? url : `${BASE}${url}`, { credentials: "include", ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(typeof body?.detail === "string" ? body.detail : `เกิดข้อผิดพลาด (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

// ใส่คำศัพท์ลง URL อย่างปลอดภัย
const enc = encodeURIComponent;

// ดึงรายการคำศัพท์ที่มีคลิปแล้ว
export const listWords = () => send<{ words: WordStats[] }>("/words").then((r) => r.words);

// ดึงคลังคำศัพท์ทั้งหมด
export const listVocabulary = () => send<{ items: VocabEntry[]; models: ModelsBrief }>("/vocabulary");

// ดึงรายการคลิปของคำหนึ่งคำ
export const listSamples = (word: string) =>
  send<{ samples: SampleMeta[] }>(`/samples/${enc(word)}`).then((r) => r.samples);

// ลิงก์สำหรับเล่นวิดีโอของคลิปที่บันทึกแล้ว
export const sampleVideoUrl = (word: string, id: string) =>
  `${BASE}/samples/${enc(word)}/${enc(id)}/video`;

// ดึง skeleton ของคลิป (ไว้วาดทับวิดีโอตอนดูจอใหญ่)
export const getSampleLandmarks = (word: string, id: string) =>
  send<CapturedFrame[]>(`/samples/${enc(word)}/${enc(id)}/landmarks`);

// ลบคลิป
export const deleteSample = (word: string, id: string) =>
  send<void>(`/samples/${enc(word)}/${enc(id)}`, { method: "DELETE" });

// ข้อมูลที่ใช้บันทึกคลิปใหม่
interface UploadArgs {
  word: string;
  source: "record" | "upload";
  signer: string | null;
  // null = ไม่มีวิดีโอ (ไฟล์ .npy/.npz) เก็บเฉพาะ skeleton
  video: Blob | null;
  fileName: string;
  frames: CapturedFrame[];
  fps: number;
  cameraFps: number | null;
  durationMs: number;
  width: number;
  height: number;
}

// อัปโหลดคลิปใหม่: วิดีโอ (ไว้เปิดดูซ้ำ) + skeleton (ใช้เทรน) และขนาดภาพไว้คำนวณสัดส่วนตอนเทรน
export function uploadSample(a: UploadArgs) {
  if (!a.frames.length) return Promise.reject(new Error("ไม่พบท่าทางในคลิป (ต้องเห็นตัวคนในวิดีโอ)"));
  const form = new FormData();
  form.append("word", a.word);
  form.append("source", a.source);
  if (a.signer) form.append("signer", a.signer);
  form.append("fps", String(a.fps));
  if (a.width && a.height) {
    form.append("width", String(a.width));
    form.append("height", String(a.height));
  }
  const json = new Blob([JSON.stringify(a.frames)], { type: "application/json" });
  form.append("landmarks", json, "landmarks.json");
  if (a.video) form.append("video", a.video, a.fileName);
  return send<SampleMeta>("/samples", { method: "POST", body: form });
}
