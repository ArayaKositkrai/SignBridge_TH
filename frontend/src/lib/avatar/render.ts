// วาดอวตาร 2D ลง canvas: ลำตัว แขน มือ สีหน้า และรอยแสงตามมือ

import type { Point } from "../../types";
import { HEAD, SHOULDER, type Arm, type Face, type Figure } from "./skeleton";

// จุดหนึ่งจุดของรอยแสงตามมือ
export interface TrailPoint {
  x: number;
  y: number;
  t: number;
}
// รอยแสงของมือขวาและมือซ้าย
export interface Trails {
  r: TrailPoint[];
  l: TrailPoint[];
}

// รอยแสงอยู่นานกี่มิลลิวินาทีก่อนจางหาย
export const TRAIL_MS = 520;

// สีในธีม (ค่า RGB) ใช้ประกอบเป็น rgba
const SKY = "187, 214, 225";
const BRAND = "56, 133, 171";
const NAVY = "24, 80, 121";

// ลำดับจุดของแต่ละนิ้ว (โป้ง ชี้ กลาง นาง ก้อย)
const FINGER_CHAINS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];
// จุดที่ล้อมเป็นฝ่ามือ
const PALM = [0, 1, 5, 9, 13, 17];

// ชื่อย่อของ canvas 2D context
type Ctx = CanvasRenderingContext2D;

// ลากเส้นเรืองแสงหลายชั้นระหว่างสองจุด
function glowLine(ctx: Ctx, a: Point, b: Point, width: number, layers: [number, string][]) {
  ctx.lineCap = "round";
  for (const [mul, color] of layers) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * mul;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

// วาดข้อต่อกลมมีไฮไลต์
function joint(ctx: Ctx, p: Point, r: number) {
  const g = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, r * 0.1, p.x, p.y, r);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, `rgba(${SKY},0.85)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(${BRAND},0.9)`;
  ctx.lineWidth = r * 0.28;
  ctx.stroke();
}

// วาดแสงเรืองที่พื้นใต้ตัวละคร
function drawFloor(ctx: Ctx, w: number, h: number) {
  const cx = w / 2;
  const cy = h * 0.985;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 0.16);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, h * 0.42);
  g.addColorStop(0, `rgba(${BRAND},0.55)`);
  g.addColorStop(0.6, `rgba(${BRAND},0.14)`);
  g.addColorStop(1, `rgba(${BRAND},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, h * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// วาดลำตัวโปร่งแสงไล่เฉดสี
function drawTorso(ctx: Ctx, P: (p: Point) => Point, k: number) {
  const path = new Path2D();
  const m = (x: number, y: number) => P({ x, y });
  const start = m(0.43, 0.39);
  path.moveTo(start.x, start.y);
  const neckEnd = m(0.57, 0.39);
  path.lineTo(neckEnd.x, neckEnd.y);
  const c1 = m(0.635, 0.39);
  const e1 = m(0.628, 0.46);
  path.quadraticCurveTo(c1.x, c1.y, e1.x, e1.y);
  for (const [x, y] of [[0.575, 0.68], [0.588, 0.97], [0.412, 0.97], [0.425, 0.68], [0.372, 0.46]] as const) {
    const t = m(x, y);
    path.lineTo(t.x, t.y);
  }
  const c2 = m(0.365, 0.39);
  const e2 = m(0.43, 0.39);
  path.quadraticCurveTo(c2.x, c2.y, e2.x, e2.y);
  path.closePath();

  const top = m(0.5, 0.39);
  const bottom = m(0.5, 0.97);
  const g = ctx.createLinearGradient(top.x, top.y, bottom.x, bottom.y);
  g.addColorStop(0, `rgba(${BRAND},0.42)`);
  g.addColorStop(1, `rgba(17,50,154,0)`);
  ctx.fillStyle = g;
  ctx.fill(path);
  ctx.lineWidth = 1.6 * k;
  ctx.strokeStyle = `rgba(${SKY},0.55)`;
  ctx.stroke(path);

  // collar line for a bit of structure
  const a = m(0.45, 0.4);
  const b = m(0.55, 0.4);
  const mid = m(0.5, 0.44);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(mid.x, mid.y, b.x, b.y);
  ctx.strokeStyle = `rgba(${SKY},0.35)`;
  ctx.lineWidth = 1.4 * k;
  ctx.stroke();
}

// วาดแขนหนึ่งข้างพร้อมข้อต่อไหล่และข้อศอก
function drawArm(ctx: Ctx, P: (p: Point) => Point, side: "r" | "l", arm: Arm, k: number) {
  const s = P(SHOULDER[side]);
  const e = P(arm.elbow);
  const wr = P(arm.wrist);
  const upper = 15 * k;
  const fore = 11.5 * k;
  const layers: [number, string][] = [
    [1.7, `rgba(${SKY},0.14)`],
    [1, `rgba(${BRAND},0.7)`],
    [0.34, "rgba(255,255,255,0.75)"],
  ];
  ctx.save();
  ctx.shadowColor = `rgba(${BRAND},0.7)`;
  ctx.shadowBlur = 14 * k;
  glowLine(ctx, s, e, upper, layers);
  glowLine(ctx, e, wr, fore, layers);
  ctx.restore();
  joint(ctx, s, 8.5 * k);
  joint(ctx, e, 6.8 * k);
}

// วาดศีรษะ ใบหน้า และสีหน้า (ตา คิ้ว แก้ม ปาก) ตามพารามิเตอร์
function drawHead(ctx: Ctx, P: (p: Point) => Point, h: number, k: number, now: number, face: Face) {
  const base = P(HEAD);
  const r = HEAD.r * h;
  const bob = Math.sin(now / 1100) * 1.2 * k;
  const c = { x: base.x + face.hx * h, y: base.y + face.hy * h + bob };

  // neck follows the head so nods do not detach it
  const n1 = { x: c.x, y: c.y + r * 0.85 };
  const n2 = P({ x: 0.5, y: 0.41 });
  glowLine(ctx, n1, n2, 13 * k, [
    [1.4, `rgba(${SKY},0.12)`],
    [1, `rgba(${BRAND},0.55)`],
  ]);

  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(face.rot);

  // soft cream face so dark features read as friendly rather than eerie
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.1, 0, 0, r * 1.05);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.7, "#eef4f7");
  g.addColorStop(1, `rgba(${SKY},1)`);
  ctx.shadowColor = `rgba(${BRAND},0.85)`;
  ctx.shadowBlur = 18 * k;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2.4 * k;
  ctx.strokeStyle = `rgba(${BRAND},0.85)`;
  ctx.stroke();

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const INK = "#2f2a2a";

  const smileAmt = Math.max(face.smile, 0);
  const eyeY = -r * 0.02;

  // cheeks
  ctx.fillStyle = `rgba(214, 40, 57, ${0.14 + smileAmt * 0.16})`;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * r * 0.62, eyeY + r * 0.3, r * 0.15, r * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // eyes: big round dots with a highlight; squint into closed arcs
  const phase = now % 3800;
  const blink = phase < 150 ? Math.max(Math.abs(phase - 75) / 75, 0.05) : 1;
  const openness = Math.min(Math.max(face.eye, 0), 1.3) * blink;
  const gaze = Math.sin(now / 2300) * r * 0.02;
  for (const side of [-1, 1]) {
    const ex = side * r * 0.36 + gaze;
    if (openness < 0.45) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.8 * k;
      ctx.beginPath();
      ctx.arc(ex, eyeY + r * 0.04, r * 0.13, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    } else {
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, r * 0.11, r * 0.15 * Math.min(openness, 1.15), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath();
      ctx.arc(ex + r * 0.035, eyeY - r * 0.05 * Math.min(openness, 1), r * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // eyebrows: short soft strokes; raise/lower and tilt to show worry or sternness
  ctx.strokeStyle = `rgba(47, 42, 42, 0.7)`;
  ctx.lineWidth = 3 * k;
  for (const side of [-1, 1]) {
    const y0 = eyeY - r * 0.3 - face.brow * r * 0.14;
    const inner = { x: side * r * 0.16, y: y0 - face.tilt * r * 0.1 };
    const outer = { x: side * r * 0.54, y: y0 + face.tilt * r * 0.06 };
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.quadraticCurveTo((inner.x + outer.x) / 2, Math.min(inner.y, outer.y) - r * 0.04, outer.x, outer.y);
    ctx.stroke();
  }

  // mouth: small curve from frown to smile, with a soft open mouth
  const my = eyeY + r * 0.46;
  const half = r * 0.15 + smileAmt * r * 0.06 + face.open * r * 0.04;
  const corner = my - face.smile * r * 0.08;
  const mid = my + face.smile * r * 0.14;
  ctx.beginPath();
  ctx.moveTo(-half, corner);
  ctx.quadraticCurveTo(0, mid - face.open * r * 0.03, half, corner);
  if (face.open > 0.06) {
    ctx.quadraticCurveTo(0, mid + face.open * r * 0.5, -half, corner);
    ctx.closePath();
    ctx.fillStyle = "#7a2a35";
    ctx.fill();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.4 * k;
  ctx.stroke();
  ctx.restore();
}

// วาดมือ: ฝ่ามือ นิ้วทั้งห้า และข้อมือ
function drawHand(ctx: Ctx, P: (p: Point) => Point, pts: Point[], k: number) {
  const px = pts.map(P);

  ctx.beginPath();
  PALM.forEach((i, n) => (n ? ctx.lineTo(px[i].x, px[i].y) : ctx.moveTo(px[i].x, px[i].y)));
  ctx.closePath();
  ctx.fillStyle = `rgba(${SKY},0.28)`;
  ctx.fill();
  ctx.lineWidth = 1.4 * k;
  ctx.strokeStyle = `rgba(${SKY},0.7)`;
  ctx.stroke();

  ctx.save();
  ctx.shadowColor = `rgba(${BRAND},0.95)`;
  ctx.shadowBlur = 9 * k;
  for (const chain of FINGER_CHAINS) {
    for (let j = 0; j < chain.length - 1; j++) {
      const width = (4.6 - j * 0.9) * k;
      glowLine(ctx, px[chain[j]], px[chain[j + 1]], width, [
        [1.9, `rgba(${BRAND},0.28)`],
        [1, `rgba(${SKY},0.95)`],
      ]);
    }
  }
  ctx.restore();

  for (const chain of FINGER_CHAINS) {
    for (let j = 1; j < chain.length; j++) {
      const tip = j === chain.length - 1;
      const p = px[chain[j]];
      ctx.fillStyle = tip ? "#ffffff" : `rgba(${BRAND},0.95)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (tip ? 3 : 1.9) * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  joint(ctx, px[0], 5 * k);
}

// วาดรอยแสงตามการเคลื่อนของมือ ค่อย ๆ จางลงตามเวลา
function drawTrail(ctx: Ctx, trail: TrailPoint[], now: number, k: number) {
  const live = trail.filter((p) => now - p.t < TRAIL_MS);
  if (live.length < 2) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 1; i < live.length; i++) {
    const age = 1 - (now - live[i].t) / TRAIL_MS;
    ctx.strokeStyle = `rgba(${SKY},${(0.55 * age).toFixed(3)})`;
    ctx.lineWidth = (2 + 9 * age) * k;
    ctx.beginPath();
    ctx.moveTo(live[i - 1].x, live[i - 1].y);
    ctx.lineTo(live[i].x, live[i].y);
    ctx.stroke();
  }
}

// วาดตัวละครทั้งตัวลง canvas หนึ่งเฟรม
export function drawAvatar(ctx: Ctx, fig: Figure, face: Face, w: number, h: number, now: number, trails: Trails) {
  ctx.clearRect(0, 0, w, h);
  const k = h / 600;
  const P = (p: Point): Point => ({ x: w / 2 + (p.x - 0.5) * h, y: p.y * h });

  drawFloor(ctx, w, h);
  drawTrail(ctx, trails.r, now, k);
  drawTrail(ctx, trails.l, now, k);
  drawTorso(ctx, P, k);
  drawArm(ctx, P, "r", fig.armR, k);
  drawArm(ctx, P, "l", fig.armL, k);
  drawHead(ctx, P, h, k, now, face);
  drawHand(ctx, P, fig.handR, k);
  drawHand(ctx, P, fig.handL, k);

  // recorded wrist positions feed the light trails on later frames
  const push = (list: TrailPoint[], p: Point) => {
    const q = P(p);
    list.push({ x: q.x, y: q.y, t: now });
    while (list.length && now - list[0].t > TRAIL_MS) list.shift();
  };
  push(trails.r, fig.handR[9]);
  push(trails.l, fig.handL[9]);
}
