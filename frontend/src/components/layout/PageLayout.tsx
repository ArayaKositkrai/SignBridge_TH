import type { ReactNode } from "react";
import Header from "./Header";
import { BottomNav } from "./Navbar";

// โครงหน้าร่วม: พื้นหลังตกแต่ง header เนื้อหา และเมนูล่าง
export default function PageLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-full flex-col overflow-x-clip">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-24 top-40 h-72 w-72 animate-drift rounded-full bg-sky/50 blur-3xl" />
        <div className="absolute -right-20 top-[28rem] h-80 w-80 animate-drift rounded-full bg-brand/15 blur-3xl [animation-delay:-6s]" />
      </div>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-5 md:pb-10 md:pt-8">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
