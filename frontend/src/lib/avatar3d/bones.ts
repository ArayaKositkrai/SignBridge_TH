// ชื่อกระดูกของโมเดล 3D (มาตรฐาน Mixamo) ที่ rig.ts ใช้

import type { Side } from "../avatar/skeleton";

// ชื่อกระดูกตามมาตรฐาน Mixamo (ตรวจสอบจากไฟล์ x-bot.fbx จริงแล้ว)
export const ARM_BONES: Record<Side, [string, string, string]> = {
  r: ["mixamorigRightArm", "mixamorigRightForeArm", "mixamorigRightHand"],
  l: ["mixamorigLeftArm", "mixamorigLeftForeArm", "mixamorigLeftHand"],
};

// กระดูกไหล่ (ไหปลาร้า) ที่เราไม่แตะ ใช้เป็นจุดอ้างอิงของต้นแขน
export const SHOULDER_BONES: Record<Side, string> = {
  r: "mixamorigRightShoulder",
  l: "mixamorigLeftShoulder",
};

// กระดูกศีรษะ คอ และปลายบนสุดของหัว (ใช้ตั้งกล้องและเอียงหัว)
export const HEAD_BONE = "mixamorigHead";
export const NECK_BONE = "mixamorigNeck";
export const HEAD_TOP_BONE = "mixamorigHeadTop_End";

// นิ้วแต่ละนิ้ว: ชื่อข้อกระดูก 3 ข้อที่หมุนได้ (ข้อที่ 4 คือปลายนิ้ว ไม่หมุน)
const FINGER_NAMES = ["Thumb", "Index", "Middle", "Ring", "Pinky"] as const;
export type FingerName = (typeof FINGER_NAMES)[number];

export function fingerBones(side: Side, finger: FingerName): [string, string, string] {
  const prefix = side === "r" ? "mixamorigRight" : "mixamorigLeft";
  return [`${prefix}Hand${finger}1`, `${prefix}Hand${finger}2`, `${prefix}Hand${finger}3`];
}

export const FINGERS: FingerName[] = [...FINGER_NAMES];

// ลำดับ curl ในข้อมูลท่ามือ [โป้ง, ชี้, กลาง, นาง, ก้อย] ตรงกับ FINGERS ด้านบนพอดี
export const CURL_INDEX: Record<FingerName, number> = {
  Thumb: 0,
  Index: 1,
  Middle: 2,
  Ring: 3,
  Pinky: 4,
};

// ชื่อกระดูกมาตรฐาน VRM 1.0 -> ชื่อ Mixamo ที่ระบบท่าทางใช้ (ตัวโหลด VRM จะเปลี่ยนชื่อโหนดให้ตรงกัน
// จึงไม่ต้องแก้ rig.ts) นิ้วโป้งของ VRM คือ Metacarpal/Proximal/Distal = ข้อ 1/2/3 ของ Mixamo
export const VRM_TO_MIXAMO: Record<string, string> = (() => {
  const map: Record<string, string> = {
    hips: "mixamorigHips",
    neck: "mixamorigNeck",
    head: "mixamorigHead",
  };
  const fingers: [string, string, [string, string, string]][] = [
    ["Thumb", "Thumb", ["Metacarpal", "Proximal", "Distal"]],
    ["Index", "Index", ["Proximal", "Intermediate", "Distal"]],
    ["Middle", "Middle", ["Proximal", "Intermediate", "Distal"]],
    ["Ring", "Ring", ["Proximal", "Intermediate", "Distal"]],
    ["Little", "Pinky", ["Proximal", "Intermediate", "Distal"]],
  ];
  for (const [vrmSide, mixSide] of [["left", "Left"], ["right", "Right"]] as const) {
    map[`${vrmSide}Shoulder`] = `mixamorig${mixSide}Shoulder`;
    map[`${vrmSide}UpperArm`] = `mixamorig${mixSide}Arm`;
    map[`${vrmSide}LowerArm`] = `mixamorig${mixSide}ForeArm`;
    map[`${vrmSide}Hand`] = `mixamorig${mixSide}Hand`;
    for (const [vrmFinger, mixFinger, parts] of fingers) {
      parts.forEach((part, i) => {
        map[`${vrmSide}${vrmFinger}${part}`] = `mixamorig${mixSide}Hand${mixFinger}${i + 1}`;
      });
    }
  }
  return map;
})();
