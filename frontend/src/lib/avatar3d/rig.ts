import * as THREE from "three";
import { computeFigure, HEAD, REST, SHOULDER, type Arm, type Face, type HandPair, type Side } from "../avatar/skeleton";
import { ARM_BONES, CURL_INDEX, FINGERS, HEAD_BONE, SHOULDER_BONES, fingerBones } from "./bones";
import type { Rig } from "./loadModel";

// มุมงอสูงสุดของแต่ละข้อนิ้ว (เรเดียน) ตั้งแต่ข้อโคนถึงปลาย
const FINGER_BEND = [0.9, 1.1, 0.8];
// อัตราขยายมุมบิดข้อมือ ต่อหน่วยมุม a ที่เปลี่ยนไปจากท่าพัก
const WRIST_TWIST_GAIN = 1.1;
// มือยิ่งเหยียดออกจากลำตัวมาก ยิ่งยื่นมาข้างหน้า (ทำให้ท่าดูเป็นธรรมชาติ ไม่แบนติดลำตัว)
const FORWARD_BASE = 0.12;
const FORWARD_GAIN = 0.42;
const ELBOW_FORWARD_BASE = 0.05;
const ELBOW_FORWARD_GAIN = 0.12;
const MAX_HEAD_TILT = 0.32;
const REST_ANGLE = Math.PI; // มุม a ตอนท่าพัก (มือคว่ำห้อยลง)

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

// หมุนกระดูก "ต้นแขน" และ "ท่อนแขนล่าง" ให้ปลายมือไปถึงจุดเป้าหมายในโลก 3D
// (แปลงจากผล IK แบบ 2D ที่มีอยู่แล้ว แล้วเติมความลึก z เอาเอง)
function poseArm(rig: Rig, side: Side, arm: Arm, z?: number): void {
  const [upperName, foreName] = ARM_BONES[side];
  const shoulderBind = rig.bind.get(upperName)!;
  const foreBind = rig.bind.get(foreName)!;
  const handBind = rig.bind.get(ARM_BONES[side][2])!;
  const shoulderParentBind = rig.bind.get(SHOULDER_BONES[side])!;

  const upperLen = shoulderBind.pos.distanceTo(foreBind.pos);
  // "ยกมือขึ้นแค่ไหน" ไม่ใช่ "ห่างจากไหล่แค่ไหน" เพราะมือที่ห้อยลงข้างตัวตามสบาย
  // ก็ห่างจากไหล่มากอยู่แล้ว (ตกลงมาตามแนวดิ่ง) แต่ไม่ควรยื่นออกมาข้างหน้าเลย
  const restY = REST[side].y;
  const raise = Math.min(Math.max((restY - arm.wrist.y) / (restY - HEAD.y), 0), 1);

  // ท่าจากข้อมูลจริงบอกระยะยื่นมา (z) เอง ท่าเขียนมือใช้การเดา: ยิ่งยกมือสูงยิ่งยื่นไปข้างหน้า
  const wristForward = z ?? FORWARD_BASE + FORWARD_GAIN * raise;
  const elbowForward = z !== undefined ? z * 0.5 : ELBOW_FORWARD_BASE + ELBOW_FORWARD_GAIN * raise;
  const elbowTarget = toWorldPoint(rig, side, arm.elbow, elbowForward);
  const wristTarget = toWorldPoint(rig, side, arm.wrist, wristForward);

  // ---- ต้นแขน: หมุนจากทิศตอน bind ไปยังทิศที่ชี้ไปข้อศอกเป้าหมาย ----
  const restUpperDir = foreBind.pos.clone().sub(shoulderBind.pos).normalize();
  const targetUpperDir = elbowTarget.clone().sub(shoulderBind.pos).normalize();
  const deltaUpper = new THREE.Quaternion().setFromUnitVectors(restUpperDir, targetUpperDir);
  const upperWorldQuat = deltaUpper.multiply(shoulderBind.worldQuat);
  const upperLocalQuat = shoulderParentBind.worldQuat.clone().invert().multiply(upperWorldQuat);
  rig.bones.get(upperName)!.quaternion.copy(upperLocalQuat);

  // ตำแหน่งข้อศอกจริงหลังหมุน (คำนวณตรง ๆ จากทิศที่หมุนไป คูณความยาวต้นแขนจริง)
  const elbowActual = shoulderBind.pos.clone().addScaledVector(targetUpperDir, upperLen);

  // ---- ท่อนแขนล่าง: หมุนจากทิศตอน bind ไปยังทิศที่ชี้ไปข้อมือเป้าหมาย ----
  const restForeDir = handBind.pos.clone().sub(foreBind.pos).normalize();
  const targetForeDir = wristTarget.clone().sub(elbowActual).normalize();
  const deltaFore = new THREE.Quaternion().setFromUnitVectors(restForeDir, targetForeDir);
  const foreWorldQuat = deltaFore.multiply(foreBind.worldQuat);
  const foreLocalQuat = upperWorldQuat.clone().invert().multiply(foreWorldQuat);
  rig.bones.get(foreName)!.quaternion.copy(foreLocalQuat);
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

// หันมือตามข้อมูลจริงเมื่อมองจากด้านหน้า: ปลายนิ้วชี้ไปตามมุม a และฝ่ามือหันตามแนวกว้าง/ด้านที่เห็นในภาพ
// (มุม a วัดจากภาพ 2 มิติ ไม่ใช่การบิดข้อมือรอบแขน) ถ้าไม่มีข้อมูลฝ่ามือ จะหันแค่ปลายนิ้ว
function aimHand(rig: Rig, side: Side, hand: HandPair["r"]) {
  const handName = ARM_BONES[side][2];
  const bone = rig.bones.get(handName)!;
  bone.quaternion.copy(rig.bind.get(handName)!.localQuat);
  bone.parent!.updateWorldMatrix(true, false);
  const parentWorld = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  const currentWorld = parentWorld.clone().multiply(bone.quaternion);
  const want = new THREE.Vector3(Math.sin(hand.a), Math.cos(hand.a), 0.25).normalize();

  let targetWorld: THREE.Quaternion;
  if (hand.w) {
    // แนวกว้างฝ่ามือบนจอ (แกน y ของจอชี้ลง แต่ของโลก 3D ชี้ขึ้น) + ความลึกจากสัดส่วนที่เห็นเต็มฝ่า
    const [wx, wy, seen] = hand.w;
    const vis = Math.min(Math.max(seen, 0), 1);
    const depth = Math.sqrt(Math.max(0, 1 - vis * vis));
    const pick = [1, -1].map((sz) => {
      const w = new THREE.Vector3(wx * vis, -wy * vis, sz * depth);
      const q = basisQuat(rig.handTwistAxis[side], rig.handWidthAxis[side], want, w);
      const palm = rig.palmOutAxis[side].clone().applyQuaternion(q);
      return { q, score: palm.z * (hand.p ?? 1) };
    });
    // เลือกแบบที่ด้านฝ่ามือหันเข้า/ออกจากกล้องตรงกับข้อมูล
    targetWorld = pick[0].score >= pick[1].score ? pick[0].q : pick[1].q;
  } else {
    const fingerDir = rig.handTwistAxis[side].clone().applyQuaternion(currentWorld);
    targetWorld = new THREE.Quaternion().setFromUnitVectors(fingerDir, want).multiply(currentWorld);
  }
  bone.quaternion.copy(parentWorld.invert().multiply(targetWorld));
}

// งอนิ้วทั้งห้าตามค่า curl (0 = กางตรง, 1 = กำแน่น) ของท่ามือ
function poseFingers(rig: Rig, side: Side, hand: HandPair["r"]) {
  FINGERS.forEach((finger) => {
    const curl = hand.c[CURL_INDEX[finger]] ?? 0;
    fingerBones(side, finger).forEach((name, i) => {
      const axis = rig.fingerAxis.get(name)!;
      const bindLocal = rig.bind.get(name)!.localQuat;
      const delta = new THREE.Quaternion().setFromAxisAngle(axis, FINGER_BEND[i] * curl);
      rig.bones.get(name)!.quaternion.copy(bindLocal.clone().multiply(delta));
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

// จัดท่าตัวละครทั้งตัวหนึ่งเฟรม จากท่ามือ (ตำแหน่ง/มุม/การงอนิ้ว) และสีหน้าปัจจุบัน
export function applyPose(rig: Rig, hands: HandPair, face: Face) {
  rig.skeleton.pose(); // รีเซ็ตทุกกระดูกกลับท่ายืนตั้งต้นก่อน กันการหมุนสะสมผิดเพี้ยน
  const figure = computeFigure(hands);

  (["r", "l"] as Side[]).forEach((side) => {
    const arm = side === "r" ? figure.armR : figure.armL;
    poseArm(rig, side, arm, hands[side].z);
    poseWrist(rig, side, hands[side]);
    poseFingers(rig, side, hands[side]);
  });

  poseHead(rig, face);
}
