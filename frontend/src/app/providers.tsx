import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { ToastProvider } from "../components/ui/Toast";
import { AuthProvider } from "../features/auth/AuthContext";

// รวม provider ระดับแอป: router ข้อมูลผู้ใช้ที่ล็อกอิน และข้อความแจ้งเตือน (toast)
export default function Providers({ children }: { children: ReactNode }) {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>{children}</AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
