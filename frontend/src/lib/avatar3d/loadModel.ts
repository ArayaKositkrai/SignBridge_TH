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

// ข้อมูลทั้งหมดที่เตรียมไว้ล่วงหน้าสำหรับขยับโมเดล 3D ตามท่าภาษามือ
export interface Rig {
  root: THREE.Object3D;
  skeleton: THREE.Skeleton;
  bones: Map<string, THREE.Bone>;
  bind: Map<string, BindPose>;
  // แกนที่ใช้งอแต่ละข้อนิ้ว (อยู่ในกรอบพิกัดของกระดูกข้อนั้นเอง ตอน bind)
  fingerAxis: Map<string, THREE.Vector3>;
  // แกนที่ใช้บิดข้อมือ (อยู่ในกรอบพิกัดของกระดูกมือเอง ตอน bind)
  handTwistAxis: Record<Side, THREE.Vector3>;
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

// โหลดไฟล์ FBX จริง เตรียมท่า bind pose และคำนวณค่าคาลิเบรตทั้งหมดที่ applyPose ต้องใช้
async function build(): Promise<Rig> {
  const root = await new FBXLoader().loadAsync(MODEL_URL);

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

  const allNames = new Set<string>([HEAD_BONE, "mixamorigNeck", "mixamorigHeadTop_End"]);
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
  const handTwistAxis: Record<Side, THREE.Vector3> = { r: new THREE.Vector3(), l: new THREE.Vector3() };

  (["r", "l"] as Side[]).forEach((side) => {
    const handPos = bind.get(ARM_BONES[side][2])!.pos;
    const idxPos = bind.get(fingerBones(side, "Index")[0])!.pos;
    const pinkyPos = bind.get(fingerBones(side, "Pinky")[0])!.pos;
    const midPos = bind.get(fingerBones(side, "Middle")[0])!.pos;
    const v1 = idxPos.clone().sub(handPos).normalize();
    const v2 = pinkyPos.clone().sub(handPos).normalize();
    // ทิศทางของแกนสลับเครื่องหมายกันระหว่างมือซ้าย/ขวาเพราะเรขาคณิตกลับด้านกัน
    const sign = side === "r" ? 1 : -1;
    const palmNormalWorld = v1.clone().cross(v2).normalize().multiplyScalar(sign);

    FINGERS.forEach((finger) => {
      fingerBones(side, finger).forEach((name) => {
        const b = bind.get(name)!;
        const axis = palmNormalWorld.clone().applyQuaternion(b.worldQuat.clone().invert()).normalize();
        fingerAxis.set(name, axis);
      });
    });

    const forward = idxPos
      .clone()
      .add(pinkyPos)
      .add(midPos)
      .multiplyScalar(1 / 3)
      .sub(handPos)
      .normalize();
    const handBind = bind.get(ARM_BONES[side][2])!;
    handTwistAxis[side] = forward.applyQuaternion(handBind.worldQuat.clone().invert()).normalize();
  });

  // ---- แกนเอียงศีรษะ: ใช้แกน Z ของโลก (เข้า-ออกจากกล้อง) แปลงเป็นพิกัดของกระดูกหัวเอง ----
  const headBind = bind.get(HEAD_BONE)!;
  const headTiltAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(headBind.worldQuat.clone().invert()).normalize();

  const headTopBind = bind.get("mixamorigHeadTop_End")!;
  const chest = new THREE.Vector3().addVectors(bind.get(SHOULDER_BONES.r)!.pos, bind.get(SHOULDER_BONES.l)!.pos).multiplyScalar(0.5);
  const height = headTopBind.pos.y - chest.y;

  return {
    root,
    skeleton,
    bones,
    bind,
    fingerAxis,
    handTwistAxis,
    headTiltAxis,
    armScale,
    frame: { headTop: headTopBind.pos.clone(), chest, height },
  };
}
