import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../../components/ui/Icon";
import PageTitle from "../../components/ui/PageTitle";
import { EMERGENCY_PHRASES, HELP_PHRASE } from "../../config/emergencyPhrases";
import { logEvent } from "../../lib/activityLog";
import { useAuth } from "../auth/AuthContext";
import type { EmergencyPhrase } from "../../types";
import EmergencyButton from "./components/EmergencyButton";
import PhraseDialog from "./components/PhraseDialog";
import PhraseGrid from "./components/PhraseGrid";
import { useCustomPhrases } from "./hooks/useCustomPhrases";
import { useSpeak } from "./hooks/useSpeak";
import type { PhraseInput } from "./services/emergencyApi";

// ปุ่มเพิ่มคำใหม่ (ดึงมาจากรายการสำเร็จรูป)
const ADD_TILE = EMERGENCY_PHRASES.find((p) => p.icon === "more")!;
// วลีสำเร็จรูป (ไม่รวมปุ่มเพิ่มคำ)
const BUILT_IN = EMERGENCY_PHRASES.filter((p) => p.icon !== "more");

// หน้าฉุกเฉิน: ปุ่มช่วยด้วย วลีสำเร็จรูป และวลีที่ผู้ใช้เพิ่มเอง (กดพูดได้ทุกคน เพิ่ม/แก้ไข/ลบต้องล็อกอิน)
export default function EmergencyPage() {
  const { say, last, supported } = useSpeak();
  const { user } = useAuth();
  const custom = useCustomPhrases(user?.id ?? null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingMode, setEditing] = useState(false);
  // ยังไม่ล็อกอิน (หรือเพิ่งออกจากระบบ) = แก้ไขไม่ได้
  const canEdit = user !== null;
  const editing = canEdit && editingMode;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [target, setTarget] = useState<EmergencyPhrase | null>(null);

  // รวมวลีสำเร็จรูป วลีที่เพิ่มเอง และปุ่มเพิ่มคำ (ซ่อนตอนแก้ไข และตอนยังไม่ล็อกอิน)
  const phrases = useMemo(
    () => [
      ...BUILT_IN,
      ...custom.phrases,
      ...(editing || !canEdit ? [] : [{ ...ADD_TILE, label: "เพิ่มคำใหม่", speak: "" }]),
    ],
    [custom.phrases, editing, canEdit],
  );

  // เปิดหน้าต่างเพิ่มปุ่มใหม่ (target = null) หรือแก้ไขปุ่มเดิม
  const openDialog = (p: EmergencyPhrase | null) => {
    setTarget(p);
    setDialogOpen(true);
  };

  // กดปุ่มวลี: โหมดแก้ไข = เปิดหน้าต่างแก้ไข, ปุ่มเพิ่ม = เปิดหน้าต่างเพิ่ม, อื่น ๆ = พูดออกเสียง
  const pick = (p: EmergencyPhrase) => {
    if (p.icon === "more") {
      logEvent("เปิดหน้าต่างเพิ่มปุ่ม AAC");
      return openDialog(null);
    }
    if (editing && p.custom) return openDialog(p);
    setActiveId(p.id);
    logEvent("กดปุ่ม AAC", p.label);
    say(p.speak || p.label);
  };

  // บันทึกจากหน้าต่าง: เพิ่มใหม่หรือแก้ไขตามปุ่มที่เลือก
  const save = (input: PhraseInput) => (target ? custom.update(target.id, input) : custom.add(input));

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
          logEvent("กดปุ่มช่วยด้วย");
          say(HELP_PHRASE);
        }}
      />

      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-brand">วลีสำเร็จรูป</h2>
        {canEdit ? (
          <button
            onClick={() => setEditing((v) => !v)}
            disabled={!custom.phrases.length && !editing}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition disabled:opacity-40 ${
              editing ? "bg-deep text-white" : "bg-sky/50 text-navy hover:bg-sky"
            }`}
          >
            <Icon name={editing ? "close" : "edit"} size={13} />
            {editing ? "เสร็จสิ้น" : "แก้ไขปุ่มของฉัน"}
          </button>
        ) : (
          <Link
            to="/login?next=/emergency"
            className="flex items-center gap-1.5 rounded-full bg-sky/50 px-3 py-1 text-xs font-semibold text-navy transition hover:bg-sky"
          >
            <Icon name="user" size={13} />
            เข้าสู่ระบบเพื่อเพิ่ม/แก้ไขปุ่ม
          </Link>
        )}
      </div>

      {editing && <p className="-mt-3 text-xs text-ink/60">แตะปุ่มที่เพิ่มเองเพื่อแก้ไขชื่อ ข้อความ หรือไอคอน</p>}

      <PhraseGrid
        phrases={phrases}
        activeId={activeId}
        editing={editing}
        onPick={pick}
        onDelete={(p) => void custom.remove(p.id)}
      />

      {custom.error && !dialogOpen && (
        <p role="alert" className="rounded-xl bg-danger/10 px-4 py-2.5 text-sm text-danger-dark">
          {custom.error}
        </p>
      )}

      <div
        aria-live="polite"
        className="flex min-h-[3.5rem] items-center gap-3 rounded-2xl bg-deep px-4 py-3 text-white"
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

      <PhraseDialog
        open={dialogOpen}
        editing={target}
        error={custom.error}
        onClose={() => setDialogOpen(false)}
        onSay={(text) => {
          setActiveId(null);
          logEvent("ลองพูดในหน้าต่างปุ่ม AAC");
          say(text);
        }}
        onSave={save}
      />
    </div>
  );
}
