// สีหน้าของโมเดล VRM ผ่าน blendshape

import type { VRM } from "@pixiv/three-vrm";
import type * as THREE from "three";
import type { Face } from "../avatar/skeleton";

const clamp = (v: number, lo = 0, hi = 1) => Math.min(Math.max(v, lo), hi);

// โมเดล VRM มี blendshape หน้าจริง จึงขยับสีหน้าด้วยของจริงแทนการแปะหน้าการ์ตูน
// พรีเซ็ตมาตรฐาน VRM (happy/sad/aa/blink) ใช้ผ่าน expressionManager ส่วนคิ้ว/ตาเบิกกว้างไม่มีพรีเซ็ต
// จึงสั่ง morph target ของ VRoid (Fcl_BRW_*, Fcl_EYE_Surprised) ตรง ๆ ถ้าโมเดลมี
const BROW_MORPHS = ["Fcl_BRW_Surprised", "Fcl_BRW_Angry", "Fcl_BRW_Sorrow", "Fcl_EYE_Surprised"] as const;

export interface VrmFaceTargets {
  meshes: THREE.Mesh[];
}

// หาเมชที่มี morph target ของคิ้ว/ตา (ทำครั้งเดียวตอนโหลด)
export function findFaceMeshes(vrm: VRM): VrmFaceTargets {
  const meshes: THREE.Mesh[] = [];
  vrm.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.morphTargetDictionary && BROW_MORPHS.some((n) => n in m.morphTargetDictionary!)) meshes.push(m);
  });
  return { meshes };
}

function setMorph(t: VrmFaceTargets, name: string, value: number) {
  for (const m of t.meshes) {
    const i = m.morphTargetDictionary?.[name];
    if (i !== undefined && m.morphTargetInfluences) m.morphTargetInfluences[i] = value;
  }
}

// แปลงค่าสีหน้าของระบบเดิม (Face) เป็นค่า expression ของ VRM
// หมายเหตุ: ต้องเรียก vrm.update(dt) หลังฟังก์ชันนี้ เพื่อให้ expressionManager เขียนค่าลงเมช
export function applyVrmFace(vrm: VRM, targets: VrmFaceTargets, face: Face, now: number): void {
  const em = vrm.expressionManager;
  if (!em) return;

  // ท่าปกติของระบบเดิมยิ้มเล็กน้อย (smile = 0.15) นับเป็นหน้านิ่ง ไม่ใช่ยิ้ม
  const smile = face.smile - 0.15;
  em.setValue("happy", clamp(smile * 1.1) * 0.6);
  em.setValue("sad", clamp(-smile) * 0.8);
  em.setValue("aa", clamp(face.open));

  // กะพริบตาเป็นช่วง ๆ (จังหวะเดียวกับหน้าการ์ตูนเดิม) รวมกับตาหรี่จากข้อมูลสีหน้า
  const phase = now % 3800;
  const periodic = phase < 150 ? 1 - Math.max(Math.abs(phase - 75) / 75, 0.05) : 0;
  em.setValue("blink", Math.max(clamp(1 - face.eye), periodic));

  // คิ้วยก = ตกใจ/ถามคำถาม, คิ้วลด/ปลายในลง = เข้ม, ปลายในยก = กังวล
  setMorph(targets, "Fcl_BRW_Surprised", clamp(face.brow));
  setMorph(targets, "Fcl_BRW_Angry", Math.max(clamp(-face.brow), clamp(-face.tilt)));
  setMorph(targets, "Fcl_BRW_Sorrow", clamp(face.tilt));
  setMorph(targets, "Fcl_EYE_Surprised", clamp((face.eye - 1) / 0.3));
}
