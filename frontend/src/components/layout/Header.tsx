import { Link } from "react-router-dom";
import Icon from "../ui/Icon";
import { StaffNav, TopNav } from "./Navbar";

// แถบด้านบน: โลโก้ เมนู และปุ่มฉุกเฉิน
export default function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-sky/60 bg-cream/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4">
        <Link to="/" className="flex items-center gap-2 font-bold text-navy">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand to-royal text-white shadow-md shadow-navy/30">
            <Icon name="hand" size={18} />
          </span>
          <span>
            SignBridge <span className="text-brand">TH</span>
          </span>
        </Link>

        <TopNav />

        <div className="flex items-center gap-2">
          <StaffNav />
          <Link
            to="/emergency"
            className="hidden items-center gap-1.5 rounded-full bg-danger px-4 py-1.5 text-sm font-bold text-white shadow-sm transition hover:bg-danger-dark md:flex"
          >
            <Icon name="alert" size={16} />
            ฉุกเฉิน
          </Link>
        </div>
      </div>
    </header>
  );
}
