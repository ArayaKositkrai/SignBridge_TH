// จุดหนึ่งจุดบนภาพ (พิกัด 0-1)
export interface Point {
  x: number;
  y: number;
  z?: number;
}

// จุด landmark ของหนึ่งเฟรม: ลำตัว มือซ้าย มือขวา ใบหน้า
export interface LandmarkFrame {
  pose: Point[];
  leftHand: Point[];
  rightHand: Point[];
  face: Point[];
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
}

// สถานะการเชื่อมต่อ WebSocket
export type SocketStatus = "connecting" | "open" | "closed";

// ท่ามือหนึ่งข้าง: ตำแหน่งข้อมือ x,y มุม a และการงอนิ้ว c
// ท่าทางของหนึ่งคำ: ระยะเวลา keyframe มือ และสีหน้า
export interface MotionHand {
  x: number;
  y: number;
  a: number;
  c: number[];
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

export interface Motion {
  duration: number;
  frames: MotionFrame[];
  face?: FaceFrame[];
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
}

// ปุ่มวลีฉุกเฉินหนึ่งปุ่ม (custom = ผู้ใช้เพิ่มเอง)
export interface EmergencyPhrase {
  id: string;
  label: string;
  speak: string;
  icon: "food" | "toilet" | "pain" | "water" | "confused" | "star" | "more";
  custom?: boolean;
}
