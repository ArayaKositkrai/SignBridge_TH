import type { LandmarkFrame, Point } from "../../types";
import { FACE_KEYPOINT_LINES } from "./faceKeypoints";
import { FACE_CONTOURS, HAND_CONNECTIONS, POSE_CONNECTIONS } from "./holistic";

// สีที่ใช้วาดเส้นและจุด
const COLOR = {
  bone: "#bbd6e1",
  joint: "#ffffff",
  hand: "#ffffff",
  face: "rgba(187,214,225,0.35)",
  faceKeypoints: "rgba(187,214,225,0.8)",
};

// สีประจำข้างซ้าย/ขวาของคน (ใช้กับมือ แขน และป้ายกำกับ)
export const SIDE_COLOR = { left: "#ffa94d", right: "#3bc9db" } as const;
// ชื่อข้างภาษาไทยที่แสดงบนป้าย
const SIDE_LABEL = { left: "ซ้าย", right: "ขวา" } as const;

// จุดของแขนแต่ละข้างใน pose (ไหล่ ศอก ข้อมือ และนิ้วหยาบ ๆ) ตามข้างของคน
const ARM_POINTS = {
  left: new Set([11, 13, 15, 17, 19, 21]),
  right: new Set([12, 14, 16, 18, 20, 22]),
};
// เส้นเชื่อมของแขนแต่ละข้าง
const ARM_CONNECTIONS = {
  left: POSE_CONNECTIONS.filter((c) => ARM_POINTS.left.has(c.start) && ARM_POINTS.left.has(c.end)),
  right: POSE_CONNECTIONS.filter((c) => ARM_POINTS.right.has(c.start) && ARM_POINTS.right.has(c.end)),
};

// ตัวเลือกการวาด: mirror = canvas ถูกกลับซ้าย-ขวาด้วย CSS (ต้องกลับตัวหนังสือคืน)
export interface DrawOptions {
  mirror?: boolean;
}

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

// วาดจุดสำคัญของใบหน้า (คิ้ว ตา ปาก) เป็นเส้นตามกลุ่ม
function drawFaceKeypoints(ctx: CanvasRenderingContext2D, pts: Point[], w: number, h: number) {
  ctx.strokeStyle = COLOR.faceKeypoints;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const group of FACE_KEYPOINT_LINES) {
    for (let i = 1; i < group.length; i++) {
      const a = pts[group[i - 1]];
      const b = pts[group[i]];
      if (a && b) line(ctx, a, b, w, h);
    }
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
    // ข้ามจุดที่ไม่มีข้อมูล (skeleton จากไฟล์รูปแบบกลางมีเฉพาะจุดแขน)
    if (!p || i > maxIndex) return;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

// คืนกรอบรอบมือ (พิกัดบน canvas)
function handBox(pts: Point[], w: number, h: number) {
  const xs = pts.map((p) => p.x * w);
  const ys = pts.map((p) => p.y * h);
  const pad = 18;
  return {
    x0: Math.min(...xs) - pad,
    y0: Math.min(...ys) - pad,
    x1: Math.max(...xs) + pad,
    y1: Math.max(...ys) + pad,
  };
}

// วาดกรอบประรอบมือด้วยสีของข้างนั้น
function drawRoi(ctx: CanvasRenderingContext2D, box: ReturnType<typeof handBox>, color: string) {
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
  ctx.restore();
}

// วาดป้าย "ซ้าย"/"ขวา" เหนือกรอบมือ (กลับตัวหนังสือคืนเมื่อภาพเป็นกระจก)
function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  color: string,
  w: number,
  mirror: boolean,
) {
  const size = Math.max(14, Math.round(w * 0.02));
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.translate(cx, Math.max(y - size * 0.6, size));
  if (mirror) ctx.scale(-1, 1);
  ctx.font = `700 ${size}px "IBM Plex Sans Thai", "Noto Sans Thai", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(text).width + size;
  const th = size * 1.5;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-tw / 2, -th / 2, tw, th, th / 2);
  ctx.fill();
  ctx.fillStyle = "#0d2233";
  ctx.fillText(text, 0, size * 0.05);
  ctx.restore();
}

// วาดโครงกระดูก มือ และใบหน้าที่ตรวจจับได้ลงบน canvas (มือ/แขนซ้ายขวาคนละสี)
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  frame: LandmarkFrame | null,
  w: number,
  h: number,
  showHands: boolean,
  { mirror = false }: DrawOptions = {},
) {
  ctx.clearRect(0, 0, w, h);
  if (!frame) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowBlur = 0;
  drawConnections(ctx, frame.face, FACE_CONTOURS, w, h, COLOR.face, 1.2);
  if (frame.faceKeypoints?.length) drawFaceKeypoints(ctx, frame.faceKeypoints, w, h);

  ctx.shadowColor = "rgba(56, 133, 171, 0.95)";
  ctx.shadowBlur = 10;
  drawConnections(ctx, frame.pose, POSE_CONNECTIONS, w, h, COLOR.bone, 3, UPPER_BODY_MAX);
  drawConnections(ctx, frame.pose, ARM_CONNECTIONS.left, w, h, SIDE_COLOR.left, 3.5);
  drawConnections(ctx, frame.pose, ARM_CONNECTIONS.right, w, h, SIDE_COLOR.right, 3.5);
  drawDots(ctx, frame.pose, w, h, COLOR.joint, 4, UPPER_BODY_MAX);

  if (!showHands) return;
  for (const side of ["left", "right"] as const) {
    const hand = side === "left" ? frame.leftHand : frame.rightHand;
    if (hand.length < MIN_VISIBLE_HANDS) continue;
    const color = SIDE_COLOR[side];
    const box = handBox(hand, w, h);
    drawConnections(ctx, hand, HAND_CONNECTIONS, w, h, color, 2.5);
    drawDots(ctx, hand, w, h, COLOR.hand, 3.5);
    drawRoi(ctx, box, color);
    drawLabel(ctx, SIDE_LABEL[side], (box.x0 + box.x1) / 2, box.y0, color, w, mirror);
  }
}
