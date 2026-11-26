// ป้ายบอกชุดเทรน/ชุดเทสของล่าม

import Icon from "../../../components/ui/Icon";
import Tooltip from "../../../components/ui/Tooltip";
import type { Split } from "../../admin/services/adminApi";

// ข้อความอธิบายของแต่ละชุด (แสดงใน tooltip)
const EXPLAIN: Record<Split, string> = {
  train: "คลิปของล่ามคนนี้จะถูกใช้สอนโมเดล (แอดมินเปลี่ยนได้ที่ แอดมิน › ผู้ใช้)",
  test: "คลิปของล่ามคนนี้ถูกกันไว้วัดความแม่นยำ โมเดลจะไม่เรียนจากคลิปเหล่านี้ เพื่อทดสอบกับคนที่ไม่เคยเห็น (แอดมินเปลี่ยนได้ที่ แอดมิน › ผู้ใช้)",
};

// แถบบอกว่าคลิปที่กำลังจะอัดในชื่อล่ามนี้ จะเข้าชุดเทรนหรือชุดเทส (compact = แบบสั้นในบรรทัดเดียว)
export default function SplitNotice({ signer, split, compact }: { signer: string | null; split: Split; compact?: boolean }) {
  const test = split === "test";
  const tone = test
    ? "bg-amber-50 text-amber-800 ring-amber-200"
    : "bg-brand/10 text-navy ring-brand/30";
  return (
    <Tooltip text={EXPLAIN[split]} className="w-full">
      <span className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs ring-1 ${tone}`}>
        <Icon name={test ? "eye" : "layers"} size={15} className="shrink-0" />
        <span className="min-w-0">
          {!compact && <span className="block text-[11px] opacity-75">คลิปที่อัดจะเป็น</span>}
          <span className="block font-bold">
            {compact && <span className="font-normal opacity-80">{signer ?? "ไม่ระบุล่าม"} · </span>}
            {test ? "ชุดเทส (ไม่ใช้เทรน)" : "ชุดเทรน"}
          </span>
        </span>
      </span>
    </Tooltip>
  );
}
