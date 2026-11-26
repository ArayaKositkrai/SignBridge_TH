// ตัวเล่นคลิปก่อนกดเก็บ

import { useMemo } from "react";
import type { Take } from "../hooks/useClipRecorder";
import { unmirrorFrames } from "../services/extractLandmarks";
import SkeletonOnlyPlayer from "./SkeletonOnlyPlayer";
import SkeletonVideo from "./SkeletonVideo";

// ค่าที่ตัวเล่นคลิปรับ: คลิป กลับซ้าย-ขวาหรือไม่ และแสดง skeleton หรือไม่
interface Props {
  take: Take;
  mirror: boolean;
  showSkeleton: boolean;
}

// เล่นคลิปที่อัด/อัปโหลดวนซ้ำ พร้อม skeleton ทับ (ใช้ตอนตรวจก่อนกดเก็บ); ไฟล์ .npy/.npz ไม่มีวิดีโอ เล่นเฉพาะ skeleton
export default function ReviewPlayer({ take, mirror, showSkeleton }: Props) {
  // คลิปที่กลับซ้าย-ขวาแล้ว: วาดทับวิดีโอต้นฉบับต้องกลับตำแหน่ง x คืน
  const frames = useMemo(() => (take.flipped ? unmirrorFrames(take.frames) : take.frames), [take]);
  if (!take.url) return <SkeletonOnlyPlayer frames={frames} width={take.width} height={take.height} />;
  return <SkeletonVideo key={take.url} src={take.url} frames={frames} mirror={mirror} showSkeleton={showSkeleton} />;
}
