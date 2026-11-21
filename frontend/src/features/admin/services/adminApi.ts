import { API_URL } from "../../../config/env";
import { send, type ModelsBrief, type SampleMeta, type VocabEntry, type WordStats } from "../../contributor/services/contributorApi";

// ที่อยู่ API ของหน้าแอดมิน
const BASE = `${API_URL}/api/admin`;

// บทบาทผู้ใช้: แอดมิน ล่าม (อัดคลิป) ผู้ใช้ทั่วไป
export type Role = "admin" | "contributor" | "user";

// ผู้ใช้หนึ่งคน (ล่ามได้แค่ id/name/role/active ช่องอื่นมีเฉพาะแอดมิน)
export interface User {
  id: string;
  name: string;
  first_name?: string;
  last_name?: string | null;
  email?: string | null;
  role: Role;
  active: boolean;
  phone?: string | null;
  // เลขบัตรคนพิการแบบเต็ม (แอดมินเท่านั้น)
  disability_card_number?: string | null;
  has_card_image?: boolean;
  // false = ยังไม่มีบัญชีเข้าสู่ระบบ (แอดมินเพิ่มเอง) ใส่อีเมลไว้ได้ ล็อกอินด้วย Google อีเมลนั้นแล้วจะเข้าบัญชีนี้
  can_login?: boolean;
  created_at?: string;
  last_login_at?: string | null;
  // คลิปที่คนนี้อัด (ในฐานะล่าม) ใช้เป็นชุดเทรนหรือชุดเทส (ผู้ใช้ทั่วไป = null)
  split?: Split | null;
  // จำนวนคลิปที่อัดไว้ในชื่อนี้ (เฉพาะแอดมิน)
  clips?: number | null;
}

// ชุดข้อมูลของคลิป: เทรน (ให้โมเดลเรียน) หรือทดสอบ (กันไว้วัดความแม่นยำ)
export type Split = "train" | "test";

// ช่องที่แอดมินแก้ไขผู้ใช้ได้
export type UserChanges = Partial<
  Pick<User, "role" | "active" | "first_name" | "last_name" | "phone" | "disability_card_number" | "email">
>;

// ล่ามหนึ่งคนในหน้าชุดเทส (ดูอย่างเดียว)
//   reason: random = ระบบสุ่ม (ชุด TSL), user = ตั้งเป็นทดสอบในหน้าผู้ใช้, clips = บางคลิปถูกตั้งเป็นทดสอบรายคลิป, null = ใช้เทรน
export interface SplitSigner {
  id: string;
  name: string;
  source: string;
  clips: number;
  test_clips: number;
  words: number;
  test: boolean;
  reason: "random" | "user" | "clips" | null;
}

// ภาพรวมชุดเทส: ล่ามในชุดเทสของการเทรนครั้งถัดไป คลิป/คำกี่ตัว และคำที่ไม่มีคลิปทดสอบ/ไม่เหลือให้เทรน
export interface TestSplit {
  signers: SplitSigner[];
  total_clips: number;
  test_clips: number;
  words: number;
  words_without_test: string[];
  words_without_train: string[];
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
  // เลือกไว้เทรนโมเดลหรือไม่ (ติ๊กในคอลัมน์ "เทรน")
  in_train_set: boolean;
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
  // false = เทรนด้วยรูปแบบข้อมูล (feature) เก่า โหลดใช้ไม่ได้แล้ว
  compatible?: boolean;
  // ไม่มีไฟล์โมเดลในเครื่องเซิร์ฟเวอร์
  file_missing?: boolean;
  // สรุปตัวชี้วัดตอนเทรน (ชุดเทสตอนนั้น) และ Run Test (ชุดเทสปัจจุบัน) — null = ยังไม่มีผล
  validation?: MetricSummary | null;
  test?: MetricSummary | null;
}

// ค่าหลักของตัวชี้วัด (ดู ml/src/metrics.py) ค่าเป็นสัดส่วน 0-1
export interface MetricSummary {
  clips?: number;
  accuracy?: number;
  top3?: number;
  precision?: number;
  recall?: number;
  f1?: number;
  // เกณฑ์ความมั่นใจที่ตัวแปลใช้ตัดสินว่า "ได้คำ"
  threshold?: number;
  // ตอนไม่ได้ทำท่า ระบบพูดเป็นคำกี่ % (null = ชุดเทสไม่มีคลิป "ไม่ทำท่า")
  null_false_alarm?: number | null;
  // ตอนทำท่าจริง ระบบไม่พูดอะไรกี่ %
  word_dropped?: number | null;
  test_set_id?: string;
  evaluated_at?: string;
  excluded_clips?: number;
  // Run Test: โมเดลเคยเห็นชุดเทสนี้ตอนเทรน (ผลสูงเกินจริง)
  seen_test?: boolean;
  // ตอนเทรน: รอบสุดท้ายกันชุดเทสออก (Run Test เชื่อได้)
  final_excludes_test?: boolean;
}

// ตัวชี้วัดเต็มของชุดหนึ่ง (ตอนเทรนหรือ Run Test)
export interface MetricDetail extends MetricSummary {
  per_word?: Record<string, { recall: number; precision: number; f1: number; clips: number }>;
  confusions?: { true: string; pred: string; count: number; rate: number }[];
  threshold_curve?: { threshold: number; precision: number; recall: number; f1: number; null_false_alarm: number | null; word_dropped?: number | null }[];
  confidence?: { bins: number[]; correct: number[]; wrong: number[] };
  has_null_class?: boolean;
  no_train_words?: string[];
  // ตอนไม่ได้ทำท่า คำไหนเผลอขึ้นมาบ่อยที่สุด (rate = สัดส่วนของคลิป "ไม่ทำท่า")
  false_alarm_words?: { word: string; count: number; rate: number }[];
  // ทำท่าคำนี้แล้วระบบเงียบกี่คลิป (rate = สัดส่วนของคลิปคำนี้)
  dropped_words?: { word: string; count: number; clips: number; rate: number }[];
}

// ตัวชี้วัดเต็มของโมเดลหนึ่งเวอร์ชัน
export interface ModelMetrics {
  version: string;
  file: string;
  validation?: MetricDetail;
  test?: MetricDetail;
}

// สถานะการเทรนโมเดลและเวอร์ชันปัจจุบัน
// ความคืบหน้าที่ train.py รายงาน: ขั้น (load/validate/final/save/done/failed) รอบที่ ค่า loss และความแม่นยำ
export interface TrainProgress {
  stage?: "load" | "validate" | "final" | "save" | "motions" | "done" | "failed";
  // ผลขั้นสร้างท่าอวตารท้ายการเทรน (ไม่มีค่า = เทรนจากเครื่องรุ่นเก่าที่ไม่มีขั้นนี้)
  motions_ok?: boolean;
  epoch?: number;
  epochs?: number;
  loss?: number;
  val_accuracy?: number;
  val_top3?: number;
}

// การเทรนล่าสุด (รันจากเครื่องด้วย python train.py): เครื่องที่เทรน เวลา ความคืบหน้า ข้อผิดพลาด โมเดลที่ได้ และ log ท้าย ๆ
export interface TrainRun {
  id: number;
  host: string | null;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  progress: TrainProgress;
  error: string | null;
  model: string | null;
  log: string[];
}

// สถานะการเทรน (stalled = เงียบไปนานเกินไป เช่นเครื่องที่เทรนปิดไป) และคำสั่งที่ใช้เทรน
export interface TrainStatus {
  status: "idle" | "running" | "stalled" | "succeeded" | "failed";
  command: string;
  // เครื่อง backend เทรนเองได้ไหม (มี torch) — ไม่ได้ = ต้องรันคำสั่งเทรนจากเครื่อง
  can_train_here?: boolean;
  // Run Test ที่สั่งจากหน้าเว็บ
  evaluation?: { status: "idle" | "running" | "succeeded" | "failed"; log: string[] };
  run: TrainRun | null;
  active_version: string | null;
  draft_version: string | null;
}

// log การเทรนของโมเดลหนึ่งเวอร์ชัน (run = null ถ้าไม่มีบันทึกการเทรน)
export interface ModelTrainLog {
  version: string;
  run: Omit<TrainRun, "model" | "heartbeat_at"> | null;
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
// รายชื่อผู้ใช้ พร้อมชุดข้อมูลของคลิปที่อัดโดยไม่ระบุล่าม (ใช้ในหน้าอัดคลิป)
export const listSigners = () => send<{ users: User[]; unknown_split: Split }>(`${BASE}/users`);
// ตั้งคลิปทั้งหมดของล่ามคนนี้เป็นชุดเทรน/ทดสอบ (มีผลตอนเทรนครั้งถัดไป)
export const setUserSplit = (id: string, split: Split) =>
  send<User>(`${BASE}/users/${encodeURIComponent(id)}/split`, json("PUT", { split }));
// เพิ่มผู้ใช้
export const addUser = (name: string, role: Role) => send<User>(`${BASE}/users`, json("POST", { name, role }));
// แก้ไขข้อมูลผู้ใช้ (บทบาท สถานะ ชื่อ เบอร์ เลขบัตร)
export const updateUser = (id: string, changes: UserChanges) =>
  send<User>(`${BASE}/users/${encodeURIComponent(id)}`, json("PATCH", changes));
// ลบผู้ใช้
export const deleteUser = (id: string) => send<void>(`${BASE}/users/${encodeURIComponent(id)}`, { method: "DELETE" });

// ดึงรูปบัตรคนพิการของผู้ใช้เป็น blob URL (รูปส่วนตัว ดึงผ่าน backend พร้อม cookie ไม่ใช้ลิงก์สาธารณะ)
export async function userCardImage(id: string): Promise<string> {
  const res = await fetch(`${BASE}/users/${encodeURIComponent(id)}/card-image`, { credentials: "include" });
  if (!res.ok) throw new Error(res.status === 404 ? "ยังไม่มีรูปบัตร" : `โหลดรูปไม่สำเร็จ (${res.status})`);
  return URL.createObjectURL(await res.blob());
}

// ดูล่ามทุกคนและชุดเทสที่เลือก
// ตั้งคลิปที่ล่ามอัดเป็นชุดเทรน/ทดสอบ
export const setSampleSplit = (id: string, split: "train" | "test") =>
  send<{ id: string; split: string }>(`${BASE}/samples/${encodeURIComponent(id)}`, json("PATCH", { split }));

// ดึงคลังคำศัพท์และท่ารวม
export const getVocabulary = () => send<{ items: VocabItem[]; models: ModelsBrief }>(`${BASE}/vocabulary`);

// เพิ่มคำใหม่เข้าคลัง
export const addWord = (word: string, category: string, toRecord: boolean) =>
  send<{ word: string }>(`${BASE}/vocabulary`, json("POST", { word, category, to_record: toRecord }));

// เลือก/ไม่เลือกคำไว้เทรนโมเดล (มีผลในการเทรนครั้งถัดไป)
export const setTrainWord = (word: string, inTrainSet: boolean) =>
  send<{ word: string; in_train_set: boolean }>(
    `${BASE}/vocabulary/${encodeURIComponent(word)}`,
    json("PATCH", { in_train_set: inTrainSet }),
  );

// เลือก/ไม่เลือกหลายคำไว้เทรนพร้อมกัน
export const setTrainWords = (words: string[], inTrainSet: boolean) =>
  send<{ updated: number; in_train_set: boolean }>(
    `${BASE}/vocabulary/train-set`,
    json("POST", { words, in_train_set: inTrainSet }),
  );

// ล่ามในชุดเทสของการเทรนครั้งถัดไป (ดูอย่างเดียว)
export const getTestSplit = () => send<TestSplit>(`${BASE}/test-split`);

// ดึงรายการไฟล์โมเดล
export const listModels = () => send<{ models: ModelFile[] }>(`${BASE}/models`).then((r) => r.models);
// เลือกเวอร์ชันโมเดลที่ระบบใช้
export const setActiveModel = (version: string) =>
  send<{ message: string }>(`${BASE}/models/active`, json("POST", { version }));

// ดูสถานะการเทรน
export const getTrainStatus = () => send<TrainStatus>(`${BASE}/train/status`);
// ตัวชี้วัดเต็มของโมเดลหนึ่งเวอร์ชัน (ผลรายคำ คำที่สับสน กราฟความมั่นใจ)
export const getModelMetrics = (version: string) =>
  send<ModelMetrics>(`${BASE}/models/${encodeURIComponent(version)}/metrics`);
// วัดผลทุกเวอร์ชันด้วยชุดเทสปัจจุบัน (Run Test) ในพื้นหลัง
export const runModelTest = () => send<{ message: string }>(`${BASE}/models/evaluate`, { method: "POST" });
// สร้างท่าอวตารจาก skeleton จริง (ชุด TSL + คลิปที่อัด) ในพื้นหลัง และดูสถานะ
export interface MotionBuild {
  status: "idle" | "running" | "succeeded" | "failed";
  log: string[];
}
export const buildMotions = () => send<{ message: string }>(`${BASE}/motions/build`, { method: "POST" });
export const getMotionBuild = () => send<MotionBuild>(`${BASE}/motions/build`);

// ลบโมเดลหนึ่งเวอร์ชัน (ลบตัวที่ใช้งานอยู่ไม่ได้)
export const deleteModel = (version: string) =>
  send<void>(`${BASE}/models/${encodeURIComponent(version)}`, { method: "DELETE" });
// สั่งเทรนจากหน้าเว็บ (รัน train.py บนเครื่อง backend)
export const startTraining = () => send<{ message: string }>(`${BASE}/train`, { method: "POST" });
// ดู log การเทรนของโมเดลเวอร์ชันหนึ่ง
export const getModelTrainLog = (version: string) =>
  send<ModelTrainLog>(`${BASE}/models/${encodeURIComponent(version)}/train-log`);
// ยกเลิกการเทรนที่กำลังรันหรือขาดการติดต่อ
export const cancelTraining = () => send<{ message: string }>(`${BASE}/train/cancel`, { method: "POST" });
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
  // ซ่อน log การเปิดหน้า / เฉพาะที่ไม่สำเร็จ
  hide_pages?: boolean;
  failed?: boolean;
  limit?: number;
  offset?: number;
}

// แปลงตัวกรองเป็น query string (ข้ามช่องที่ว่าง)
const logQuery = (f: LogFilter) =>
  new URLSearchParams(
    Object.entries(f)
      .filter(([, v]) => v !== undefined && v !== "" && v !== false)
      .map(([k, v]) => [k, String(v)]),
  ).toString();

// ดึงรายการ log ตามตัวกรอง พร้อมจำนวนทั้งหมด และจำนวนวันนี้แยกตามผู้ทำ
export const listLogs = (f: LogFilter) =>
  send<{ items: LogEntry[]; total: number; today: Record<string, number>; today_summary: { failed: number; users: number } }>(
    `${BASE}/logs?${logQuery(f)}`,
  );

// ลิงก์ดาวน์โหลด log ตามตัวกรองเป็นไฟล์ CSV
export const logsCsvUrl = (f: LogFilter) => `${BASE}/logs/export.csv?${logQuery({ ...f, limit: undefined, offset: undefined })}`;
