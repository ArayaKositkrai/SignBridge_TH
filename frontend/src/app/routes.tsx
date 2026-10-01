import { Route, Routes } from "react-router-dom";
import EmergencyPage from "../features/emergency-aac/EmergencyPage";
import SignToTextPage from "../features/sign-to-text/SignToTextPage";
import TextToSignPage from "../features/text-to-sign/TextToSignPage";
import AdminPage from "../features/admin/AdminPage";
import ContributorPage from "../features/contributor/ContributorPage";

// กำหนดเส้นทางของแต่ละหน้า
export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<SignToTextPage />} />
      <Route path="/text-to-sign" element={<TextToSignPage />} />
      <Route path="/emergency" element={<EmergencyPage />} />
      <Route path="/contributor/*" element={<ContributorPage />} />
      <Route path="/admin/*" element={<AdminPage />} />
      <Route path="*" element={<SignToTextPage />} />
    </Routes>
  );
}
