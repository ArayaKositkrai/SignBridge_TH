import { Navigate, NavLink, Outlet, Route, Routes } from "react-router-dom";
import Icon, { type IconName } from "../../components/ui/Icon";
import DashboardView from "./DashboardView";
import LogsView from "./LogsView";
import ModelsView from "./ModelsView";
import UsersView from "./UsersView";
import VocabularyView from "./VocabularyView";

// เมนูของหน้าแอดมิน (คำอธิบายสั้นแสดงใต้ชื่อบนจอใหญ่)
const MENU: { to: string; label: string; hint: string; icon: IconName; end?: boolean }[] = [
  { to: "/admin", label: "ภาพรวม", hint: "สรุปข้อมูลทั้งระบบ", icon: "chart", end: true },
  { to: "/admin/users", label: "ผู้ใช้", hint: "บทบาท สิทธิ์ ข้อมูลส่วนตัว", icon: "users" },
  { to: "/admin/vocabulary", label: "คลังคำศัพท์", hint: "คำ คลิป และคำที่จะเทรน", icon: "book" },
  { to: "/admin/models", label: "โมเดล", hint: "เทรน ทดสอบ เผยแพร่", icon: "layers" },
  { to: "/admin/logs", label: "บันทึกการใช้งาน", hint: "ใครทำอะไร เมื่อไร", icon: "clock" },
];

// พื้นที่แอดมิน: ภาพรวม / ผู้ใช้ / คลังคำศัพท์ / โมเดล / บันทึกการใช้งาน
export default function AdminPage() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<DashboardView />} />
        <Route path="users" element={<UsersView />} />
        <Route path="vocabulary" element={<VocabularyView />} />
        <Route path="models" element={<ModelsView />} />
        <Route path="logs" element={<LogsView />} />
        {/* ลิงก์เดิม (คลังคำ & เวอร์ชัน) พาไปหน้าโมเดล */}
        <Route path="versions" element={<Navigate to="/admin/models" replace />} />
      </Route>
    </Routes>
  );
}

// โครงหน้าแอดมิน: เมนูข้างซ้ายคงที่ (จอใหญ่) / แถบเมนูเลื่อนด้านบน (จอเล็ก) แล้วตามด้วยหน้าย่อย
function AdminLayout() {
  return (
    <div className="lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-8">
      <aside className="lg:sticky lg:top-20 lg:self-start lg:rounded-2xl lg:bg-surface/70 lg:p-2 lg:pt-3 lg:ring-1 lg:ring-sky/70 dark:lg:ring-white/[0.07]">
        <p className="mb-3 hidden items-center gap-2 px-3 text-xs font-bold uppercase tracking-wider text-ink/45 lg:flex">
          <Icon name="shield" size={14} />
          แอดมิน
        </p>
        <nav
          aria-label="เมนูแอดมิน"
          className="scrollbar-none -mx-4 mb-5 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:mb-0 lg:flex-col lg:px-0"
        >
          {MENU.map((m) => (
            <NavLink
              key={m.to}
              to={m.to}
              end={m.end}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-sm transition lg:py-2.5 ${
                  isActive ? "bg-deep text-white shadow-sm dark:bg-brand/20 dark:ring-1 dark:ring-brand/50" : "text-navy hover:bg-sky/40"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name={m.icon} size={18} className={isActive ? "" : "text-brand"} />
                  <span className="min-w-0">
                    <span className="block font-semibold">{m.label}</span>
                    <span className={`hidden truncate text-[11px] lg:block ${isActive ? "text-white/70" : "text-ink/45"}`}>{m.hint}</span>
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>
      <section className="min-w-0">
        <Outlet />
      </section>
    </div>
  );
}
