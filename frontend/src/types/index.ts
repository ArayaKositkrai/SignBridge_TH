// ชนิดข้อมูลที่ใช้ร่วมกันทั้งแอป (landmark ผลแปล ท่าทางอวตาร)

import type { IconName } from "../components/ui/Icon";

// จุดหนึ่งจุดบนภาพ (พิกัด 0-1)
export interface Point {
  x: number;
  y: number;
  z?: number;
  // ความมั่นใจว่าจุดนี้มองเห็นจริง 0-1 (มีเฉพาะจุดของ pose)
  visibility?: number;
}

// จุด landmark ของหนึ่งเฟรม: ลำตัว มือซ้าย มือขวา ใบหน้า
export interface LandmarkFrame {
  pose: Point[];
  leftHand: Point[];
  rightHand: Point[];
  face: Point[];
  // จุดสำคัญของใบหน้าตาม FACE_KEYPOINTS (มีเฉพาะตอนเล่นคลิปที่เก็บไว้ ซึ่งไม่มีใบหน้าเต็ม)
  faceKeypoints?: Point[];
}

// คำที่ใกล้เคียงกับผลแปลหลัก
export interface SignCandidate {
  text: string;
  confidence: number;
}

// ผลการแปลท่าภาษามือจาก backend
export interface SignResult {
  text: string;
  confidence: number;
  candidates: SignCandidate[];
  // เวอร์ชันโมเดลที่ใช้ (null = ยังไม่มีโมเดล)
  model?: string | null;
  // ข้อความแจ้งจากระบบ เช่น ยังไม่มีโมเดลที่ใช้งาน
  notice?: string;
  // คำที่ระบบตัดสินแล้วว่าได้คำ (ส่งมาครั้งเดียวต่อคำ ให้ต่อเข้าประโยค) null = ยังไม่ได้คำใหม่
  word?: string | null;
  // true = กำลังดูท่าอยู่ ยังไม่มั่นใจพอจะนับเป็นคำ
  pending?: boolean;
}

// สถานะการเชื่อมต่อ WebSocket
export type SocketStatus = "connecting" | "open" | "closed";

// ท่ามือหนึ่งข้าง: ตำแหน่งข้อมือ x,y มุม a และการงอนิ้ว c
// ท่าทางของหนึ่งคำ: ระยะเวลา keyframe มือ และสีหน้า
//   z = มือยื่นไปข้างหน้าลำตัวเท่าไร (มีเฉพาะท่าจากข้อมูลจริง ซึ่งวางมือตามตำแหน่งบนจอตรง ๆ และหันนิ้วตามมุม a)
export interface MotionHand {
  x: number;
  y: number;
  a: number;
  c: number[];
  z?: number;
  // ทิศฝ่ามือจากข้อมูลจริง: w = [แนวกว้างฝ่ามือบนจอ x, y, สัดส่วนที่เห็นเต็มฝ่า 0-1], p = +1 ฝ่ามือหันเข้ากล้อง / -1 หลังมือ
  w?: [number, number, number];
  p?: number;
  // มุมงอรายข้อ (เรเดียน) ของนิ้วชี้ กลาง นาง ก้อย (4 นิ้ว x 3 ข้อ โคน-กลาง-ปลาย) มีเฉพาะท่าจากคลิป 3 มิติ ถ้าไม่มีใช้ c แทน
  j?: number[][];
  // มุมกางนิ้ว (เรเดียน) ของนิ้วชี้ นาง ก้อย: บวก = กางออกจากนิ้วกลาง
  s?: number[];
}

// keyframe ของมือทั้งสองข้าง ณ เวลา t (0-1)
export interface MotionFrame {
  t: number;
  r?: MotionHand;
  l?: MotionHand;
}

// keyframe สีหน้าและการขยับศีรษะ ณ เวลา t (0-1)
export interface FaceFrame {
  t: number;
  brow?: number;
  tilt?: number;
  eye?: number;
  smile?: number;
  open?: number;
  hx?: number;
  hy?: number;
  rot?: number;
}

// ที่มาของท่า: ชุดข้อมูล/ล่าม/คลิปที่ใช้สร้าง keyframe (dataset "เขียนมือ…" = ยังไม่มีข้อมูลจริง)
export interface MotionSource {
  dataset: string;
  signer?: string;
  clip?: string;
}

// ท่าทางของหนึ่งคำ: ระยะเวลา keyframe มือ สีหน้า และที่มาของท่า
export interface Motion {
  duration: number;
  frames: MotionFrame[];
  face?: FaceFrame[];
  source?: MotionSource;
}

// คลิปภาษามือของหนึ่งคำ (มีวิดีโอ หรือมีท่าทางให้ตัวละครทำ)
export interface SignClip {
  gloss: string;
  word: string;
  url: string | null;
  motion?: Motion | null;
}

// ผลตอบจาก /api/text-to-sign
export interface TextToSignResponse {
  tokens: string[];
  clips: SignClip[];
  // คำที่ระบบแก้ให้ (typo = พิมพ์ผิด, alias = คำเรียกอื่น) พร้อมคำอื่นที่อาจหมายถึง
  fixes?: { typed: string; word: string; kind: "typo" | "alias"; alternatives: string[] }[];
  // คำไทยปกติที่อวตารยังไม่มีท่า (ข้ามไป)
  no_sign?: string[];
  // ส่วนที่อ่านไม่ออก พร้อมคำใกล้เคียงให้เลือก
  unknown?: { text: string; suggestions: string[] }[];
}

// ปุ่มวลีฉุกเฉินหนึ่งปุ่ม (custom = ผู้ใช้เพิ่มเอง, icon "more" = ปุ่มเพิ่มคำใหม่)
export interface EmergencyPhrase {
  id: string;
  label: string;
  speak: string;
  icon: IconName | "more";
  custom?: boolean;
}
