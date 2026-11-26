// หน้าการ์ตูนของอวตาร 3D (วาดลง canvas แล้วแปะเป็น texture)

import * as THREE from "three";
import type { Face } from "../avatar/skeleton";

// X Bot ไม่มี blendshape หน้า (ขยับตา/คิ้ว/ปากด้วยกระดูกไม่ได้) จึงวาดหน้าการ์ตูนแบบเดียว
// กับตัวโครงกระดูก 2D ลงบน canvas แล้วแปะเป็น texture ไว้หน้าหัวโมเดลแทน
const SIZE = 256;
const INK = "#2f2a2a";

// canvas ที่วาดหน้าอยู่ พร้อม texture ของ three.js ที่ผูกกับ canvas เดียวกัน
export interface FaceTexture {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
}

// เตรียม canvas เปล่าไว้วาดหน้าทุกเฟรม (พื้นหลังโปร่งใส ให้เห็นหัวโมเดลรอบ ๆ)
export function createFaceTexture(): FaceTexture {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, texture };
}

// วาดดวงตา คิ้ว แก้ม และปากตามค่าอารมณ์ปัจจุบัน (พื้นหลังโปร่งใส ไม่วาดวงหน้า/หัว)
export function drawFace(ft: FaceTexture, face: Face, now: number): void {
  const ctx = ft.canvas.getContext("2d")!;
  const w = ft.canvas.width;
  const h = ft.canvas.height;
  const r = Math.min(w, h) * 0.46;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(face.rot);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const smileAmt = Math.max(face.smile, 0);
  const eyeY = -r * 0.02;

  // แก้ม
  ctx.fillStyle = `rgba(214, 40, 57, ${0.14 + smileAmt * 0.16})`;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * r * 0.62, eyeY + r * 0.3, r * 0.15, r * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ตา: จุดกลมโตมีไฮไลต์ กะพริบเป็นช่วง ๆ
  const phase = now % 3800;
  const blink = phase < 150 ? Math.max(Math.abs(phase - 75) / 75, 0.05) : 1;
  const openness = Math.min(Math.max(face.eye, 0), 1.3) * blink;
  const gaze = Math.sin(now / 2300) * r * 0.02;
  for (const side of [-1, 1]) {
    const ex = side * r * 0.36 + gaze;
    if (openness < 0.45) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3.4;
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

  // คิ้ว: ยก/ลดและเอียงปลายในบอกความกังวลหรือความเข้ม
  ctx.strokeStyle = "rgba(47, 42, 42, 0.7)";
  ctx.lineWidth = 3.6;
  for (const side of [-1, 1]) {
    const y0 = eyeY - r * 0.3 - face.brow * r * 0.14;
    const inner = { x: side * r * 0.16, y: y0 - face.tilt * r * 0.1 };
    const outer = { x: side * r * 0.54, y: y0 + face.tilt * r * 0.06 };
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.quadraticCurveTo((inner.x + outer.x) / 2, Math.min(inner.y, outer.y) - r * 0.04, outer.x, outer.y);
    ctx.stroke();
  }

  // ปาก: โค้งจากบึ้งถึงยิ้ม อ้าได้เมื่อพูด/ตกใจ
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
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  ft.texture.needsUpdate = true;
}

// สร้างแผ่นหน้าติดกับกระดูกหัว หันเข้าหากล้องเสมอ
// headForward = แกน "หน้าหัน" ของกระดูกหัว (ในพิกัดท้องถิ่นของกระดูกหัวเอง) ใช้หมุนแผ่นให้ตรงหน้า
// offset = ตำแหน่งที่วาง (พิกัดท้องถิ่นของกระดูกหัวเช่นกัน) ต้องคำนวณแยกจาก headForward เพราะ
// จุดกำเนิดของกระดูกหัว (Head bone) มักอยู่แถวคาง/โคนคอ ไม่ใช่กลางใบหน้า ถ้าวางตรงจุดกำเนิดเฉย ๆ
// ตา/ปากจะไปโผล่แถวคอแทน
export function createFaceMesh(
  texture: THREE.CanvasTexture,
  size: number,
  offset: THREE.Vector3,
  headForward: THREE.Vector3,
): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size, size);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(offset);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), headForward);
  mesh.renderOrder = 10;
  return mesh;
}
