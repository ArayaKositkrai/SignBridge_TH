import { Route, Routes } from "react-router-dom";
import EmergencyPage from "../features/emergency-aac/EmergencyPage";
import SignToTextPage from "../features/sign-to-text/SignToTextPage";
import TextToSignPage from "../features/text-to-sign/TextToSignPage";
import AdminPage from "../features/admin/AdminPage";
import ContributorPage from "../features/contributor/ContributorPage";
import LoginPage from "../features/auth/LoginPage";
import RequireRole from "../features/auth/RequireRole";

// กำหนดเส้นทางของแต่ละหน้า
export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<SignToTextPage />} />
      <Route path="/text-to-sign" element={<TextToSignPage />} />
      <Route path="/emergency" element={<EmergencyPage />} />
      <Route path="/login" element={<LoginPage />} />
      {/* พื้นที่ล่ามและแอดมินต้องล็อกอินก่อน */}
      <Route
        path="/contributor/*"
        element={
          <RequireRole roles={["admin", "contributor"]}>
            <ContributorPage />
          </RequireRole>
        }
      />
      <Route
        path="/admin/*"
        element={
          <RequireRole roles={["admin"]}>
            <AdminPage />
          </RequireRole>
        }
      />
      <Route path="*" element={<SignToTextPage />} />
    </Routes>
  );
}
