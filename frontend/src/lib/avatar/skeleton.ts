import type { FaceFrame, Motion, MotionHand, Point } from "../../types";

// ตำแหน่งและรัศมีศีรษะของตัวละคร (พิกัด 0-1)
export const HEAD = { x: 0.5, y: 0.2, r: 0.075 };
// ตำแหน่งไหล่ (r = มือขวาของตัวละคร วาดอยู่ฝั่งซ้ายของจอ)
export const SHOULDER = { r: { x: 0.4, y: 0.42 }, l: { x: 0.6, y: 0.42 } };
// ตำแหน่งสะโพก ใช้กำหนดปลายลำตัว
export const HIP = { r: { x: 0.44, y: 0.96 }, l: { x: 0.56, y: 0.96 } };
// ความยาวต้นแขน (หน่วยเดียวกับพิกัด 0-1; export ไว้ให้ avatar3d/rig.ts ใช้คำนวณสเกลกระดูกจริง)
export const UPPER_ARM = 0.21;
// ความยาวท่อนแขนล่าง
export const FOREARM = 0.2;

// ข้างของมือ: r = ขวา, l = ซ้าย
export type Side = "r" | "l";
// ท่ามือทั้งสองข้าง
export interface HandPair {
  r: MotionHand;
  l: MotionHand;
}

// การงอนิ้วเมื่อปล่อยมือตามสบาย
const relaxed = [0.3, 0.25, 0.25, 0.25, 0.25];
// ท่าพัก: ปล่อยมือห้อยข้างลำตัว
export const REST: HandPair = {
  r: { x: 0.38, y: 0.79, a: Math.PI, c: relaxed },
  l: { x: 0.62, y: 0.79, a: Math.PI, c: relaxed },
};

// ทำให้การเคลื่อนไหวเริ่มช้า เร็วตรงกลาง แล้วช้าลง (smoothstep)
const ease = (t: number) => t * t * (3 - 2 * t);
// ค่าระหว่าง a กับ b ตามสัดส่วน t
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ค่า z ของท่าพักเมื่อผสมกับท่าที่มี z (ท่าพักไม่มี z ของตัวเอง)
const REST_Z = 0.12;

// ผสมท่ามือสองท่าตามสัดส่วน t (z มีเมื่อท่าใดท่าหนึ่งมี z)
function mix(a: MotionHand, b: MotionHand, t: number): MotionHand {
  const out: MotionHand = {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    a: lerp(a.a, b.a, t),
    c: a.c.map((v, i) => lerp(v, b.c[i] ?? v, t)),
  };
  if (a.z !== undefined || b.z !== undefined) out.z = lerp(a.z ?? REST_Z, b.z ?? REST_Z, t);
  // ทิศฝ่ามือ: ใช้ของท่าที่มีข้อมูล (ท่าพักไม่มี) ถ้ามีทั้งคู่ผสมกัน และสลับด้านฝ่ามือที่ครึ่งทาง
  if (a.w && b.w) {
    out.w = [lerp(a.w[0], b.w[0], t), lerp(a.w[1], b.w[1], t), lerp(a.w[2], b.w[2], t)];
    out.p = t < 0.5 ? a.p : b.p;
  } else if (a.w || b.w) {
    out.w = a.w ?? b.w;
    out.p = a.w ? a.p : b.p;
  }
  return out;
}

// หาท่ามือ ณ เวลา t (0-1) ของคลิป โดยไล่ระหว่าง keyframe
/** Hands at time t (0..1) of a motion. Missing hands and the ends of the clip fall back to REST. */
export function sampleMotion(motion: Motion | null | undefined, t: number): HandPair {
  if (!motion || !motion.frames.length) return REST;
  const frames = [...motion.frames].sort((p, q) => p.t - q.t);
  const keys = frames.map((f) => ({ t: f.t, r: f.r ?? REST.r, l: f.l ?? REST.l }));
  if (keys[0].t > 0.001) keys.unshift({ t: 0, ...REST });
  if (keys[keys.length - 1].t < 0.999) keys.push({ t: 1, ...REST });

  const clamped = Math.min(Math.max(t, 0), 1);
  let i = 0;
  while (i < keys.length - 2 && clamped > keys[i + 1].t) i++;
  const k0 = keys[i];
  const k1 = keys[i + 1];
  const span = k1.t - k0.t || 1;
  const f = ease(Math.min(Math.max((clamped - k0.t) / span, 0), 1));
  return { r: mix(k0.r, k1.r, f), l: mix(k0.l, k1.l, f) };
}

// ตำแหน่งข้อศอกและข้อมือของแขนหนึ่งข้าง
export interface Arm {
  elbow: Point;
  wrist: Point;
}

// คำนวณข้อศอกจากไหล่ไปยังข้อมือ (IK) ให้แขนดูเป็นธรรมชาติ
function solveArm(side: Side, target: Point): Arm {
  const s = SHOULDER[side];
  let dx = target.x - s.x;
  let dy = target.y - s.y;
  const reach = UPPER_ARM + FOREARM - 0.004;
  let d = Math.hypot(dx, dy) || 0.001;
  d = Math.min(Math.max(d, 0.06), reach);
  const ux = dx / (Math.hypot(dx, dy) || 1);
  const uy = dy / (Math.hypot(dx, dy) || 1);
  dx = ux * d;
  dy = uy * d;

  const along = (UPPER_ARM ** 2 - FOREARM ** 2 + d ** 2) / (2 * d);
  const h = Math.sqrt(Math.max(UPPER_ARM ** 2 - along ** 2, 0));
  const mx = s.x + ux * along;
  const my = s.y + uy * along;
  const cands = [
    { x: mx - uy * h, y: my + ux * h },
    { x: mx + uy * h, y: my - ux * h },
  ];
  const outward = (p: Point) => (side === "r" ? -p.x : p.x);
  const score = (p: Point) => p.y + 0.5 * outward(p);
  const exact = score(cands[0]) >= score(cands[1]) ? cands[0] : cands[1];

  // With the hand held close to the body a real arm points its elbow toward the camera,
  // which in 2D reads as a short upper arm dropping down. Approximate that by letting the
  // elbow sag along a down-and-out pole, and blend to exact IK as the arm straightens.
  const outSign = side === "r" ? -1 : 1;
  const pl = Math.hypot(0.3, 1);
  const soft = { x: mx + ((outSign * 0.3) / pl) * h * 0.6, y: my + (1 / pl) * h * 0.6 };
  const k = Math.min(Math.max((d - 0.17) / 0.13, 0), 1);
  const elbow = { x: soft.x + (exact.x - soft.x) * k, y: soft.y + (exact.y - soft.y) * k };
  return { elbow, wrist: { x: s.x + dx, y: s.y + dy } };
}

// ตำแหน่งโคนนิ้ว มุมกาง และความยาวแต่ละข้อของนิ้วชี้ กลาง นาง ก้อย
const FINGERS = [
  // base (u, v) in the hand's local frame, spread angle, phalanx lengths
  { base: [0.02, 0.055], spread: 0.16, len: [0.022, 0.014, 0.012] },
  { base: [0.006, 0.06], spread: 0.05, len: [0.025, 0.016, 0.013] },
  { base: [-0.009, 0.057], spread: -0.06, len: [0.022, 0.014, 0.012] },
  { base: [-0.023, 0.05], spread: -0.17, len: [0.017, 0.011, 0.01] },
];
// มุมงอสูงสุดของข้อนิ้วทั้งสามข้อ
const BEND = [1.2, 1.5, 0.9];
// ขยายขนาดมือให้เห็นชัดขึ้น
const HAND_SCALE = 1.25;
// ความยาวแต่ละข้อของนิ้วโป้ง
const THUMB_LEN = [0.027, 0.021, 0.018];

// สร้างจุด landmark มือ 21 จุดจากตำแหน่ง มุม และการงอนิ้ว
function buildHand(h: MotionHand, side: Side): Point[] {
  const ca = Math.cos(h.a);
  const sa = Math.sin(h.a);
  // Keep the thumb on the side facing the body however the hand is rotated. Finger order
  // mirrors when the hand turns upside down; the thumb offset shrinks to zero while the
  // hand is sideways, which hides the switch.
  const base = side === "r" ? 1 : -1;
  const s = base * (ca >= 0 ? 1 : -1);
  const sThumb = base * Math.max(-1, Math.min(1, ca * 4));
  const at = (u: number, v: number): Point => ({
    x: h.x + (ca * u + sa * v) * HAND_SCALE,
    y: h.y + (sa * u - ca * v) * HAND_SCALE,
  });

  const pts: Point[] = new Array(21);
  pts[0] = at(0, 0);

  // Thumb: 1 CMC, 2 MCP, 3 IP, 4 TIP. Curling sweeps it across the palm.
  const curlT = h.c[0] ?? 0;
  let u = 0.03 * sThumb;
  let v = 0.008;
  pts[1] = at(u, v);
  let ang = sThumb * (1.05 - 1.35 * curlT);
  for (let k = 0; k < 3; k++) {
    u += Math.sin(ang) * THUMB_LEN[k];
    v += Math.cos(ang) * THUMB_LEN[k];
    pts[2 + k] = at(u, v);
    ang -= sThumb * 0.45 * curlT;
  }

  FINGERS.forEach((f, i) => {
    const curl = h.c[i + 1] ?? 0;
    const spread = f.spread * s;
    const bu = f.base[0] * s;
    const bv = f.base[1];
    const start = 5 + i * 4;
    pts[start] = at(bu, bv);
    let cu = bu;
    let cv = bv;
    let cum = 0;
    for (let k = 0; k < 3; k++) {
      cum += BEND[k] * curl;
      const step = f.len[k] * Math.cos(cum);
      cu += Math.sin(spread) * step;
      cv += Math.cos(spread) * step;
      pts[start + 1 + k] = at(cu, cv);
    }
  });
  return pts;
}

// รูปร่างทั้งตัวของตัวละคร: แขนสองข้างและมือสองข้าง
export interface Figure {
  armR: Arm;
  armL: Arm;
  handR: Point[];
  handL: Point[];
}

// คำนวณแขนและมือทั้งสองข้าง (พิกัด 0-1) จากตำแหน่งข้อมือที่ต้องการ
/** Solves both arms and hands (in unit space) for the avatar's current hand targets. */
export function computeFigure(hands: HandPair): Figure {
  const armR = solveArm("r", hands.r);
  const armL = solveArm("l", hands.l);
  return {
    armR,
    armL,
    handR: buildHand({ ...hands.r, x: armR.wrist.x, y: armR.wrist.y }, "r"),
    handL: buildHand({ ...hands.l, x: armL.wrist.x, y: armL.wrist.y }, "l"),
  };
}

// พารามิเตอร์สีหน้าและการขยับศีรษะ
export interface Face {
  brow: number;
  tilt: number;
  eye: number;
  smile: number;
  open: number;
  hx: number;
  hy: number;
  rot: number;
}

// สีหน้าปกติ
export const NEUTRAL_FACE: Face = { brow: 0, tilt: 0, eye: 1, smile: 0.15, open: 0, hx: 0, hy: 0, rot: 0 };

// รายชื่อพารามิเตอร์สีหน้า ใช้วนคำนวณ
const FACE_KEYS = Object.keys(NEUTRAL_FACE) as (keyof Face)[];

// หาสีหน้า ณ เวลา t (0-1) ของคลิป โดยไล่ระหว่าง keyframe
/** Facial expression at time t (0..1); eases from and back to a neutral face at the clip ends. */
export function sampleFace(motion: Motion | null | undefined, t: number): Face {
  const frames = motion?.face;
  if (!frames?.length) return NEUTRAL_FACE;
  const full = (f: FaceFrame) => ({ t: f.t, v: { ...NEUTRAL_FACE, ...f } as Face });
  const keys = [...frames].sort((a, b) => a.t - b.t).map(full);
  if (keys[0].t > 0.001) keys.unshift({ t: 0, v: NEUTRAL_FACE });
  if (keys[keys.length - 1].t < 0.999) keys.push({ t: 1, v: NEUTRAL_FACE });

  const c = Math.min(Math.max(t, 0), 1);
  let i = 0;
  while (i < keys.length - 2 && c > keys[i + 1].t) i++;
  const k0 = keys[i];
  const k1 = keys[i + 1];
  const f = ease(Math.min(Math.max((c - k0.t) / (k1.t - k0.t || 1), 0), 1));
  const out = { ...NEUTRAL_FACE };
  for (const key of FACE_KEYS) out[key] = lerp(k0.v[key], k1.v[key], f);
  return out;
}
