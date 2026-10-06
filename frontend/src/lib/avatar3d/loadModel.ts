import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { FOREARM, UPPER_ARM, type Side } from "../avatar/skeleton";
import { ARM_BONES, FINGERS, HEAD_BONE, SHOULDER_BONES, fingerBones } from "./bones";

const MODEL_URL = "/models/x-bot.fbx";

// ตำแหน่งและการหมุนของกระดูกหนึ่งชิ้น ณ ท่ายืนตั้งต้น (bind pose)
export interface BindPose {
  pos: THREE.Vector3;
  worldQuat: THREE.Quaternion;
  localQuat: THREE.Quaternion;
}

// รูปร่างลำตัวและศีรษะที่วัดจากเมชจริงตอน bind เป็นตาราง (แถว = ความสูง, คอลัมน์ = แนวนอน)
//   แต่ละช่องเก็บผิวหน้าสุด (front) และหลังสุด (back) ของเนื้อตัว (NaN = ช่องนั้นไม่มีตัว) ใช้กันแขนทะลุตัว
export interface BodyProfile {
  y0: number;
  dy: number;
  x0: number;
  dx: number;
  rows: number;
  cols: number;
  front: Float32Array;
  back: Float32Array;
  // ความสูงที่เหนือจากนี้เป็นศีรษะ (ให้มือแตะหน้าได้ใกล้กว่าลำตัว)
  headY: number;
}

// แผ่นหน้าการ์ตูนที่แปะหน้าศีรษะ: offset/size ในกรอบพิกัดของกระดูกหัว และจุดกลาง/ครึ่งขนาดในโลก (ตอน bind)
export interface FaceCard {
  offset: THREE.Vector3;
  size: number;
  center: THREE.Vector3;
  half: number;
}

// ข้อมูลทั้งหมดที่เตรียมไว้ล่วงหน้าสำหรับขยับโมเดล 3D ตามท่าภาษามือ
export interface Rig {
  root: THREE.Object3D;
  skeleton: THREE.Skeleton;
  bones: Map<string, THREE.Bone>;
  bind: Map<string, BindPose>;
  // แกนที่ใช้งอแต่ละข้อนิ้ว (อยู่ในกรอบพิกัดของกระดูกข้อนั้นเอง ตอน bind)
  fingerAxis: Map<string, THREE.Vector3>;
  // แกนที่ใช้บิดข้อมือ = ทิศนิ้ว (อยู่ในกรอบพิกัดของกระดูกมือเอง ตอน bind)
  handTwistAxis: Record<Side, THREE.Vector3>;
  // แนวกว้างฝ่ามือ โคนนิ้วชี้ → โคนนิ้วก้อย (กรอบพิกัดของกระดูกมือ ตอน bind)
  handWidthAxis: Record<Side, THREE.Vector3>;
  // ทิศที่ด้านฝ่ามือหันออกไป (กรอบพิกัดของกระดูกมือ ตอน bind)
  palmOutAxis: Record<Side, THREE.Vector3>;
  // แกนกางนิ้ว (อยู่ในกรอบพิกัดของกระดูกโคนนิ้ว ตอน bind) หมุนมุมบวกแล้วนิ้วกางออกจากนิ้วกลาง
  spreadAxis: Map<string, THREE.Vector3>;
  // รูปร่างลำตัว+ศีรษะ ใช้ดันแขน/มือมาข้างหน้าไม่ให้ทะลุเข้าตัว
  body: BodyProfile;
  // แผ่นหน้าการ์ตูน (มือที่แตะหน้าต้องอยู่หน้าแผ่นนี้ ไม่งั้นมือจะหายไปหลังหน้า)
  faceCard: FaceCard;
  // ความยาวแขนทั้งเส้น (ไหล่ → ข้อมือ) หน่วยของโมเดล ใช้คิดระยะเผื่อต่าง ๆ
  armLength: number;
  // แกนเอียงศีรษะ (อยู่ในกรอบพิกัดของกระดูกหัวเอง ตอน bind)
  headTiltAxis: THREE.Vector3;
  // ตัวคูณแปลงหน่วยพิกัด 0-1 ของระบบท่าทางเดิม เป็นหน่วยจริงของโมเดลนี้
  armScale: number;
  // ไว้ตั้งกล้องให้เห็นตัวละครพอดีเฟรม
  frame: { headTop: THREE.Vector3; chest: THREE.Vector3; height: number };
}

let rigPromise: Promise<Rig> | null = null;

// โหลดโมเดล X Bot ครั้งเดียวแล้วจำไว้ (เหมือน loadHolistic)
export function loadRig(): Promise<Rig> {
  if (!rigPromise) {
    rigPromise = build().catch((err) => {
      rigPromise = null;
      throw err;
    });
  }
  return rigPromise;
}

// โหลดไฟล์ FBX จริง แล้วเตรียมโมเดลให้พร้อมขยับ
async function build(): Promise<Rig> {
  return buildRig(await new FBXLoader().loadAsync(MODEL_URL));
}

// เตรียมท่า bind pose และคำนวณค่าคาลิเบรตทั้งหมดที่ applyPose ต้องใช้จากโมเดลที่โหลดแล้ว (แยกออกมาให้ทดสอบได้)
export function buildRig(root: THREE.Group): Rig {

  const skinnedMeshes: THREE.SkinnedMesh[] = [];
  root.traverse((obj) => {
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshes.push(obj as THREE.SkinnedMesh);
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      // แทนวัสดุเดิมด้วยโทนสีธีมของแอป (นวล/ฟ้า) แทนสีเทาเริ่มต้นของโมเดล
      mesh.material = new THREE.MeshStandardMaterial({
        color: 0xd7e6ec,
        emissive: 0x123244,
        emissiveIntensity: 0.35,
        roughness: 0.55,
        metalness: 0.05,
      });
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    }
  });
  const skinned = skinnedMeshes[0];
  if (!skinned) throw new Error("x-bot.fbx: ไม่พบ SkinnedMesh ในไฟล์โมเดล");
  const skeleton = skinned.skeleton;

  skeleton.pose();
  root.updateMatrixWorld(true);

  const bones = new Map<string, THREE.Bone>();
  for (const b of skeleton.bones) bones.set(b.name, b);

  const need = (name: string): THREE.Bone => {
    const b = bones.get(name);
    if (!b) throw new Error(`x-bot.fbx: ไม่พบกระดูก ${name}`);
    return b;
  };

  const bind = new Map<string, BindPose>();
  const capture = (name: string) => {
    const b = need(name);
    const pos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    b.getWorldPosition(pos);
    b.getWorldQuaternion(worldQuat);
    bind.set(name, { pos, worldQuat, localQuat: b.quaternion.clone() });
  };

  const allNames = new Set<string>([HEAD_BONE, "mixamorigNeck", "mixamorigHeadTop_End", "mixamorigHips"]);
  (["r", "l"] as Side[]).forEach((side) => {
    allNames.add(SHOULDER_BONES[side]);
    ARM_BONES[side].forEach((n) => allNames.add(n));
    FINGERS.forEach((f) => fingerBones(side, f).forEach((n) => allNames.add(n)));
  });
  allNames.forEach(capture);

  // ---- สเกลแขน: เทียบความยาวแขนจริงของโมเดลกับหน่วย 0-1 ที่ระบบท่าทางเดิมใช้ ----
  const [rArm, rFore, rHand] = ARM_BONES.r;
  const upperLen = bind.get(rArm)!.pos.distanceTo(bind.get(rFore)!.pos);
  const foreLen = bind.get(rFore)!.pos.distanceTo(bind.get(rHand)!.pos);
  const armScale = (upperLen + foreLen) / (UPPER_ARM + FOREARM);

  // ---- แกนงอนิ้ว: หาจากทิศของนิ้วชี้กับนิ้วก้อยตอน bind (ตั้งฉากกับฝ่ามือ) ----
  const fingerAxis = new Map<string, THREE.Vector3>();
  const spreadAxis = new Map<string, THREE.Vector3>();
  const handTwistAxis: Record<Side, THREE.Vector3> = { r: new THREE.Vector3(), l: new THREE.Vector3() };
  const handWidthAxis: Record<Side, THREE.Vector3> = { r: new THREE.Vector3(), l: new THREE.Vector3() };
  const palmOutAxis: Record<Side, THREE.Vector3> = { r: new THREE.Vector3(), l: new THREE.Vector3() };

  (["r", "l"] as Side[]).forEach((side) => {
    const handPos = bind.get(ARM_BONES[side][2])!.pos;
    const idxPos = bind.get(fingerBones(side, "Index")[0])!.pos;
    const pinkyPos = bind.get(fingerBones(side, "Pinky")[0])!.pos;
    const midPos = bind.get(fingerBones(side, "Middle")[0])!.pos;
    const thumbEnd = bind.get(fingerBones(side, "Thumb")[2])!.pos;

    // ทิศนิ้ว (ข้อมือ → โคนนิ้วชี้/กลาง/ก้อยเฉลี่ย) และแนวกว้างฝ่ามือ (โคนนิ้วชี้ → โคนนิ้วก้อย)
    const forward = idxPos
      .clone()
      .add(pinkyPos)
      .add(midPos)
      .multiplyScalar(1 / 3)
      .sub(handPos)
      .normalize();
    const width = pinkyPos.clone().sub(idxPos);
    width.addScaledVector(forward, -width.dot(forward)).normalize();
    // ด้านฝ่ามือ = แนวตั้งฉากกับฝ่ามือ ฝั่งเดียวกับนิ้วโป้ง (นิ้วโป้งอยู่ฝั่งฝ่ามือเสมอ)
    const palmOut = forward.clone().cross(width).normalize();
    if (palmOut.dot(thumbEnd.clone().sub(handPos)) < 0) palmOut.negate();

    // แกนงอของแต่ละนิ้ว = ขวางกับทิศของนิ้วนั้นและขนานกับฝ่ามือ หมุนมุมบวกแล้วปลายนิ้วงอเข้าหาฝ่ามือ
    // (เดิมใช้แกนตั้งฉากกับฝ่ามือ ซึ่งทำให้นิ้วกวาดไปด้านข้างแทนที่จะงอ)
    FINGERS.forEach((finger) => {
      const [b1, , b3] = fingerBones(side, finger);
      const dir = bind.get(b3)!.pos.clone().sub(bind.get(b1)!.pos).normalize();
      const axisWorld = dir.clone().cross(palmOut).normalize();
      fingerBones(side, finger).forEach((name) => {
        const b = bind.get(name)!;
        fingerAxis.set(name, axisWorld.clone().applyQuaternion(b.worldQuat.clone().invert()).normalize());
      });
    });

    // แกนกางนิ้ว = แกนตั้งฉากฝ่ามือ (palmOut) เลือกเครื่องหมายให้หมุนบวกแล้วนิ้วห่างจากนิ้วกลาง
    (["Index", "Ring", "Pinky"] as const).forEach((finger) => {
      const [b1, , b3] = fingerBones(side, finger);
      const dir = bind.get(b3)!.pos.clone().sub(bind.get(b1)!.pos).normalize();
      // ทิศ "ออกจากนิ้วกลาง" ตามแนวกว้างฝ่ามือ (นิ้วที่อยู่ฝั่งชี้ไปทางชี้ ฝั่งก้อยไปทางก้อย) เทียบกับทิศที่ปลายนิ้วเคลื่อนเมื่อหมุนบวก
      const outward = Math.sign(bind.get(b1)!.pos.clone().sub(bind.get(fingerBones(side, "Middle")[0])!.pos).dot(width)) || 1;
      const sweep = palmOut.clone().cross(dir);
      const sign = Math.sign(sweep.dot(width) * outward) || 1;
      const axisWorld = palmOut.clone().multiplyScalar(sign);
      const b = bind.get(b1)!;
      spreadAxis.set(b1, axisWorld.applyQuaternion(b.worldQuat.clone().invert()).normalize());
    });

    const handBind = bind.get(ARM_BONES[side][2])!;
    const toLocal = handBind.worldQuat.clone().invert();
    handTwistAxis[side] = forward.clone().applyQuaternion(toLocal).normalize();
    handWidthAxis[side] = width.applyQuaternion(toLocal).normalize();
    palmOutAxis[side] = palmOut.applyQuaternion(toLocal).normalize();
  });

  // ---- แกนเอียงศีรษะ: ใช้แกน Z ของโลก (เข้า-ออกจากกล้อง) แปลงเป็นพิกัดของกระดูกหัวเอง ----
  const headBind = bind.get(HEAD_BONE)!;
  const headTiltAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(headBind.worldQuat.clone().invert()).normalize();

  const headTopBind = bind.get("mixamorigHeadTop_End")!;
  const body = measureBody(skinnedMeshes, bind.get("mixamorigHips")!.pos.y, headTopBind.pos.y, bind.get("mixamorigNeck")!.pos.y);

  // แผ่นหน้า: จุดกำเนิดของกระดูกหัวอยู่แถวคาง/โคนคอ จึงดันขึ้นไปทางกระหม่อมด้วย ไม่ใช่แค่ดันออกมาข้างหน้า
  const headRadius = headBind.pos.distanceTo(headTopBind.pos);
  const headUp = new THREE.Vector3(0, 1, 0).applyQuaternion(headBind.worldQuat.clone().invert()).normalize();
  const faceOffset = headTiltAxis.clone().multiplyScalar(headRadius * 0.82).addScaledVector(headUp, headRadius * 0.28);
  const faceSize = headRadius * 1.15;
  const faceCard: FaceCard = {
    offset: faceOffset,
    size: faceSize,
    center: faceOffset.clone().applyQuaternion(headBind.worldQuat).add(headBind.pos),
    half: faceSize / 2,
  };
  const chest = new THREE.Vector3().addVectors(bind.get(SHOULDER_BONES.r)!.pos, bind.get(SHOULDER_BONES.l)!.pos).multiplyScalar(0.5);
  const height = headTopBind.pos.y - chest.y;

  return {
    root,
    skeleton,
    bones,
    bind,
    fingerAxis,
    handTwistAxis,
    handWidthAxis,
    palmOutAxis,
    spreadAxis,
    body,
    faceCard,
    armLength: upperLen + foreLen,
    headTiltAxis,
    armScale,
    frame: { headTop: headTopBind.pos.clone(), chest, height },
  };
}

// ขนาดช่องของตารางรูปร่างลำตัว (หน่วยของโมเดล = ซม.) และความกว้างที่ครอบคลุมจากแกนกลาง
const BODY_CELL = 2;
const BODY_HALF_WIDTH = 30;
// จุดยอดที่ผูกกับกระดูกแขน/มือเป็นหลักไม่นับเป็นลำตัว (ตอน bind แขนกางออกด้านข้าง)
const ARM_BONE_RE = /(Arm|Hand)/;

// วัดรูปร่างลำตัวและศีรษะจากจุดยอดของทุกเมชในท่า bind (ตัดจุดยอดของแขน/มือออกตาม skin weight)
function measureBody(meshes: THREE.SkinnedMesh[], yBottom: number, yTop: number, neckY: number): BodyProfile {
  const rows = Math.ceil((yTop - yBottom) / BODY_CELL) + 1;
  const cols = Math.ceil((BODY_HALF_WIDTH * 2) / BODY_CELL);
  const x0 = -BODY_HALF_WIDTH;
  const front = new Float32Array(rows * cols).fill(Number.NaN);
  const back = new Float32Array(rows * cols).fill(Number.NaN);
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const skinIndex = geo.attributes.skinIndex;
    const skinWeight = geo.attributes.skinWeight;
    const bones = mesh.skeleton.bones;
    for (let i = 0; i < geo.attributes.position.count; i++) {
      // กระดูกที่มีน้ำหนักมากที่สุดของจุดยอดนี้
      let best = 0;
      let bestW = -1;
      for (let k = 0; k < 4; k++) {
        const w = skinWeight.getComponent(i, k);
        if (w > bestW) [best, bestW] = [skinIndex.getComponent(i, k), w];
      }
      if (ARM_BONE_RE.test(bones[best]?.name ?? "")) continue;
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
      const r = Math.floor((v.y - yBottom) / BODY_CELL);
      const c = Math.floor((v.x - x0) / BODY_CELL);
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      const k = r * cols + c;
      if (!(front[k] >= v.z)) front[k] = v.z;
      if (!(back[k] <= v.z)) back[k] = v.z;
    }
  }
  return { y0: yBottom, dy: BODY_CELL, x0, dx: BODY_CELL, rows, cols, front, back, headY: neckY };
}
