import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import PageLayout from "../components/layout/PageLayout";
import TrainingProgress from "../features/admin/components/TrainingProgress";
import { logEvent } from "../lib/activityLog";
import AppRoutes from "./routes";

// ชื่อหน้าภาษาไทยตามพาธ (ใช้บันทึก log การเปิดหน้า)
const PAGE_NAMES: [string, string][] = [
  ["/admin/users", "แอดมิน › ผู้ใช้"],
  ["/admin/vocabulary", "แอดมิน › คลังคำศัพท์"],
  ["/admin/models", "แอดมิน › โมเดล"],
  ["/admin/logs", "แอดมิน › บันทึกการใช้งาน"],
  ["/profile", "โปรไฟล์"],
  ["/admin", "แอดมิน › แดชบอร์ด"],
  ["/contributor/library", "ล่าม › คลังคำศัพท์"],
  ["/contributor", "ล่าม › อัดคลิป"],
  ["/text-to-sign", "ข้อความ → ภาษามือ"],
  ["/emergency", "สื่อสารฉุกเฉิน (AAC)"],
  ["/", "ภาษามือ → ข้อความ"],
];

// หาชื่อหน้าจากพาธ
const pageName = (path: string) => PAGE_NAMES.find(([p]) => path === p || path.startsWith(`${p}/`))?.[1] ?? path;

// แอปหลัก: ครอบทุกหน้าด้วยโครงหน้า (header + เมนู) และบันทึก log ทุกครั้งที่เปิดหน้า
export default function App() {
  const { pathname } = useLocation();

  // บันทึกการเปิดหน้า
  useEffect(() => {
    logEvent(`เปิดหน้า ${pageName(pathname)}`, undefined, "เปิดหน้า");
  }, [pathname]);

  return (
    <PageLayout>
      <AppRoutes />
      {/* ความคืบหน้าการเทรน/Run Test แบบลอย ทุกหน้า (เฉพาะแอดมิน) */}
      <TrainingProgress />
    </PageLayout>
  );
}
