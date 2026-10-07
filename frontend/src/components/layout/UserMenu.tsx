import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../features/auth/AuthContext";
import Icon from "../ui/Icon";

// ชื่อบทบาทภาษาไทย
const ROLE_LABEL = { admin: "แอดมิน", contributor: "ล่าม", user: "ผู้ใช้ทั่วไป" } as const;

// ปุ่มผู้ใช้บน header: ยังไม่ล็อกอิน = ปุ่มเข้าสู่ระบบ / ล็อกอินแล้ว = ชื่อ + เมนูออกจากระบบ
export default function UserMenu() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // ปิดเมนูเมื่อคลิกนอกเมนู
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (loading) return null;

  if (!user) {
    return (
      <Link
        to="/login"
        className="flex items-center gap-1.5 rounded-full bg-surface/70 px-3 py-1.5 text-sm font-semibold text-navy ring-1 ring-sky transition hover:bg-surface"
      >
        <Icon name="user" size={16} />
        <span className="hidden sm:inline">เข้าสู่ระบบ</span>
      </Link>
    );
  }

  const signOut = async () => {
    setOpen(false);
    await logout();
    navigate("/");
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1.5 rounded-full bg-surface/70 px-3 py-1.5 text-sm font-semibold text-navy ring-1 ring-sky transition hover:bg-surface"
      >
        <Icon name="user" size={16} />
        <span className="hidden max-w-[10rem] truncate sm:inline">{user.first_name}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-surface p-2 text-sm shadow-card ring-1 ring-sky"
        >
          <div className="border-b border-sky/60 px-2 pb-2">
            <p className="truncate font-semibold text-navy">{user.name}</p>
            {user.email && <p className="truncate text-xs text-ink/60">{user.email}</p>}
            <p className="mt-0.5 text-xs text-brand">{ROLE_LABEL[user.role]}</p>
          </div>
          {/* โปรไฟล์: แก้ข้อมูลส่วนตัว รหัสผ่าน บัญชีที่เชื่อม (ย้ายการผูกบัญชีไปไว้ที่นั่น) */}
          <Link
            to="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-navy hover:bg-sky/40"
          >
            <Icon name="settings" size={15} />
            โปรไฟล์และการตั้งค่า
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-danger hover:bg-danger/10"
          >
            ออกจากระบบ
          </button>
        </div>
      )}
    </div>
  );
}
