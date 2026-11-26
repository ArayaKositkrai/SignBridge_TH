// ปุ่มสลับธีมสว่าง/มืด

import { useTheme } from "../../lib/theme";
import Icon from "../ui/Icon";

// ปุ่มสลับโหมดสว่าง/มืด บนแถบด้านบน
export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "เปลี่ยนเป็นโหมดสว่าง" : "เปลี่ยนเป็นโหมดมืด"}
      title={dark ? "โหมดสว่าง" : "โหมดมืด"}
      className="grid h-9 w-9 place-items-center rounded-full bg-surface/70 text-navy ring-1 ring-sky transition hover:bg-surface"
    >
      <Icon name={dark ? "sun" : "moon"} size={17} />
    </button>
  );
}
