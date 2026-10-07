import { useCallback, useEffect, useState } from "react";

// ธีมของเว็บ: สว่าง / มืด
export type Theme = "light" | "dark";

// ชื่อค่าที่จำไว้ในเบราว์เซอร์ (ตรงกับสคริปต์ใน index.html)
const KEY = "sb-theme";

// ธีมที่ใช้อยู่ตอนนี้ (ดูจาก class ที่ <html>)
const current = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");

// ใส่ธีมให้ทั้งหน้า และสีแถบเบราว์เซอร์บนมือถือ
function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0b141c" : "#185079");
}

// hook ธีม: ค่าปัจจุบัน + สลับ (จำค่าในเบราว์เซอร์ ถ้าเก็บไม่ได้ก็ยังสลับได้ในหน้านี้)
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(current);

  // ยังไม่เคยเลือกเอง: เปลี่ยนตามการตั้งค่าของเครื่อง
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(KEY);
      } catch {
        /* เบราว์เซอร์ไม่ให้ใช้ storage */
      }
      if (saved) return;
      const next: Theme = mq.matches ? "dark" : "light";
      apply(next);
      setTheme(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // สลับสว่าง ↔ มืด แล้วจำไว้
  const toggle = useCallback(() => {
    const next: Theme = current() === "dark" ? "light" : "dark";
    apply(next);
    setTheme(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* เก็บไม่ได้ก็ไม่เป็นไร */
    }
  }, []);

  return { theme, toggle };
}
