import type { LandmarkFrame, Point } from "../../types";
import { FACE_CONTOURS, HAND_CONNECTIONS, POSE_CONNECTIONS } from "./holistic";

// สีที่ใช้วาดเส้นและจุด
const COLOR = {
  bone: "#bbd6e1",
  joint: "#ffffff",
  hand: "#ffffff",
  handBone: "#8fc4dc",
  face: "rgba(187,214,225,0.35)",
  roi: "#3885ab",
};

// Pose landmarks 0-24 are head/torso/arms; skip legs so the frame stays clean.
// วาดเฉพาะครึ่งบน (จุดที่ 0-24) ไม่วาดขา
const UPPER_BODY_MAX = 24;
// จำนวนจุดขั้นต่ำที่ถือว่าเห็นมือ
const MIN_VISIBLE_HANDS = 1;

// ลากเส้นระหว่างสองจุด
function line(ctx: CanvasRenderingContext2D, a: Point, b: Point, w: number, h: number) {
  ctx.moveTo(a.x * w, a.y * h);
  ctx.lineTo(b.x * w, b.y * h);
}

// วาดเส้นเชื่อมจุดตามรายการ connections
function drawConnections(
  ctx: CanvasRenderingContext2D,
  pts: Point[],
  conns: { start: number; end: number }[],
  w: number,
  h: number,
  color: string,
  width: number,
  maxIndex = Infinity,
) {
  if (!pts.length) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const { start, end } of conns) {
    if (start > maxIndex || end > maxIndex) continue;
    const a = pts[start];
    const b = pts[end];
    if (a && b) line(ctx, a, b, w, h);
  }
  ctx.stroke();
}

// วาดจุดข้อต่อ
function drawDots(
  ctx: CanvasRenderingContext2D,
  pts: Point[],
  w: number,
  h: number,
  color: string,
  radius: number,
  maxIndex = Infinity,
) {
  ctx.fillStyle = color;
  pts.forEach((p, i) => {
    if (i > maxIndex) return;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

// วาดกรอบประรอบมือ
function drawRoi(ctx: CanvasRenderingContext2D, pts: Point[], w: number, h: number) {
  if (!pts.length) return;
  const xs = pts.map((p) => p.x * w);
  const ys = pts.map((p) => p.y * h);
  const pad = 18;
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const x1 = Math.max(...xs) + pad;
  const y1 = Math.max(...ys) + pad;
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = COLOR.roi;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

// วาดโครงกระดูก มือ และใบหน้าที่ตรวจจับได้ลงบน canvas
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  frame: LandmarkFrame | null,
  w: number,
  h: number,
  showHands: boolean,
) {
  ctx.clearRect(0, 0, w, h);
  if (!frame) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowBlur = 0;
  drawConnections(ctx, frame.face, FACE_CONTOURS, w, h, COLOR.face, 1.2);

  ctx.shadowColor = "rgba(56, 133, 171, 0.95)";
  ctx.shadowBlur = 10;
  drawConnections(ctx, frame.pose, POSE_CONNECTIONS, w, h, COLOR.bone, 3, UPPER_BODY_MAX);
  drawDots(ctx, frame.pose, w, h, COLOR.joint, 4, UPPER_BODY_MAX);

  if (!showHands) return;
  for (const hand of [frame.leftHand, frame.rightHand]) {
    if (hand.length < MIN_VISIBLE_HANDS) continue;
    drawConnections(ctx, hand, HAND_CONNECTIONS, w, h, COLOR.handBone, 2.5);
    drawDots(ctx, hand, w, h, COLOR.hand, 3.5);
    drawRoi(ctx, hand, w, h);
  }
}
