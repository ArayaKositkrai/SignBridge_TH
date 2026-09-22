import type { SVGProps } from "react";

// เส้นของไอคอน SVG ทุกตัวที่ใช้ในแอป
const PATHS = {
  hand: "M18 11V6a2 2 0 0 0-4 0v4M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.4L3.4 16a2 2 0 0 1 3.2-2.4L8 15",
  text: "M4 7V4h16v3M9 20h6M12 4v16",
  alert: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  camera: "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  stop: "M6 6h12v12H6z",
  refresh: "M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15",
  volume: "M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14",
  mic: "M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8",
  play: "M6 4l14 8-14 8z",
  pause: "M6 4h4v16H6zM14 4h4v16h-4z",
  plus: "M12 5v14M5 12h14",
  food: "M4 3v7a3 3 0 0 0 3 3v8M7 3v7M10 3v7a3 3 0 0 1-3 3M18 21V3c-2.5 1.5-4 4.5-4 8v2h4",
  toilet: "M7 3h10v6H7zM5 9h14v2a7 7 0 0 1-14 0zM9 20h6M12 16v4",
  pain: "M3 12h4l3-8 4 16 3-8h4",
  water: "M12 2.7c3.5 4.4 6 7.4 6 10.6a6 6 0 0 1-12 0c0-3.2 2.5-6.2 6-10.6z",
  confused: "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
  close: "M18 6 6 18M6 6l12 12",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6",
  arrow: "M5 12h14M13 6l6 6-6 6",
  star: "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  cameraOff: "M1 1l22 22M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3M9 3h6l2 3h4a2 2 0 0 1 2 2v9.3M12 9a3 3 0 0 1 3 3",
} as const;

// ชื่อไอคอนที่ใช้ได้
export type IconName = keyof typeof PATHS;

// ค่าที่ไอคอนรับ: ชื่อและขนาด
interface Props extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

// แสดงไอคอน SVG ตามชื่อ
export default function Icon({ name, size = 20, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
