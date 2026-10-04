import type { IconName } from "../components/ui/Icon";

// ไอคอนที่เลือกใช้กับปุ่ม AAC ได้ พร้อมชื่อภาษาไทย (ต้องตรงกับ ALLOWED_ICONS ใน backend)
export const AAC_ICONS: { name: IconName; label: string }[] = [
  { name: "star", label: "ดาว" },
  { name: "food", label: "อาหาร" },
  { name: "water", label: "น้ำ" },
  { name: "toilet", label: "ห้องน้ำ" },
  { name: "pain", label: "เจ็บ" },
  { name: "pill", label: "ยา" },
  { name: "doctor", label: "หมอ" },
  { name: "hospital", label: "โรงพยาบาล" },
  { name: "heart", label: "หัวใจ" },
  { name: "alert", label: "อันตราย" },
  { name: "hand", label: "ช่วย" },
  { name: "confused", label: "ไม่เข้าใจ" },
  { name: "check", label: "ใช่" },
  { name: "close", label: "ไม่" },
  { name: "happy", label: "ดีใจ" },
  { name: "sad", label: "เสียใจ" },
  { name: "hot", label: "ร้อน" },
  { name: "cold", label: "หนาว" },
  { name: "bed", label: "นอน" },
  { name: "home", label: "บ้าน" },
  { name: "users", label: "ครอบครัว" },
  { name: "phone", label: "โทรศัพท์" },
  { name: "car", label: "รถ" },
  { name: "money", label: "เงิน" },
  { name: "clock", label: "เวลา" },
  { name: "volume", label: "เสียง" },
];

// ไอคอนเริ่มต้นของปุ่มใหม่
export const DEFAULT_AAC_ICON: IconName = "star";
