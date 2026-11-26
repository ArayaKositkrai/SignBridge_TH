// เมนูนำทาง: แท็บบน (จอใหญ่) แท็บล่าง (มือถือ) และ sidebar ของทีมงาน

import { NavLink } from "react-router-dom";
import { useAuth } from "../../features/auth/AuthContext";
import type { Role } from "../../features/admin/services/adminApi";
import Icon, { type IconName } from "../ui/Icon";

// ข้อมูลของแท็บเมนูหนึ่งอัน
interface Tab {
  to: string;
  label: string;
  short: string;
  icon: IconName;
  danger?: boolean;
  // บทบาทที่เห็นแท็บนี้ (ไม่ระบุ = ทุกคน)
  roles?: Role[];
}

// รายการหน้าทั้งหมดในเมนู
export const TABS: Tab[] = [
  { to: "/", label: "ภาษามือ → ข้อความ", short: "ภาษามือ", icon: "hand" },
  { to: "/text-to-sign", label: "ข้อความ → ภาษามือ", short: "ข้อความ", icon: "text" },
  { to: "/emergency", label: "ฉุกเฉิน", short: "ฉุกเฉิน", icon: "alert", danger: true },
  { to: "/contributor", label: "อัดคลิปล่าม", short: "ล่าม", icon: "camera", roles: ["admin", "contributor"] },
  { to: "/admin", label: "แอดมิน", short: "แอดมิน", icon: "shield", roles: ["admin"] },
];

// แท็บที่ผู้ใช้ปัจจุบันเห็นได้ (แท็บทีมงานแสดงเฉพาะบทบาทที่มีสิทธิ์)
function useVisibleTabs(): Tab[] {
  const { user } = useAuth();
  return TABS.filter((t) => !t.roles || (user && t.roles.includes(user.role)));
}

// ปุ่มเข้าพื้นที่ล่ามและแอดมิน (แสดงบน header จอกว้าง)
export function StaffNav() {
  const tabs = useVisibleTabs().filter((t) => t.roles);
  if (!tabs.length) return null;
  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="เมนูทีมงาน">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          title={t.label}
          className={({ isActive }) =>
            `flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ring-1 transition ${
              isActive ? "bg-deep text-white ring-deep" : "bg-surface/70 text-navy ring-sky hover:bg-surface"
            }`
          }
        >
          <Icon name={t.icon} size={16} />
          <span className="hidden xl:inline">{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

// Navbar ด้านบน (แสดงบนจอกว้าง)
export function TopNav() {
  return (
    <nav className="hidden items-center gap-1 rounded-full bg-sky/40 p-1 md:flex" aria-label="เมนูหลัก">
      {TABS.filter((t) => !t.danger && !t.roles).map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          className={({ isActive }) =>
            `flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              isActive ? "bg-deep text-white shadow" : "text-navy hover:bg-surface/70"
            }`
          }
        >
          <Icon name={t.icon} size={16} />
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

// แท็บเมนูด้านล่าง (แสดงบนมือถือและแท็บเล็ต)
export function BottomNav() {
  const tabs = useVisibleTabs();
  return (
    <nav
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      className="pb-safe fixed inset-x-0 bottom-0 z-40 grid border-t border-sky bg-surface/95 backdrop-blur md:hidden"
      aria-label="เมนูหลัก"
    >
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={!t.roles}
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold transition ${
              t.danger
                ? isActive
                  ? "text-danger"
                  : "text-danger/70"
                : isActive
                  ? "text-navy"
                  : "text-ink/50"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span
                className={`flex h-8 w-14 items-center justify-center rounded-full transition ${
                  isActive ? (t.danger ? "bg-danger/10" : "bg-sky/60") : ""
                }`}
              >
                <Icon name={t.icon} size={20} />
              </span>
              {t.short}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
