import { useEffect, useState } from "react";
import Button from "../../../components/ui/Button";
import Icon, { type IconName } from "../../../components/ui/Icon";
import Modal from "../../../components/ui/Modal";
import { AAC_ICONS, DEFAULT_AAC_ICON } from "../../../config/aacIcons";
import type { EmergencyPhrase } from "../../../types";
import type { PhraseInput } from "../services/emergencyApi";

// ความยาวสูงสุดของชื่อบนปุ่ม และข้อความที่พูด
const LABEL_MAX = 30;
const SPEAK_MAX = 200;

// ค่าที่หน้าต่างรับ: เปิดอยู่ไหม ปุ่มที่แก้ (null = เพิ่มใหม่) ข้อผิดพลาด และ callback
interface Props {
  open: boolean;
  editing: EmergencyPhrase | null;
  error: string | null;
  onClose: () => void;
  onSay: (text: string) => void;
  onSave: (input: PhraseInput) => Promise<boolean>;
}

// หน้าต่างเพิ่ม/แก้ปุ่ม AAC: ชื่อบนปุ่ม (บน) → ข้อความที่พูด (ล่าง ไม่ใส่ = พูดตามชื่อ) → เลือกไอคอน → ตัวอย่าง
export default function PhraseDialog({ open, editing, error, onClose, onSay, onSave }: Props) {
  const [label, setLabel] = useState("");
  const [speak, setSpeak] = useState("");
  const [icon, setIcon] = useState<IconName>(DEFAULT_AAC_ICON);
  const [saving, setSaving] = useState(false);

  // เปิดหน้าต่าง: กรอกค่าเดิมเมื่อแก้ไข หรือล้างช่องเมื่อเพิ่มใหม่
  useEffect(() => {
    if (!open) return;
    setLabel(editing?.label ?? "");
    setSpeak(editing && editing.speak !== editing.label ? editing.speak : "");
    setIcon(editing && editing.icon !== "more" ? editing.icon : DEFAULT_AAC_ICON);
  }, [open, editing]);

  const name = label.trim();
  const spoken = speak.trim() || name;

  // บันทึกปุ่ม (ข้อความว่าง = พูดตามชื่อปุ่ม)
  const save = async () => {
    setSaving(true);
    const ok = await onSave({ label: name.slice(0, LABEL_MAX), speak: speak.trim(), icon });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal open={open} title={editing ? "แก้ไขปุ่ม" : "เพิ่มคำใหม่"} onClose={onClose}>
      <label className="mb-1 block text-xs font-semibold text-navy">ชื่อบนปุ่ม</label>
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        maxLength={LABEL_MAX}
        className="h-11 w-full rounded-xl border-0 bg-white px-3 ring-1 ring-sky focus:ring-2 focus:ring-brand"
        placeholder="เช่น แพ้ยา"
      />

      <label className="mb-1 mt-3 block text-xs font-semibold text-navy">
        ข้อความที่จะพูด <span className="font-normal text-ink/50">(ไม่ใส่ก็ได้ จะพูดตามชื่อปุ่ม)</span>
      </label>
      <textarea
        value={speak}
        onChange={(e) => setSpeak(e.target.value)}
        rows={2}
        maxLength={SPEAK_MAX}
        className="w-full resize-none rounded-xl border-0 bg-white p-3 ring-1 ring-sky focus:ring-2 focus:ring-brand"
        placeholder={name ? `ไม่ใส่ = พูดว่า "${name}"` : "เช่น ฉันแพ้ยาเพนนิซิลลิน"}
      />

      <p className="mb-1.5 mt-3 text-xs font-semibold text-navy">ไอคอน</p>
      <div
        role="radiogroup"
        aria-label="เลือกไอคอน"
        className="scrollbar-thin grid max-h-44 grid-cols-6 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-7"
      >
        {AAC_ICONS.map((i) => (
          <button
            key={i.name}
            type="button"
            role="radio"
            aria-checked={icon === i.name}
            title={i.label}
            onClick={() => setIcon(i.name)}
            className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px] font-medium transition ${
              icon === i.name ? "bg-navy text-white shadow" : "bg-white text-navy ring-1 ring-sky hover:bg-sky/40"
            }`}
          >
            <Icon name={i.name} size={20} />
            <span className="w-full truncate px-0.5 text-center">{i.label}</span>
          </button>
        ))}
      </div>

      {/* ตัวอย่างปุ่มจริง */}
      <div className="mt-3 flex items-center gap-3 rounded-2xl bg-sky/30 p-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sky/70 text-navy">
          <Icon name={icon} size={24} />
        </span>
        <div className="min-w-0">
          <div className="truncate font-semibold text-navy">{name || "ชื่อบนปุ่ม"}</div>
          <div className="truncate text-xs text-ink/60">พูดว่า: {spoken || "-"}</div>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger-dark">
          {error}
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="ghost" icon="volume" disabled={!spoken} onClick={() => onSay(spoken)}>
          ลองพูด
        </Button>
        <Button icon="check" disabled={!name || saving} onClick={() => void save()}>
          {saving ? "กำลังบันทึก…" : editing ? "บันทึกการแก้ไข" : "บันทึกเป็นปุ่ม"}
        </Button>
      </div>
    </Modal>
  );
}
