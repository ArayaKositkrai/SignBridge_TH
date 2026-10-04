import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import Card from "../../components/ui/Card";
import Icon from "../../components/ui/Icon";
import type { Role } from "../admin/services/adminApi";
import { useAuth } from "./AuthContext";

// กันหน้าที่ต้องล็อกอิน: ยังไม่ล็อกอิน → ไปหน้าล็อกอิน / บทบาทไม่พอ → แจ้งว่าไม่มีสิทธิ์
export default function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <p className="py-10 text-center text-sm text-ink/60">กำลังตรวจสอบการเข้าสู่ระบบ…</p>;

  if (!user) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  if (!roles.includes(user.role)) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <Icon name="shield" size={32} className="mx-auto mb-2 text-brand" />
        <h2 className="font-bold text-navy">ไม่มีสิทธิ์เข้าหน้านี้</h2>
        <p className="mt-1 text-sm text-ink/60">ติดต่อแอดมินเพื่อขอสิทธิ์ล่ามหรือแอดมิน</p>
      </Card>
    );
  }

  return <>{children}</>;
}
