import type { Take } from "../hooks/useClipRecorder";
import SkeletonVideo from "./SkeletonVideo";

// ค่าที่ตัวเล่นคลิปรับ: คลิป กลับซ้าย-ขวาหรือไม่ และแสดง skeleton หรือไม่
interface Props {
  take: Take;
  mirror: boolean;
  showSkeleton: boolean;
}

// เล่นคลิปที่อัด/อัปโหลดวนซ้ำ พร้อม skeleton ทับ (ใช้ตอนตรวจก่อนกดเก็บ)
export default function ReviewPlayer({ take, mirror, showSkeleton }: Props) {
  return <SkeletonVideo key={take.url} src={take.url} frames={take.frames} mirror={mirror} showSkeleton={showSkeleton} />;
}
