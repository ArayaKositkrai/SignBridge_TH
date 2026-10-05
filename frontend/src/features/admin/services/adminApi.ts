import { API_URL } from "../../../config/env";
import { send, type ModelsBrief, type SampleMeta, type VocabEntry, type WordStats } from "../../contributor/services/contributorApi";

// ที่อยู่ API ของหน้าแอดมิน
const BASE = `${API_URL}/api/admin`;

// บทบาทผู้ใช้: แอดมิน ล่าม (อัดคลิป) ผู้ใช้ทั่วไป
export type Role = "admin" | "contributor" | "user";

// ผู้ใช้หนึ่งคน
export interface User {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  active: boolean;
  created_at: string;
}

// ข้อมูลภาพรวมบนแดชบอร์ด
export interface Dashboard {
  totals: {
    words: number;
    samples: number;
    frames: number;
    duration_ms: number;
    signers: number;
    users: number;
    without_landmarks: number;
    hand_rate: number;
  };
  words: WordStats[];
  signers: { name: string; samples: number }[];
  recent: SampleMeta[];
  model: { active_version: string | null; draft_version: string | null; words: string[] };
}

// คำหนึ่งคำในคลังรวม: ข้อมูลที่อัด อยู่ในโมเดลไหน และมีท่าอวตารหรือไม่
export interface VocabItem extends VocabEntry {
  in_active_model: boolean;
  in_draft_model: boolean;
  avatar: { has_motion: boolean; has_clip: boolean } | null;
}

// ไฟล์โมเดลหนึ่งเวอร์ชัน
export interface ModelFile {
  version: string;
  label: string;
  words: number | null;
  samples: number | null;
  val_accuracy?: number | null;
  val_top3?: number | null;
  bytes: number;
  modified_at: string;
  active: boolean;
  draft: boolean;
}

// สถานะการเทรนโมเดลและเวอร์ชันปัจจุบัน
export interface TrainStatus {
  status: "idle" | "running" | "succeeded" | "failed";
  return_code: number | null;
  started_at: string | null;
  log: string[];
  active_version: string | null;
  draft_version: string | null;
}

// ส่ง JSON ไปพร้อม header ที่ถูกต้อง
const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

// ดึงข้อมูลแดชบอร์ด
export const getDashboard = () => send<Dashboard>(`${BASE}/dashboard`);

// ดึงรายชื่อผู้ใช้
export const listUsers = () => send<{ users: User[] }>(`${BASE}/users`).then((r) => r.users);
// เพิ่มผู้ใช้
export const addUser = (name: string, role: Role) => send<User>(`${BASE}/users`, json("POST", { name, role }));
// แก้ไขบทบาท/สถานะผู้ใช้
export const updateUser = (id: string, changes: Partial<Pick<User, "role" | "active">>) =>
  send<User>(`${BASE}/users/${encodeURIComponent(id)}`, json("PATCH", changes));
// ลบผู้ใช้
export const deleteUser = (id: string) => send<void>(`${BASE}/users/${encodeURIComponent(id)}`, { method: "DELETE" });

// ดึงคลังคำศัพท์และท่ารวม
export const getVocabulary = () => send<{ items: VocabItem[]; models: ModelsBrief }>(`${BASE}/vocabulary`);

// ดึงรายการไฟล์โมเดล
export const listModels = () => send<{ models: ModelFile[] }>(`${BASE}/models`).then((r) => r.models);
// เลือกเวอร์ชันโมเดลที่ระบบใช้
export const setActiveModel = (version: string) =>
  send<{ message: string }>(`${BASE}/models/active`, json("POST", { version }));

// สั่งเทรนโมเดลในพื้นหลัง
export const startTraining = () => send<{ message: string }>(`${BASE}/train`, { method: "POST" });
// ดูสถานะการเทรน
export const getTrainStatus = () => send<TrainStatus>(`${BASE}/train/status`);
// เผยแพร่โมเดล draft ให้ผู้ใช้ทั่วไปใช้
export const publishModel = () => send<{ message: string }>(`${BASE}/publish`, { method: "POST" });

// แปลงชื่อไฟล์โมเดลเป็นเลขเวอร์ชันสั้น เช่น model_signBridge_v0.0.1.h5 → v0.0.1 (ไม่มีเลขเวอร์ชันคืนชื่อเดิม)
export function versionLabel(file: string | null | undefined): string | null {
  if (!file) return null;
  const m = /_v(\d+\.\d+\.\d+)\.[a-z0-9]+$/i.exec(file);
  return m ? `v${m[1]}` : file;
}

// log หนึ่งรายการ: ใคร ทำอะไร ที่หน้าไหน/ฟังก์ชันไหน ผลลัพธ์ และเครื่อง
export interface LogEntry {
  id: number;
  ts: string;
  actor: "แอดมิน" | "ล่าม" | "ผู้ใช้";
  kind: "ปุ่ม" | "ฟังก์ชัน" | "เปิดหน้า";
  action: string;
  detail: string | null;
  page: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  device: string | null;
  ip: string | null;
  // ผู้ใช้ที่ล็อกอินตอนทำ (null = ไม่ได้ล็อกอิน)
  user_id: string | null;
  user_name: string | null;
}

// ตัวกรอง log
export interface LogFilter {
  actor?: string;
  kind?: string;
  q?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

// แปลงตัวกรองเป็น query string (ข้ามช่องที่ว่าง)
const logQuery = (f: LogFilter) =>
  new URLSearchParams(
    Object.entries(f)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();

// ดึงรายการ log ตามตัวกรอง พร้อมจำนวนทั้งหมด และจำนวนวันนี้แยกตามผู้ทำ
export const listLogs = (f: LogFilter) =>
  send<{ items: LogEntry[]; total: number; today: Record<string, number> }>(`${BASE}/logs?${logQuery(f)}`);

// ลิงก์ดาวน์โหลด log ตามตัวกรองเป็นไฟล์ CSV
export const logsCsvUrl = (f: LogFilter) => `${BASE}/logs/export.csv?${logQuery({ ...f, limit: undefined, offset: undefined })}`;
