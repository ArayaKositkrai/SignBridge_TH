import { Navigate, NavLink, Outlet, Route, Routes } from "react-router-dom";
import Icon, { type IconName } from "../../components/ui/Icon";
import PageTitle from "../../components/ui/PageTitle";
import DashboardView from "./DashboardView";
import LogsView from "./LogsView";
import ModelsView from "./ModelsView";
import UsersView from "./UsersView";
import VocabularyView from "./VocabularyView";

// แท็บของหน้าแอดมิน
const TABS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/admin", label: "แดชบอร์ด", icon: "chart", end: true },
  { to: "/admin/users", label: "ผู้ใช้", icon: "users" },
  { to: "/admin/vocabulary", label: "คลังคำศัพท์", icon: "book" },
  { to: "/admin/models", label: "โมเดล", icon: "layers" },
  { to: "/admin/logs", label: "บันทึกการใช้งาน", icon: "clock" },
];

// พื้นที่แอดมิน: แถบเมนู แดชบอร์ด / ผู้ใช้ / คลังคำศัพท์ / โมเดล / บันทึกการใช้งาน
export default function AdminPage() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<DashboardView />} />
        <Route path="users" element={<UsersView />} />
        <Route path="vocabulary" element={<VocabularyView />} />
        <Route path="models" element={<ModelsView />} />
        {/* ลิงก์เดิม (คลังคำ & เวอร์ชัน) พาไปหน้าโมเดล */}
        <Route path="versions" element={<Navigate to="/admin/models" replace />} />
        <Route path="logs" element={<LogsView />} />
      </Route>
    </Routes>
  );
}

// โครงหน้าแอดมิน: หัวข้อ แถบแท็บ แล้วตามด้วยหน้าย่อย
function AdminLayout() {
  return (
    <>
      <PageTitle icon="shield" title="แอดมิน" subtitle="ดูภาพรวม จัดการผู้ใช้ คลังคำศัพท์ และเวอร์ชันโมเดลที่ใช้ในระบบ" />

      <nav
        className="scrollbar-none mb-5 flex gap-1 overflow-x-auto rounded-2xl bg-white/70 p-1.5 ring-1 ring-sky backdrop-blur"
        aria-label="เมนูแอดมิน"
      >
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                isActive ? "bg-navy text-white shadow" : "text-navy hover:bg-sky/50"
              }`
            }
          >
            <Icon name={t.icon} size={17} />
            {t.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </>
  );
}
