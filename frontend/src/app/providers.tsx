import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";

// รวม provider ระดับแอป (ตอนนี้มีแค่ router)
export default function Providers({ children }: { children: ReactNode }) {
  return <BrowserRouter>{children}</BrowserRouter>;
}
