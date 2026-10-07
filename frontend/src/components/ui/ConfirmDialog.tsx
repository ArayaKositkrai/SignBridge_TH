import type { ReactNode } from "react";
import Button from "./Button";
import Modal from "./Modal";

// ค่าที่กล่องยืนยันรับ
interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

// กล่องยืนยันก่อนทำสิ่งที่ย้อนกลับไม่ได้ (แทน window.confirm ที่ดูไม่เข้ากับเว็บ)
export default function ConfirmDialog({ open, title, children, confirmLabel = "ยืนยัน", danger, busy, onConfirm, onClose }: Props) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="text-sm text-ink/80">{children}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          ยกเลิก
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
