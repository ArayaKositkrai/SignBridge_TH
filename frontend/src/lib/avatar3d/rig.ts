import * as THREE from "three";
import { CURL_TO_RAD, HEAD, REST, SHOULDER, type Face, type HandPair, type Side } from "../avatar/skeleton";
import { ARM_BONES, CURL_INDEX, FINGERS, HEAD_BONE, SHOULDER_BONES, fingerBones } from "./bones";
import type { Rig } from "./loadModel";

// อัตราขยายมุมบิดข้อมือ ต่อหน่วยมุม a ที่เปลี่ยนไปจากท่าพัก
const WRIST_TWIST_GAIN = 1.1;
// มือยิ่งเหยียดออกจากลำตัวมาก ยิ่งยื่นมาข้างหน้า (ทำให้ท่าดูเป็นธรรมชาติ ไม่แบนติดลำตัว)
const FORWARD_BASE = 0.12;
const FORWARD_GAIN = 0.42;
// ทิศข้อศอกตามธรรมชาติ (เทียบกับแนวดิ่งลง): กางออกข้างและเอนไปข้างหลังเท่าไร
const ELBOW_OUT = 0.35;
const ELBOW_BACK = 0.15;
const MAX_HEAD_TILT = 0.32;
const REST_ANGLE = Math.PI; // มุม a ตอนท่าพัก (มือคว่ำห้อยลง)

// ความหนาของแต่ละส่วนของแขน (สัดส่วนของความยาวแขนทั้งเส้น) ใช้เว้นระยะจากผิวตัวไม่ให้จมเข้าไป
//   ข้อมือที่ศีรษะเว้นน้อย ให้มือแตะหน้า/คาง/หน้าผากได้จริง
const WRIST_RADIUS = 0.05;
const WRIST_RADIUS_HEAD = 0.015;
const FOREARM_RADIUS = 0.055;
const ELBOW_RADIUS = 0.065;
// มุมหมุนข้อศอกรอบแนวไหล่-ข้อมือที่ลองหา (เรเดียน) ห่างจากทิศที่ข้อมูลบอกได้ไม่เกินนี้
const SWIVEL_RANGE = (2 * Math.PI) / 3;
const SWIVEL_STEP = Math.PI / 18;
// ต้นแขน/ข้อศอกที่ทะลุตัวถูกลงโทษหนัก ส่วนท่อนแขนล่างแก้ได้อีกทางโดยดันข้อมือมาข้างหน้า จึงลงโทษเบากว่า
const UPPER_PENETRATION_WEIGHT = 12;
const FORE_PENETRATION_WEIGHT = 3;
// ความชอบท่าแขนแบบคนจริง: ข้อศอกอยู่ต่ำ (ไม่กางปีก) และไม่ไปอยู่หลังลำตัว (ต่อหน่วยความยาว)
const ELBOW_LOW_WEIGHT = 0.35;
const ELBOW_BEHIND_WEIGHT = 1.5;
const SWIVEL_ANGLE_WEIGHT = 0.05;
const BEHIND_ALLOW = 0.15;
// จำนวนรอบที่ดันข้อมือมาข้างหน้าเมื่อท่อนแขนยังทะลุตัว
const FOREARM_PASSES = 3;
// มุมพับข้อมือสูงสุดเทียบกับท่อนแขน (เรเดียน) กันข้อมือหักผิดธรรมชาติ
const MAX_WRIST_SWING = (75 * Math.PI) / 180;
// ปลายนิ้วยื่นไปข้างหน้าตามท่อนแขนเท่าไร (ข้อมูล 2D ไม่บอกความลึกของนิ้ว)
const FINGER_DEPTH_FOLLOW = 0.6;
// ความหนาของฝ่ามือ/นิ้ว (สัดส่วนความยาวแขน) และที่ศีรษะ (ให้แตะหน้าได้)
const HAND_RADIUS = 0.035;
const HAND_RADIUS_HEAD = 0.01;
// ความยาวมือจากข้อมือถึงปลายนิ้วกลาง เทียบระยะข้อมือ → ข้อปลายนิ้วกลางของโครงกระดูก
const HAND_LENGTH_GAIN = 1.15;
// ข้อศอกที่ย้ายตำแหน่งไปจากเฟรมก่อนถูกลงโทษ (ต่อหน่วยระยะ) กันแขนสะบัดไปมาระหว่างทางเลือกสองแบบ
const ELBOW_CONTINUITY_WEIGHT = 0.6;
// เป้าข้อมือย้ายเกินระยะนี้ในเฟรมเดียว (สัดส่วนความยาวแขน) ถือว่าเปลี่ยนคลิปใหม่ ไม่ต้องรักษาความต่อเนื่อง
const CONTINUITY_RESET = 0.5;

// ข้อศอกหมุนรอบแนวไหล่-ข้อมือได้ไม่เกินเท่านี้ต่อเฟรม (เรเดียน) ค่อย ๆ ไปหามุมที่ดีที่สุดแทนการกระโดด
const MAX_SWIVEL_PER_FRAME = (8 * Math.PI) / 180;
// มือ: เลือกการหันฝ่ามือที่ใกล้เฟรมก่อนเมื่อสองแบบดีพอ ๆ กัน (น้ำหนักต่อมุมที่ต่าง 180°)
const HAND_CONTINUITY_WEIGHT = 0.8;
// ลงโทษการกลับทิศแนวกว้างฝ่ามือ (คูณสัดส่วนที่เห็นเต็มฝ่า): เห็นเต็มฝ่าแล้วไม่ควรกลับ
const WIDTH_FLIP_PENALTY = 2.5;
// สัดส่วนที่เห็นฝ่ามือ (vis) ตั้งแต่ 1/ค่านี้ขึ้นไป เชื่อด้านฝ่ามือที่ข้อมูลบอกเต็มที่
const FACING_TRUST = 1.5;
// ลงโทษท่ามือที่ต้องพับข้อมือเกินขีดจำกัด (ต่อมุมที่เกิน 180°)
const EXCESS_SWING_WEIGHT = 1.5;

// ตำแหน่งข้อศอก และการหมุนของมือในเฟรมก่อน (แยกตามโมเดลและข้าง) ใช้ทำให้ท่าต่อเนื่อง ไม่สะบัด/พลิกกลับ
const prevElbows = new WeakMap<Rig, Partial<Record<Side, { elbow: THREE.Vector3; wrist: THREE.Vector3 }>>>();
const prevHands = new WeakMap<Rig, Partial<Record<Side, { world: THREE.Quaternion; local: THREE.Quaternion }>>>();
// ท่ามือที่ต้องพับข้อมือเกินขีดจำกัดเกินมุมนี้ ถือว่าข้อมูลเพี้ยน: คงท่ามือเดิมเทียบกับท่อนแขนไว้
const IMPOSSIBLE_EXCESS = Math.PI / 4;
// มือหมุนได้ไม่เกินเท่านี้ต่อเฟรม (เรเดียน) กันมือพลิกวูบ
const MAX_HAND_TURN_PER_FRAME = (15 * Math.PI) / 180;

// มุมหมุน (เรเดียน) ของจุด p รอบแกนไหล่ s → ข้อมือ w นับจากทิศ pole (แบบเดียวกับ elbowFor)
function swivelOf(s: THREE.Vector3, w: THREE.Vector3, pole: THREE.Vector3, p: THREE.Vector3): number {
  const axis = w.clone().sub(s).normalize();
  const u = pole.clone().addScaledVector(axis, -pole.dot(axis)).normalize();
  const v = p.clone().sub(s);
  v.addScaledVector(axis, -v.dot(axis));
  return Math.atan2(u.clone().cross(v).dot(axis), u.dot(v));
}

// แปลงจุดในพิกัด 0-1 ของระบบ 2D เดิม เป็นตำแหน่งจริงในโลก 3D รอบไหล่ของโมเดล
function toWorldPoint(rig: Rig, side: Side, p: { x: number; y: number }, forward: number): THREE.Vector3 {
  const shoulderBind = rig.bind.get(ARM_BONES[side][0])!;
  const ref = SHOULDER[side];
  return new THREE.Vector3(
    shoulderBind.pos.x + (p.x - ref.x) * rig.armScale,
    shoulderBind.pos.y - (p.y - ref.y) * rig.armScale,
    shoulderBind.pos.z + forward * rig.armScale,
  );
}

// ผิวหน้าสุดของตัว (รวมแผ่นหน้าการ์ตูน) บริเวณรอบจุด (x, y) รัศมี r คืน null ถ้าบริเวณนั้นไม่มีตัว
//   back = ผิวหลังสุดของบริเวณเดียวกัน (จุดที่อยู่หลังตัวไม่ดันมาข้างหน้า)
function surfaceAt(rig: Rig, x: number, y: number, r: number): { front: number; back: number } | null {
  const b = rig.body;
  // ค้นรอบจุดแค่ครึ่งความหนา (อีกครึ่งบวกเป็นระยะเผื่อใน penetration แล้ว)
  r *= 0.5;
  const r0 = Math.max(0, Math.floor((y - r - b.y0) / b.dy));
  const r1 = Math.min(b.rows - 1, Math.floor((y + r - b.y0) / b.dy));
  const c0 = Math.max(0, Math.floor((x - r - b.x0) / b.dx));
  const c1 = Math.min(b.cols - 1, Math.floor((x + r - b.x0) / b.dx));
  let front = -Infinity;
  let back = Infinity;
  for (let i = r0; i <= r1; i++) {
    for (let j = c0; j <= c1; j++) {
      const k = i * b.cols + j;
      if (Number.isNaN(b.front[k])) continue;
      front = Math.max(front, b.front[k]);
      back = Math.min(back, b.back[k]);
    }
  }
  const fc = rig.faceCard;
  if (Math.abs(x - fc.center.x) < fc.half + r && Math.abs(y - fc.center.y) < fc.half + r) {
    front = Math.max(front, fc.center.z);
    back = Math.min(back, fc.center.z);
  }
  return front === -Infinity ? null : { front, back };
}

// จุดนี้จมเข้าไปในตัวลึกเท่าไร (วัดตามแนวหน้า-หลัง) โดยคิดความหนา r ของส่วนแขนนั้นด้วย 0 = ไม่จม
function penetration(rig: Rig, p: THREE.Vector3, r: number): number {
  const s = surfaceAt(rig, p.x, p.y, r);
  if (!s || p.z < s.back - r) return 0;
  return Math.max(0, s.front + r - p.z);
}

// ความหนาของข้อมือ ณ ความสูงนั้น (ที่ศีรษะเว้นน้อยให้แตะหน้าได้)
const wristRadius = (rig: Rig, y: number) => (y > rig.body.headY ? WRIST_RADIUS_HEAD : WRIST_RADIUS) * rig.armLength;

// ข้อศอกของ IK สองข้อต่อ: ไหล่ s → ข้อมือ w (ความยาวต้นแขน l1 ท่อนแขน l2) หมุนรอบแนว s-w ไปทาง pole แล้วหมุนเพิ่ม swivel
function elbowFor(s: THREE.Vector3, w: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, swivel: number) {
  const axis = w.clone().sub(s);
  const d = axis.length();
  axis.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  const u = pole.clone().addScaledVector(axis, -pole.dot(axis));
  if (u.lengthSq() < 1e-8) u.set(0, -1, 0).addScaledVector(axis, axis.y);
  u.normalize().applyAxisAngle(axis, swivel);
  return s.clone().addScaledVector(axis, a).addScaledVector(u, h);
}

// ผลรวมความลึกที่ต้นแขน ข้อศอก และท่อนแขนจมเข้าตัว
function armPenetration(rig: Rig, s: THREE.Vector3, e: THREE.Vector3, w: THREE.Vector3): { upper: number; fore: number } {
  const len = rig.armLength;
  const upper = penetration(rig, e, ELBOW_RADIUS * len) + penetration(rig, s.clone().lerp(e, 0.6), ELBOW_RADIUS * len);
  let fore = 0;
  for (const t of [0.3, 0.6, 0.85]) fore = Math.max(fore, penetration(rig, e.clone().lerp(w, t), FOREARM_RADIUS * len));
  return { upper, fore };
}

// ความลึกที่มือ (ฝ่ามือถึงปลายนิ้ว) จมเข้าตัว: ไล่ตรวจตามทิศนิ้ว handDir ยาว handLen จากข้อมือ
function handPenetration(rig: Rig, w: THREE.Vector3, handDir: THREE.Vector3, handLen: number): number {
  let worst = 0;
  for (const t of [0.35, 0.7, 1]) {
    const p = w.clone().addScaledVector(handDir, handLen * t);
    const r = (p.y > rig.body.headY ? HAND_RADIUS_HEAD : HAND_RADIUS) * rig.armLength;
    worst = Math.max(worst, penetration(rig, p, r));
  }
  return worst;
}

// ทางเลือกแขนหนึ่งข้าง: ตำแหน่งข้อศอก/ข้อมือ
export interface ArmSolution {
  elbow: THREE.Vector3;
  wrist: THREE.Vector3;
}

// แก้แขนหนึ่งข้าง: ข้อมือถึงเป้าเสมอ (ถ้าเอื้อมถึง) ข้อศอกเลือกมุมที่ใกล้ทิศของข้อมูล ต่อเนื่องกับเฟรมก่อน และไม่ทะลุตัว
//   ถ้าข้อมือ/ท่อนแขน/มือจมเข้าตัว ดันข้อมือ "มาข้างหน้า" เท่านั้น (ไม่ดันด้านข้าง ตำแหน่งที่เห็นจากด้านหน้าจึงตรงกับข้อมูล)
export function solveArm3D(
  rig: Rig,
  shoulder: THREE.Vector3,
  wristTarget: THREE.Vector3,
  elbowHint: THREE.Vector3,
  l1: number,
  l2: number,
  hand?: { dir: THREE.Vector3; length: number },
  prev?: { elbow: THREE.Vector3; wrist: THREE.Vector3 },
): ArmSolution {
  const w = wristTarget.clone();
  let elbow = w.clone();
  // เฟรมต่อเนื่องของคลิปเดิม (เป้าข้อมือไม่กระโดด) = ข้อศอกเฟรมก่อน ใช้รักษาความต่อเนื่อง
  const keep = prev && prev.wrist.distanceTo(wristTarget) < CONTINUITY_RESET * rig.armLength ? prev.elbow : undefined;
  for (let pass = 0; pass <= FOREARM_PASSES; pass++) {
    w.z += penetration(rig, w, wristRadius(rig, w.y));
    // เป้าที่ไกล/ใกล้เกินแขนเอื้อม: เลื่อนเข้าหา/ออกจากไหล่ตามแนวเดิม
    const dir = w.clone().sub(shoulder);
    const d = Math.min(Math.max(dir.length(), Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
    w.copy(shoulder).addScaledVector(dir.normalize(), d);

    const pole = elbowHint.clone().sub(shoulder);
    let best = { score: Infinity, elbow: w, fore: 0, angle: 0 };
    for (let k = 0; k <= SWIVEL_RANGE / SWIVEL_STEP; k++) {
      for (const sign of k ? [1, -1] : [1]) {
        const angle = sign * k * SWIVEL_STEP;
        const e = elbowFor(shoulder, w, l1, l2, pole, angle);
        const pen = armPenetration(rig, shoulder, e, w);
        // หลังแนวไหล่เล็กน้อยเป็นเรื่องปกติ (แขนพับข้างตัว) ลงโทษเฉพาะที่เลยไปหลังแผ่นหลัง
        const behind = Math.max(0, shoulder.z - BEHIND_ALLOW * rig.armLength - e.z);
        const moved = keep ? keep.distanceTo(e) : 0;
        const score =
          pen.upper * UPPER_PENETRATION_WEIGHT +
          pen.fore * FORE_PENETRATION_WEIGHT +
          Math.abs(angle) * l1 * SWIVEL_ANGLE_WEIGHT +
          (e.y - shoulder.y + l1) * ELBOW_LOW_WEIGHT +
          behind * ELBOW_BEHIND_WEIGHT +
          moved * ELBOW_CONTINUITY_WEIGHT;
        if (score < best.score) best = { score, elbow: e, fore: pen.fore, angle };
      }
    }
    elbow = best.elbow;
    // เฟรมต่อเนื่อง: หมุนข้อศอกจากมุมเดิมไปหามุมที่ดีที่สุดทีละน้อย (ข้อมือยังอยู่ที่เป้าเสมอ)
    if (keep) {
      const from = swivelOf(shoulder, w, pole, keep);
      const diff = Math.atan2(Math.sin(best.angle - from), Math.cos(best.angle - from));
      const step = Math.max(-MAX_SWIVEL_PER_FRAME, Math.min(MAX_SWIVEL_PER_FRAME, diff));
      elbow = elbowFor(shoulder, w, l1, l2, pole, from + step);
    }
    // ท่อนแขนหรือมือยังจม (เช่นมือแนบอกแต่ข้อศอกอยู่ข้างตัว) ดันข้อมือมาข้างหน้าแล้วลองใหม่
    const push = Math.max(best.fore, hand ? handPenetration(rig, w, hand.dir, hand.length) : 0);
    if (push < 0.005 * rig.armLength) break;
    w.z += push;
  }
  return { elbow, wrist: w };
}

// การหมุนในโลกที่พาทิศ (f, n) ตอน bind ไปเป็นทิศ (f2, n2) — ใช้กำหนดทั้งทิศกระดูกและการบิดรอบตัวเอง
function frameQuat(f: THREE.Vector3, n: THREE.Vector3, f2: THREE.Vector3, n2: THREE.Vector3): THREE.Quaternion {
  return basisQuat(f, n, f2, n2);
}

// หมุนกระดูก "ต้นแขน" และ "ท่อนแขนล่าง" ให้ข้อมือไปถึงจุดเป้าหมายในโลก 3D ด้วย IK สองข้อต่อจริง
//   เป้าข้อมือใช้ตำแหน่งมือจากท่าโดยตรง (ไม่ผ่าน IK 2D ที่บังคับมือให้ห่างไหล่ ทำให้มือกระโดดเมื่ออยู่หน้าไหล่พอดี)
//   ทิศข้อศอกเริ่มจากท่าธรรมชาติ (ลง ออกข้าง เอนหลังเล็กน้อย) แล้วให้ solveArm3D เลือกมุมที่ไม่ทะลุตัว
//   การบิดของต้นแขนกำหนดจากระนาบที่แขนพับ (ไหล่-ข้อศอก-ข้อมือ) จึงไม่หมุนวูบเมื่อแขนข้ามลำตัว
function poseArm(rig: Rig, side: Side, hand: HandPair["r"], extraForward = 0): void {
  const z = hand.z;
  const [upperName, foreName, handName] = ARM_BONES[side];
  const shoulderBind = rig.bind.get(upperName)!;
  const foreBind = rig.bind.get(foreName)!;
  const handBind = rig.bind.get(handName)!;
  const shoulderParentBind = rig.bind.get(SHOULDER_BONES[side])!;
  const l1 = shoulderBind.pos.distanceTo(foreBind.pos);
  const l2 = foreBind.pos.distanceTo(handBind.pos);

  // "ยกมือขึ้นแค่ไหน" ไม่ใช่ "ห่างจากไหล่แค่ไหน" เพราะมือที่ห้อยลงข้างตัวตามสบาย
  // ก็ห่างจากไหล่มากอยู่แล้ว (ตกลงมาตามแนวดิ่ง) แต่ไม่ควรยื่นออกมาข้างหน้าเลย
  const restY = REST[side].y;
  const raise = Math.min(Math.max((restY - hand.y) / (restY - HEAD.y), 0), 1);
  // ท่าจากข้อมูลจริงบอกระยะยื่นมา (z) เอง ท่าเขียนมือใช้การเดา: ยิ่งยกมือสูงยิ่งยื่นไปข้างหน้า
  const wristForward = z ?? FORWARD_BASE + FORWARD_GAIN * raise;
  const wristTarget = toWorldPoint(rig, side, hand, wristForward);
  wristTarget.z += extraForward;
  const outward = shoulderBind.pos.x >= 0 ? 1 : -1;
  const elbowHint = shoulderBind.pos.clone().add(new THREE.Vector3(outward * ELBOW_OUT, -1, -ELBOW_BACK).multiplyScalar(rig.armLength));
  // ทิศนิ้วโดยประมาณ (จากมุม a บนจอ) ใช้ตรวจว่ามือจะจมเข้าตัวหรือไม่
  const handDir = new THREE.Vector3(Math.sin(hand.a), Math.cos(hand.a), 0.15).normalize();
  const handLength = handBind.pos.distanceTo(rig.bind.get(fingerBones(side, "Middle")[2])!.pos) * HAND_LENGTH_GAIN;
  const prev = prevElbows.get(rig) ?? {};
  const { elbow, wrist } = solveArm3D(rig, shoulderBind.pos, wristTarget, elbowHint, l1, l2, { dir: handDir, length: handLength }, prev[side]);
  prev[side] = { elbow: elbow.clone(), wrist: wristTarget.clone() };
  prevElbows.set(rig, prev);

  // ระนาบที่แขนพับ: แกนพับของข้อศอก (ตอน bind แขนกางตรง ใช้แกนที่ทำให้ท่อนแขนพับมาข้างหน้า)
  const restUpperDir = foreBind.pos.clone().sub(shoulderBind.pos).normalize();
  const bindHinge = restUpperDir.clone().cross(new THREE.Vector3(0, 0, 1)).normalize();
  const upperDir = elbow.clone().sub(shoulderBind.pos).normalize();
  const foreDir = wrist.clone().sub(elbow).normalize();
  const hinge = upperDir.clone().cross(foreDir);
  if (hinge.lengthSq() < 1e-4) {
    // แขนเกือบตรง: ระนาบพับไม่ชัด ใช้ทิศข้อศอกที่ข้อมูลบอกแทน
    hinge.copy(upperDir).cross(elbowHint.clone().sub(shoulderBind.pos).cross(upperDir).cross(upperDir).negate());
    if (hinge.lengthSq() < 1e-4) hinge.copy(upperDir).cross(new THREE.Vector3(0, 0, 1));
  }
  hinge.normalize();

  // ---- ต้นแขน: พาทิศกระดูกและแกนพับตอน bind ไปยังทิศใหม่ (กำหนดการบิดรอบต้นแขนด้วย) ----
  const upperWorldQuat = frameQuat(restUpperDir, bindHinge, upperDir, hinge).multiply(shoulderBind.worldQuat);
  rig.bones.get(upperName)!.quaternion.copy(shoulderParentBind.worldQuat.clone().invert().multiply(upperWorldQuat));

  // ---- ท่อนแขนล่าง: พับรอบแกนพับเดียวกัน จากแนวต้นแขนไปยังทิศที่ชี้ไปข้อมือ ----
  const restForeDir = handBind.pos.clone().sub(foreBind.pos).normalize().applyQuaternion(
    upperWorldQuat.clone().multiply(shoulderBind.worldQuat.clone().invert()),
  );
  const foreWorldQuat = new THREE.Quaternion()
    .setFromUnitVectors(restForeDir, foreDir)
    .multiply(upperWorldQuat.clone().multiply(shoulderBind.worldQuat.clone().invert()))
    .multiply(foreBind.worldQuat);
  rig.bones.get(foreName)!.quaternion.copy(upperWorldQuat.clone().invert().multiply(foreWorldQuat));
}

// บิดข้อมือตามมุม a ของท่ามือ (หมุนรอบแกนของมือเอง แบบเดียวกับที่งอนิ้ว คือหมุน "สัมพัทธ์"
// กับท่อนแขนล่างเสมอ ไม่ว่าท่อนแขนจะหมุนไปทางไหนก็ตาม ถ้าอ้างอิงกับทิศทาง bind pose เดิม
// (ตอนแขนกางตรงข้างลำตัว) ตรง ๆ มือจะบิดผิดทิศทันทีที่ยกแขนขึ้นมาทำท่า)
function poseWrist(rig: Rig, side: Side, hand: HandPair["r"]) {
  const handName = ARM_BONES[side][2];
  const bindLocal = rig.bind.get(handName)!.localQuat;
  if (hand.z !== undefined) return aimHand(rig, side, hand);
  const twist = (hand.a - REST_ANGLE) * WRIST_TWIST_GAIN;
  const delta = new THREE.Quaternion().setFromAxisAngle(rig.handTwistAxis[side], twist);
  rig.bones.get(handName)!.quaternion.copy(bindLocal.clone().multiply(delta));
}

// สร้างการหมุนที่พาแกน (นิ้ว, กว้างฝ่ามือ) ในกรอบพิกัดของมือ ไปตรงกับทิศเป้าหมายในโลก 3D
function basisQuat(fLocal: THREE.Vector3, wLocal: THREE.Vector3, fWorld: THREE.Vector3, wWorld: THREE.Vector3) {
  const ortho = (f: THREE.Vector3, w: THREE.Vector3) => {
    const ww = w.clone().addScaledVector(f, -w.dot(f)).normalize();
    return new THREE.Matrix4().makeBasis(f, ww, f.clone().cross(ww));
  };
  const m = ortho(fWorld, wWorld).multiply(ortho(fLocal, wLocal).transpose());
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

// จำกัดการพับข้อมือ: แยกการหมุนของมือเทียบท่อนแขนเป็น "พับ" (swing) กับ "บิด" (twist รอบแกนนิ้ว)
//   แล้วลดส่วนพับไม่ให้เกิน MAX_WRIST_SWING (ส่วนบิดคงไว้ ทิศฝ่ามือจึงยังตรงกับข้อมูล) คืนผลและมุมพับที่ต้องการเดิม
function limitWristInfo(local: THREE.Quaternion, bindLocal: THREE.Quaternion, twistAxis: THREE.Vector3): { q: THREE.Quaternion; swing: number } {
  const rel = bindLocal.clone().invert().multiply(local);
  const proj = twistAxis.clone().multiplyScalar(new THREE.Vector3(rel.x, rel.y, rel.z).dot(twistAxis));
  const twist = new THREE.Quaternion(proj.x, proj.y, proj.z, rel.w);
  if (twist.lengthSq() < 1e-10) twist.identity();
  else twist.normalize();
  const swing = rel.clone().multiply(twist.clone().invert());
  // ใช้รูปแบบที่ w ≥ 0 (หมุนทางสั้น) ให้ทิศพับคงที่ ไม่กลับทางเมื่อมุมใกล้ 180°
  if (swing.w < 0) swing.set(-swing.x, -swing.y, -swing.z, -swing.w);
  const angle = 2 * Math.acos(Math.min(1, swing.w));
  if (angle <= MAX_WRIST_SWING) return { q: local, swing: angle };
  const limited = new THREE.Quaternion().slerp(swing, MAX_WRIST_SWING / angle);
  return { q: bindLocal.clone().multiply(limited).multiply(twist), swing: angle };
}

// หันมือตามข้อมูลจริงเมื่อมองจากด้านหน้า: ปลายนิ้วชี้ไปตามมุม a และฝ่ามือหันตามแนวกว้าง/ด้านที่เห็นในภาพ
// (มุม a วัดจากภาพ 2 มิติ ไม่ใช่การบิดข้อมือรอบแขน) ถ้าไม่มีข้อมูลฝ่ามือ จะหันแค่ปลายนิ้ว
function aimHand(rig: Rig, side: Side, hand: HandPair["r"]) {
  const handName = ARM_BONES[side][2];
  const bone = rig.bones.get(handName)!;
  const bindLocal = rig.bind.get(handName)!.localQuat;
  bone.quaternion.copy(bindLocal);
  bone.parent!.updateWorldMatrix(true, false);
  const parentWorld = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  const currentWorld = parentWorld.clone().multiply(bone.quaternion);
  // ความลึกของปลายนิ้ว: ตามทิศท่อนแขนบางส่วน (แขนยื่นไปข้างหน้า มือก็ยื่นตาม)
  const forearmDir = rig.handTwistAxis[side].clone().applyQuaternion(currentWorld);
  const want = new THREE.Vector3(Math.sin(hand.a), Math.cos(hand.a), 0);
  want.z = forearmDir.z * FINGER_DEPTH_FOLLOW * Math.hypot(want.x, want.y);
  want.normalize();

  const parentInv = parentWorld.clone().invert();
  const prevState = prevHands.get(rig)?.[side];
  const prev = prevState?.world;
  // แปลงการหันมือที่ต้องการ (ในโลก) เป็นค่าของกระดูกมือที่จำกัดการพับข้อมือแล้ว
  const limitedOf = (world: THREE.Quaternion) => limitWristInfo(parentInv.clone().multiply(world), bindLocal, rig.handTwistAxis[side]);

  let local: THREE.Quaternion;
  // ทิศฝ่ามือ (w, p) ใช้เฉพาะท่าจากคลิปที่มีข้อมูล 3 มิติ (มี j) — คลิป TSL เป็นภาพ 2 มิติ บอกไม่ได้ว่าฝ่ามือหันเข้า/ออก
  //   เดาแล้วมือพลิกไปมา จึงให้มือชี้ตามมุม a และบิดตามท่อนแขนแบบคงที่แทน
  if (hand.w && hand.j) {
    // แนวกว้างฝ่ามือบนจอ (แกน y ของจอชี้ลง แต่ของโลก 3D ชี้ขึ้น) + ความลึกจากสัดส่วนที่เห็นเต็มฝ่า
    const [wx, wy, seen] = hand.w;
    const vis = Math.min(Math.max(seen, 0), 1);
    const depth = Math.sqrt(Math.max(0, 1 - vis * vis));
    // ทางเลือก: ความลึกไปหน้า/หลัง (sz) และแนวกว้างฝ่ามือกลับทิศ (ws) — ตอนเห็นสันมือ (vis น้อย) แนวกว้างกลับทิศ
    //   แทบไม่เปลี่ยนภาพด้านหน้า แต่ข้อมูลอาจกลับทิศกะทันหัน จึงยอมให้กลับได้เพื่อความต่อเนื่อง (ลงโทษตาม vis)
    //   ทุกทางเลือกจำกัดการพับข้อมือก่อนให้คะแนน (เทียบกันที่ท่าที่ทำได้จริง)
    const options = [1, -1].flatMap((ws) =>
      [1, -1].map((sz) => {
        const w = new THREE.Vector3(ws * wx * vis, -ws * wy * vis, sz * depth);
        const lim = limitedOf(basisQuat(rig.handTwistAxis[side], rig.handWidthAxis[side], want, w));
        const world = parentWorld.clone().multiply(lim.q);
        const palm = rig.palmOutAxis[side].clone().applyQuaternion(world);
        // ใกล้การหันมือของเฟรมก่อน = ได้คะแนนเพิ่ม (กันมือพลิกกลับไปมาเมื่อทางเลือกคะแนนใกล้กัน)
        const jump = prev ? world.angleTo(prev) / Math.PI : 0;
        const flip = ws < 0 ? vis * WIDTH_FLIP_PENALTY : 0;
        // ด้านฝ่ามือที่หันเข้ากล้องเชื่อได้น้อยตอนเห็นแต่สันมือ (ข้อมูล 2D แยกไม่ออก) จึงลดน้ำหนักตาม vis
        const facing = palm.z * (hand.p ?? 1) * Math.min(1, vis * FACING_TRUST);
        // ท่าที่ต้องพับข้อมือเกินกว่าทำได้มาก = ข้อมูลไม่น่าเชื่อ ลดคะแนน
        const excess = Math.max(0, lim.swing - MAX_WRIST_SWING) / Math.PI;
        return { q: lim.q, excess, score: facing - jump * HAND_CONTINUITY_WEIGHT - flip - excess * EXCESS_SWING_WEIGHT };
      }),
    );
    // เลือกแบบที่ด้านฝ่ามือหันเข้า/ออกจากกล้องตรงกับข้อมูล ทำได้จริง และต่อเนื่องกับเฟรมก่อนที่สุด
    const best = options.reduce((x, y) => (y.score > x.score ? y : x));
    // ทุกทางเลือกพับข้อมือเกินที่ทำได้มาก (ข้อมูล 2D เพี้ยน) = คงท่ามือเดิมเทียบท่อนแขน แทนการบิดไปหาท่าที่เป็นไปไม่ได้
    local = best.excess * Math.PI > IMPOSSIBLE_EXCESS && prevState ? prevState.local.clone() : best.q;
  } else {
    local = limitedOf(new THREE.Quaternion().setFromUnitVectors(forearmDir, want).multiply(currentWorld)).q;
  }
  // จำกัดความเร็วการหมุนมือต่อเฟรม (ในโลก) แล้วจำกัดการพับข้อมืออีกครั้ง
  let world = parentWorld.clone().multiply(local);
  if (prev) {
    const turn = world.angleTo(prev);
    if (turn > MAX_HAND_TURN_PER_FRAME) {
      world = prev.clone().slerp(world, MAX_HAND_TURN_PER_FRAME / turn);
      local = limitedOf(world).q;
      world = parentWorld.clone().multiply(local);
    }
  }
  bone.quaternion.copy(local);
  // จำการหันมือ (ในโลกและเทียบท่อนแขน) ไว้ให้เฟรมถัดไปเลือกแบบที่ต่อเนื่อง
  const hands = prevHands.get(rig) ?? {};
  hands[side] = { world, local: local.clone() };
  prevHands.set(rig, hands);
}

// มุมกางนิ้ว (เรเดียน) ที่ยอมให้ กันนิ้วบิดผิดรูปเมื่อข้อมูลตรวจจับเพี้ยน (ลบ = หุบเข้าหานิ้วกลาง)
const SPREAD_MIN = -0.15;
const SPREAD_MAX = 0.45;
// มุมงอสูงสุดของข้อโคน กลาง ปลาย (เรเดียน) และงอย้อนได้เล็กน้อย
const JOINT_MAX = [1.6, 1.9, 1.3];
const JOINT_MIN = -0.15;
// ลำดับ index ของนิ้วที่มีข้อมูลกางนิ้ว (ชี้ นาง ก้อย)
const SPREAD_SLOT: Partial<Record<(typeof FINGERS)[number], number>> = { Index: 0, Ring: 1, Pinky: 2 };

// งอนิ้วทั้งห้า: ถ้ามีข้อมูลรายข้อ (j เรเดียน จากคลิป 3 มิติ) งอทีละข้อตามจริง ไม่งั้นใช้ curl รวม พร้อมกางนิ้วตาม s
function poseFingers(rig: Rig, side: Side, hand: HandPair["r"]) {
  FINGERS.forEach((finger) => {
    const idx = CURL_INDEX[finger];
    const curl = hand.c[idx] ?? 0;
    const joints = idx > 0 ? hand.j?.[idx - 1] : undefined;
    const slot = SPREAD_SLOT[finger];
    const spread = slot !== undefined && hand.s ? Math.max(SPREAD_MIN, Math.min(SPREAD_MAX, hand.s[slot] ?? 0)) : 0;
    fingerBones(side, finger).forEach((name, i) => {
      const axis = rig.fingerAxis.get(name)!;
      const q = rig.bind.get(name)!.localQuat.clone();
      // กางนิ้วที่ข้อโคน (ก่อนงอ) หมุนรอบแกนตั้งฉากฝ่ามือ
      const spreadAxis = i === 0 ? rig.spreadAxis.get(name) : undefined;
      if (spreadAxis && spread) q.multiply(new THREE.Quaternion().setFromAxisAngle(spreadAxis, spread));
      const raw = joints?.[i] ?? CURL_TO_RAD[i] * curl;
      const bend = Math.max(JOINT_MIN, Math.min(JOINT_MAX[i], raw));
      q.multiply(new THREE.Quaternion().setFromAxisAngle(axis, bend));
      rig.bones.get(name)!.quaternion.copy(q);
    });
  });
}

// เอียงศีรษะเล็กน้อยตามสีหน้า (rot) ให้พอสื่ออารมณ์ได้บ้างแม้โมเดลนี้ไม่มี blendshape หน้า
function poseHead(rig: Rig, face: Face) {
  const bindLocal = rig.bind.get(HEAD_BONE)!.localQuat;
  const angle = Math.max(-MAX_HEAD_TILT, Math.min(MAX_HEAD_TILT, face.rot * 1.4));
  const delta = new THREE.Quaternion().setFromAxisAngle(rig.headTiltAxis, angle);
  rig.bones.get(HEAD_BONE)!.quaternion.copy(bindLocal.clone().multiply(delta));
}

// ปลายนิ้วจมเข้าตัวได้ไม่เกินเท่านี้ (สัดส่วนความยาวแขน) ก่อนจะดันมือออก
const FINGER_SINK_TOLERANCE = 0.012;
// ข้อนิ้วที่ใช้ตรวจว่ามือจมเข้าตัวหรือไม่ (โคนนิ้วกลางและปลายนิ้วทุกนิ้ว)
const FINGER_CHECK = ["Middle1", "Thumb3", "Index3", "Middle3", "Ring3", "Pinky3"];

// ความลึกสูงสุดที่ข้อนิ้วจมเข้าตัว (ตำแหน่งจริงของกระดูกหลังจัดท่าแล้ว)
function fingerPenetration(rig: Rig, side: Side): number {
  const prefix = side === "r" ? "mixamorigRightHand" : "mixamorigLeftHand";
  rig.bones.get(ARM_BONES[side][0])!.updateWorldMatrix(true, true);
  let worst = 0;
  for (const name of FINGER_CHECK) {
    const p = rig.bones.get(prefix + name)!.getWorldPosition(new THREE.Vector3());
    const r = (p.y > rig.body.headY ? HAND_RADIUS_HEAD : HAND_RADIUS * 0.5) * rig.armLength;
    worst = Math.max(worst, penetration(rig, p, r));
  }
  return worst;
}

// จัดท่าตัวละครทั้งตัวหนึ่งเฟรม จากท่ามือ (ตำแหน่ง/มุม/การงอนิ้ว) และสีหน้าปัจจุบัน
export function applyPose(rig: Rig, hands: HandPair, face: Face) {
  rig.skeleton.pose(); // รีเซ็ตทุกกระดูกกลับท่ายืนตั้งต้นก่อน กันการหมุนสะสมผิดเพี้ยน
  (["r", "l"] as Side[]).forEach((side) => {
    poseArm(rig, side, hands[side]);
    poseWrist(rig, side, hands[side]);
    poseFingers(rig, side, hands[side]);
    // ตรวจปลายนิ้วจริงหลังจัดท่ามือแล้ว: ยังจมเข้าตัวอยู่ ดันข้อมือมาข้างหน้าเท่าที่จม แล้วจัดใหม่อีกรอบ
    const sink = fingerPenetration(rig, side);
    if (sink > FINGER_SINK_TOLERANCE * rig.armLength) {
      poseArm(rig, side, hands[side], sink);
      poseWrist(rig, side, hands[side]);
      poseFingers(rig, side, hands[side]);
    }
  });

  poseHead(rig, face);
}

// กระดูกที่ขยับตามท่า (แขน มือ นิ้ว หัว) ใช้ทำให้การเคลื่อนไหวต่อเนื่องระหว่างเฟรม
export function posedBones(rig: Rig): THREE.Bone[] {
  const names = new Set<string>([HEAD_BONE]);
  (["r", "l"] as Side[]).forEach((side) => {
    ARM_BONES[side].forEach((n) => names.add(n));
    FINGERS.forEach((f) => fingerBones(side, f).forEach((n) => names.add(n)));
  });
  return [...names].map((n) => rig.bones.get(n)!).filter(Boolean);
}
