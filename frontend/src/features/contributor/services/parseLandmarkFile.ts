import { pickFaceKeypoints } from "../../../lib/mediapipe/faceKeypoints";
import type { Point } from "../../../types";
import type { CapturedFrame } from "./contributorApi";

// นามสกุลไฟล์ skeleton ที่อัปโหลดได้
export const LANDMARK_EXTS = [".npy", ".npz"];
// ขนาดไฟล์ skeleton สูงสุด (MB)
export const MAX_LANDMARK_FILE_MB = 50;
// จำนวนเฟรมสูงสุดต่อคลิป (ต้องตรงกับ MAX_FRAMES ของ backend)
const MAX_FRAMES = 2000;
// fps เริ่มต้นเมื่อไฟล์ไม่บอกเวลา
const DEFAULT_FPS = 30;
// พิกัดที่ยอมรับ (ภาพปกติอยู่ใน 0-1 เผื่อมือที่ล้นกรอบเล็กน้อย)
const COORD_LIMIT = 4;
// จำนวนจุดของ pose ใน MediaPipe
const POSE_N = 33;
// ลำดับจุดไหล่ ศอก ข้อมือของรูปแบบโปรเจกต์ (ตรงกับ MP_POSE_IDX ใน ml/src/features.py)
const PROJECT_POSE_IDX = [11, 12, 13, 14, 15, 16];

// ผลการอ่านไฟล์ skeleton: เฟรม ความยาว ขนาดภาพ (0 = ไม่ทราบ) และ fps
export interface ParsedLandmarks {
  frames: CapturedFrame[];
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  layout: string;
}

// อาร์เรย์ตัวเลขหนึ่งชุดจากไฟล์ .npy
interface NpyArray {
  shape: number[];
  data: Float64Array;
}

// อ่านไฟล์ .npy หนึ่งชุด (รองรับ little-endian float16/32/64 และจำนวนเต็ม)
function parseNpy(buf: ArrayBuffer): NpyArray {
  const bytes = new Uint8Array(buf);
  const magic = String.fromCharCode(...bytes.slice(1, 6));
  if (bytes[0] !== 0x93 || magic !== "NUMPY") throw new Error("ไฟล์ .npy ไม่ถูกต้อง");
  const view = new DataView(buf);
  const major = bytes[6];
  const headerLen = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
  const start = major === 1 ? 10 : 12;
  const header = new TextDecoder().decode(bytes.slice(start, start + headerLen));
  const descr = /'descr'\s*:\s*'([^']+)'/.exec(header)?.[1];
  const shapeText = /'shape'\s*:\s*\(([^)]*)\)/.exec(header)?.[1];
  if (!descr || shapeText === undefined) throw new Error("อ่านหัวไฟล์ .npy ไม่ได้");
  if (/'fortran_order'\s*:\s*True/.test(header)) throw new Error("ไม่รองรับ .npy แบบ fortran_order");
  const shape = shapeText.split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  const count = shape.reduce((a, b) => a * b, 1);
  const kind = descr.replace(/^[<>|=]/, "");
  if (descr.startsWith(">") && !kind.endsWith("1")) throw new Error("ไม่รองรับ .npy แบบ big-endian");
  const sizes: Record<string, number> = { f2: 2, f4: 4, f8: 8, i1: 1, i2: 2, i4: 4, i8: 8, u1: 1, u2: 2, u4: 4, u8: 8 };
  const size = sizes[kind];
  if (!size) throw new Error(`ไม่รองรับชนิดข้อมูล ${descr} (ใช้ float32/float64 หรือจำนวนเต็ม)`);
  const offset = start + headerLen;
  if (offset + count * size > buf.byteLength) throw new Error("ไฟล์ .npy ขนาดไม่ครบ");
  const data = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const p = offset + i * size;
    data[i] = readNumber(view, p, kind);
  }
  return { shape, data };
}

// อ่านตัวเลขหนึ่งค่าตามชนิดข้อมูลของ numpy
function readNumber(view: DataView, p: number, kind: string): number {
  switch (kind) {
    case "f4": return view.getFloat32(p, true);
    case "f8": return view.getFloat64(p, true);
    case "f2": return halfToFloat(view.getUint16(p, true));
    case "i1": return view.getInt8(p);
    case "u1": return view.getUint8(p);
    case "i2": return view.getInt16(p, true);
    case "u2": return view.getUint16(p, true);
    case "i4": return view.getInt32(p, true);
    case "u4": return view.getUint32(p, true);
    default: return Number(kind === "i8" ? view.getBigInt64(p, true) : view.getBigUint64(p, true));
  }
}

// แปลง float16 เป็นตัวเลขปกติ
function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 0x1f) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

// แตกไฟล์ .npz (zip) เป็น ชื่อ → อาร์เรย์ โดยใช้ DecompressionStream ของเบราว์เซอร์
async function parseNpz(buf: ArrayBuffer): Promise<Record<string, NpyArray>> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ไฟล์ .npz ไม่ถูกต้อง");
  const entries = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out: Record<string, NpyArray> = {};
  for (let n = 0; n < entries; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("ไฟล์ .npz ไม่ถูกต้อง");
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localAt = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.slice(p + 46, p + 46 + nameLen)).replace(/\.npy$/, "");
    p += 46 + nameLen + extraLen + commentLen;

    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    const raw = bytes.slice(dataAt, dataAt + compSize);
    let body: ArrayBuffer;
    if (method === 0) body = raw.buffer;
    else if (method === 8) body = await inflateRaw(raw);
    else throw new Error("ไฟล์ .npz ใช้การบีบอัดที่ไม่รองรับ");
    out[name] = parseNpy(body);
  }
  return out;
}

// ขยายข้อมูลแบบ deflate (ไม่มีหัว zlib)
async function inflateRaw(raw: Uint8Array): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === "undefined") throw new Error("เบราว์เซอร์นี้อ่าน .npz ที่บีบอัดไม่ได้ ลองใช้ Chrome หรือ Edge");
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).arrayBuffer();
}

// โครงของอาร์เรย์ที่รู้จัก: จำนวนจุด/ค่าต่อจุด และตำแหน่งของ pose มือซ้าย มือขวา ใบหน้า
interface Layout {
  name: string;
  pose?: [number, number];
  left?: [number, number];
  right?: [number, number];
  face?: [number, number];
  // pose แบบโปรเจกต์ (6 จุด: ไหล่ ศอก ข้อมือ)
  project?: boolean;
}

// รูปแบบที่ตรวจเจอจากจำนวนจุดต่อเฟรม
const POINT_LAYOUTS: Record<number, Layout> = {
  48: { name: "โปรเจกต์ (48 จุด)", project: true, pose: [0, 6], left: [6, 27], right: [27, 48] },
  75: { name: "MediaPipe pose+มือ (75 จุด)", pose: [0, 33], left: [33, 54], right: [54, 75] },
  543: { name: "MediaPipe holistic (543 จุด)", pose: [0, 33], face: [33, 501], left: [501, 522], right: [522, 543] },
  33: { name: "MediaPipe pose (33 จุด)", pose: [0, 33] },
  42: { name: "มือสองข้าง (42 จุด)", left: [0, 21], right: [21, 42] },
};

// รูปแบบที่แบนเป็นเวกเตอร์ต่อเฟรม (จำนวนค่าต่อเฟรม → ค่าต่อจุดของ pose และตำแหน่ง)
const FLAT_LAYOUTS: Record<number, { name: string; poseC: number; layout: Layout }> = {
  1662: { name: "pose132+face1404+มือ126", poseC: 4, layout: { name: "", pose: [0, 33], face: [33, 501], left: [501, 522], right: [522, 543] } },
  258: { name: "pose132+มือ126", poseC: 4, layout: { name: "", pose: [0, 33], left: [33, 54], right: [54, 75] } },
  225: { name: "75 จุด x3", poseC: 3, layout: { name: "", pose: [0, 33], left: [33, 54], right: [54, 75] } },
  132: { name: "pose 33 จุด x4", poseC: 4, layout: { name: "", pose: [0, 33] } },
  126: { name: "มือสองข้าง x3", poseC: 3, layout: { name: "", left: [0, 21], right: [21, 42] } },
  99: { name: "pose 33 จุด x3", poseC: 3, layout: { name: "", pose: [0, 33] } },
};

// จุดที่ใช้ไม่ได้ (NaN หรือศูนย์ทั้งหมดคือยังไม่ตรวจเจอ)
const isMissing = (x: number, y: number, z: number) =>
  !Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0 && (z === 0 || Number.isNaN(z)));

// อ่านรายการจุดจากช่วงของเวกเตอร์ (จุดที่ไม่พบเป็น null; ถ้าไม่พบทั้งช่วงคืนรายการว่าง)
function readPoints(get: (i: number) => [number, number, number], range: [number, number]): (Point | null)[] {
  const pts: (Point | null)[] = [];
  let missing = 0;
  for (let i = range[0]; i < range[1]; i++) {
    const [x, y, z] = get(i);
    if (isMissing(x, y, z)) {
      missing++;
      pts.push(null);
      continue;
    }
    if (Math.abs(x) > COORD_LIMIT || Math.abs(y) > COORD_LIMIT) {
      throw new Error("พิกัดต้องเป็นค่า 0-1 (normalized) ไม่ใช่พิกเซล");
    }
    // ไม่มีความลึก (z) ในไฟล์: ไม่ใส่ z เพื่อไม่ให้ถูกเข้าใจว่าเป็นความลึก 0
    pts.push(Number.isFinite(z) ? { x: round(x), y: round(y), z: round(z) } : { x: round(x), y: round(y) });
  }
  return missing === pts.length ? [] : pts;
}

// มือ/ใบหน้าต้องครบทุกจุดจึงใช้ได้ (ขาดจุดใดถือว่าไม่เห็น)
const complete = (pts: (Point | null)[]): Point[] => (pts.every(Boolean) ? (pts as Point[]) : []);

// ปัดทศนิยม 4 ตำแหน่ง ลดขนาดไฟล์
function round(v: number) {
  return Math.round(v * 1e4) / 1e4;
}

// เลือกอาร์เรย์หลักจาก .npz (ชื่อที่รู้จักก่อน ไม่งั้นใช้ตัวที่มี 3 มิติ)
function pickMain(arrays: Record<string, NpyArray>): NpyArray {
  for (const key of ["points", "landmarks", "keypoints", "skeleton", "data", "arr_0"]) {
    if (arrays[key]) return arrays[key];
  }
  const found = Object.values(arrays).find((a) => a.shape.length >= 2 && a.shape.length <= 3 && a.shape[0] > 1);
  if (!found) throw new Error("ไม่พบอาร์เรย์ skeleton ในไฟล์ .npz");
  return found;
}

// ค่าเดี่ยวจากอาร์เรย์สเกลาร์ใน .npz (เช่น aspect, fps)
const scalar = (arrays: Record<string, NpyArray>, key: string): number | null => {
  const v = arrays[key]?.data[0];
  return v !== undefined && Number.isFinite(v) && v > 0 ? v : null;
};

// แปลงอาร์เรย์เป็นเฟรมที่เก็บไปเทรนได้ (ตรวจรูปแบบจากรูปร่างอาร์เรย์อัตโนมัติ)
function toFrames(main: NpyArray, extra: Record<string, NpyArray>): ParsedLandmarks {
  const { shape, data } = main;
  if (shape.length < 2 || shape.length > 3) throw new Error(`รูปร่างอาร์เรย์ ${JSON.stringify(shape)} ไม่รองรับ`);
  const T = shape[0];
  if (!T) throw new Error("ไฟล์ไม่มีเฟรม");
  if (T > MAX_FRAMES) throw new Error(`ไฟล์มี ${T} เฟรม เกิน ${MAX_FRAMES} เฟรม กรุณาตัดให้สั้นลง`);

  let layout: Layout;
  let get: (t: number, i: number) => [number, number, number];
  if (shape.length === 3) {
    const [, N, C] = shape;
    layout = POINT_LAYOUTS[N];
    if (!layout) throw new Error(`ไม่รู้จักรูปแบบ ${N} จุดต่อเฟรม (รองรับ 33, 42, 48, 75, 543)`);
    if (C < 2 || C > 4) throw new Error(`แต่ละจุดต้องมี 2-4 ค่า (x,y,z,visibility) แต่ไฟล์มี ${C}`);
    get = (t, i) => {
      const b = (t * N + i) * C;
      return [data[b], data[b + 1], C > 2 ? data[b + 2] : Number.NaN];
    };
  } else {
    const flat = FLAT_LAYOUTS[shape[1]];
    if (!flat) throw new Error(`ไม่รู้จักรูปแบบเวกเตอร์ ${shape[1]} ค่าต่อเฟรม`);
    layout = { ...flat.layout, name: flat.name };
    const W = shape[1];
    const poseEnd = (flat.layout.pose?.[1] ?? 0) * flat.poseC;
    get = (t, i) => {
      // pose ใช้ poseC ค่าต่อจุด ส่วนที่เหลือใช้ 3 ค่าต่อจุด
      const b = t * W + (i < (flat.layout.pose?.[1] ?? 0) ? i * flat.poseC : poseEnd + (i - (flat.layout.pose?.[1] ?? 0)) * 3);
      return [data[b], data[b + 1], data[b + 2]];
    };
  }

  const fps = scalar(extra, "fps") ?? DEFAULT_FPS;
  const tMs = extra["t_ms"] ?? extra["t"];
  const hasTime = tMs !== undefined && tMs.data.length === T;
  const faceExtra = extra["face"];
  const frames: CapturedFrame[] = [];
  for (let t = 0; t < T; t++) {
    const at = (i: number) => get(t, i);
    // pose: รูปแบบโปรเจกต์มีแค่ 6 จุด จึงวางลงตำแหน่ง MediaPipe 33 จุด ช่องที่เหลือเป็น null (backend ใช้ 6 จุดนี้เท่านั้น)
    let pose: (Point | null)[] = layout.pose ? readPoints(at, layout.pose) : [];
    if (layout.project && pose.length) {
      const filled: (Point | null)[] = new Array(POSE_N).fill(null);
      PROJECT_POSE_IDX.forEach((idx, k) => (filled[idx] = pose[k]));
      pose = filled;
    }
    const left = layout.left ? complete(readPoints(at, layout.left)) : [];
    const right = layout.right ? complete(readPoints(at, layout.right)) : [];
    let face: Point[] = [];
    if (layout.face) face = pickFaceKeypoints(complete(readPoints(at, layout.face)));
    else if (faceExtra && faceExtra.shape.length === 3 && faceExtra.shape[0] === T && faceExtra.shape[2] >= 2) {
      const [, N, C] = faceExtra.shape;
      face = complete(
        readPoints((i) => {
          const b = (t * N + i) * C;
          return [faceExtra.data[b], faceExtra.data[b + 1], Number.NaN];
        }, [0, N]),
      );
    }
    frames.push({
      t: Math.round(hasTime ? tMs.data[t] : (t * 1000) / fps),
      pose: pose as Point[],
      leftHand: left,
      rightHand: right,
      face,
    });
  }

  const aspect = scalar(extra, "aspect");
  const durationMs = frames[frames.length - 1].t + 1000 / fps;
  return {
    frames,
    durationMs,
    width: aspect ? Math.round(aspect * 1000) : 0,
    height: aspect ? 1000 : 0,
    fps,
    layout: layout.name,
  };
}

// อ่านไฟล์ .npy/.npz แล้วแปลงเป็นเฟรม skeleton (ข้อผิดพลาดเป็นข้อความภาษาไทย)
export async function parseLandmarkFile(file: File): Promise<ParsedLandmarks> {
  if (file.size > MAX_LANDMARK_FILE_MB * 1024 * 1024) throw new Error(`ไฟล์ใหญ่เกิน ${MAX_LANDMARK_FILE_MB} MB`);
  const buf = await file.arrayBuffer();
  if (file.name.toLowerCase().endsWith(".npz")) {
    const arrays = await parseNpz(buf);
    return toFrames(pickMain(arrays), arrays);
  }
  return toFrames(parseNpy(buf), {});
}
