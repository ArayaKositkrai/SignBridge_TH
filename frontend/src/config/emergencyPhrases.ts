// วลีฉุกเฉินสำเร็จรูปของหน้าฉุกเฉิน

import type { EmergencyPhrase } from "../types";

// ข้อความที่พูดเมื่อกดปุ่ม "ช่วยด้วย" ใหญ่
export const HELP_PHRASE = "ช่วยด้วย ฉันต้องการความช่วยเหลือ";

// วลีฉุกเฉินสำเร็จรูป (ช่อง more คือปุ่มเพิ่มคำใหม่)
export const EMERGENCY_PHRASES: EmergencyPhrase[] = [
  { id: "food", label: "หิว", speak: "ฉันหิว ขออาหารหน่อย", icon: "food" },
  { id: "toilet", label: "ขอเข้าห้องน้ำ", speak: "ขอเข้าห้องน้ำหน่อย", icon: "toilet" },
  { id: "pain", label: "เจ็บ", speak: "ฉันเจ็บ ช่วยด้วย", icon: "pain" },
  { id: "water", label: "ขอน้ำ", speak: "ขอน้ำหน่อย", icon: "water" },
  { id: "confused", label: "ไม่เข้าใจ", speak: "ฉันไม่เข้าใจ ช่วยพูดช้า ๆ อีกครั้งได้ไหม", icon: "confused" },
  { id: "more", label: "เพิ่มเติม", speak: "", icon: "more" },
];
