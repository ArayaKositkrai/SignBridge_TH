import PageLayout from "../components/layout/PageLayout";
import AppRoutes from "./routes";

// แอปหลัก: ครอบทุกหน้าด้วยโครงหน้า (header + เมนู)
export default function App() {
  return (
    <PageLayout>
      <AppRoutes />
    </PageLayout>
  );
}
