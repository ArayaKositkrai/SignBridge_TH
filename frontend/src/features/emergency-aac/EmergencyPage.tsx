import { useMemo, useState } from "react";
import Button from "../../components/ui/Button";
import Icon from "../../components/ui/Icon";
import Modal from "../../components/ui/Modal";
import PageTitle from "../../components/ui/PageTitle";
import { EMERGENCY_PHRASES, HELP_PHRASE } from "../../config/emergencyPhrases";
import type { EmergencyPhrase } from "../../types";
import EmergencyButton from "./components/EmergencyButton";
import PhraseGrid from "./components/PhraseGrid";
import { useCustomPhrases } from "./hooks/useCustomPhrases";
import { useSpeak } from "./hooks/useSpeak";

// ปุ่มเพิ่มคำใหม่ (ดึงมาจากรายการสำเร็จรูป)
const ADD_TILE = EMERGENCY_PHRASES.find((p) => p.icon === "more")!;
// วลีสำเร็จรูป (ไม่รวมปุ่มเพิ่มคำ)
const BUILT_IN = EMERGENCY_PHRASES.filter((p) => p.icon !== "more");
// ความยาวสูงสุดของชื่อบนปุ่ม
const LABEL_MAX = 30;

// หน้าฉุกเฉิน: ปุ่มช่วยด้วย วลีสำเร็จรูป และวลีที่ผู้ใช้เพิ่มเอง
export default function EmergencyPage() {
  const { say, last, supported } = useSpeak();
  const custom = useCustomPhrases();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [speakText, setSpeakText] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  // รวมวลีสำเร็จรูป วลีที่เพิ่มเอง และปุ่มเพิ่มคำ (ซ่อนตอนแก้ไข)
  const phrases = useMemo(
    () => [...BUILT_IN, ...custom.phrases, ...(editing ? [] : [{ ...ADD_TILE, label: "เพิ่มคำใหม่" }])],
    [custom.phrases, editing],
  );

  // กดปุ่มวลี: พูดออกเสียง หรือเปิดหน้าต่างเพิ่มคำถ้าเป็นปุ่มเพิ่ม
  const pick = (p: EmergencyPhrase) => {
    if (p.icon === "more") return setDialogOpen(true);
    setActiveId(p.id);
    say(p.speak);
  };

  // ปิดหน้าต่างเพิ่มคำและล้างช่องกรอก
  const closeDialog = () => {
    setDialogOpen(false);
    setSpeakText("");
    setLabel("");
  };

  // บันทึกวลีใหม่เก็บไว้ที่ backend (ชื่อบนปุ่มว่างจะใช้ข้อความที่พูดแทน)
  const save = async () => {
    setSaving(true);
    const text = speakText.trim();
    const ok = await custom.add((label.trim() || text).slice(0, LABEL_MAX), text);
    setSaving(false);
    if (ok) closeDialog();
  };

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <PageTitle
        icon="alert"
        tone="danger"
        title="สื่อสารฉุกเฉิน"
        subtitle="กดปุ่มเดียว ระบบพูดแทนให้ทันที"
      />

      <EmergencyButton
        label="ช่วยด้วย"
        onPress={() => {
          setActiveId(null);
          say(HELP_PHRASE);
        }}
      />

      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-brand">วลีสำเร็จรูป</h2>
        <button
          onClick={() => setEditing((v) => !v)}
          disabled={!custom.phrases.length && !editing}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition disabled:opacity-40 ${
            editing ? "bg-navy text-white" : "bg-sky/50 text-navy hover:bg-sky"
          }`}
        >
          <Icon name={editing ? "close" : "edit"} size={13} />
          {editing ? "เสร็จสิ้น" : "แก้ไขปุ่มของฉัน"}
        </button>
      </div>

      <PhraseGrid
        phrases={phrases}
        activeId={activeId}
        editing={editing}
        onPick={pick}
        onDelete={(p) => void custom.remove(p.id)}
      />

      {custom.error && (
        <p role="alert" className="rounded-xl bg-danger/10 px-4 py-2.5 text-sm text-danger-dark">
          {custom.error}
        </p>
      )}

      <div
        aria-live="polite"
        className="flex min-h-[3.5rem] items-center gap-3 rounded-2xl bg-navy px-4 py-3 text-white"
      >
        <Icon name="volume" size={20} className="shrink-0 text-sky" />
        <p className="text-sm">
          {!supported
            ? "เบราว์เซอร์นี้ไม่รองรับการอ่านออกเสียง"
            : last
              ? `กำลังพูด: "${last}"`
              : "กดปุ่มเพื่อให้ระบบพูดออกเสียงภาษาไทยทันที"}
        </p>
      </div>

      <Modal open={dialogOpen} title="เพิ่มคำใหม่" onClose={closeDialog}>
        <label className="mb-1 block text-xs font-semibold text-navy">ข้อความที่จะพูด</label>
        <textarea
          autoFocus
          value={speakText}
          onChange={(e) => setSpeakText(e.target.value)}
          rows={3}
          maxLength={200}
          className="w-full resize-none rounded-xl border-0 bg-white p-3 ring-1 ring-sky focus:ring-2 focus:ring-brand"
          placeholder="เช่น ฉันแพ้ยาเพนนิซิลลิน"
        />
        <label className="mb-1 mt-3 block text-xs font-semibold text-navy">
          ชื่อบนปุ่ม <span className="font-normal text-ink/50">(ไม่ใส่ก็ได้ จะใช้ข้อความที่พูดแทน)</span>
        </label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={LABEL_MAX}
          className="h-11 w-full rounded-xl border-0 bg-white px-3 ring-1 ring-sky focus:ring-2 focus:ring-brand"
          placeholder="เช่น แพ้ยา"
        />
        {custom.error && (
          <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger-dark">
            {custom.error}
          </p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button
            variant="ghost"
            icon="volume"
            disabled={!speakText.trim()}
            onClick={() => {
              setActiveId(null);
              say(speakText);
            }}
          >
            ลองพูด
          </Button>
          <Button icon="star" disabled={!speakText.trim() || saving} onClick={() => void save()}>
            {saving ? "กำลังบันทึก…" : "บันทึกเป็นปุ่ม"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
