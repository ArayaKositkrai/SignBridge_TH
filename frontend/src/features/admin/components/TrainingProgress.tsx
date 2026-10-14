import { useEffect, useRef, useState } from "react";
import { useToast } from "../../../components/ui/Toast";
import { useAuth } from "../../auth/AuthContext";
import { getTrainStatus, type TrainStatus } from "../services/adminApi";
import { STAGES, overall } from "../trainProgress";

// ถามสถานะทุกกี่มิลลิวินาที: ระหว่างเทรน/วัดผล ถี่ / ว่าง ห่าง ๆ (เผื่อมีคนเริ่มเทรนจากเครื่องหรือแท็บอื่น)
const POLL_BUSY_MS = 3000;
const POLL_IDLE_MS = 20000;
const MODELS_PAGE = "/admin/models";
// แท็บการเทรนของหน้าโมเดล (ความคืบหน้า log และผลของการเทรนล่าสุด)
const TRAIN_TAB = `${MODELS_PAGE}?tab=train`;

// ชื่อเวอร์ชันสั้นจากชื่อไฟล์โมเดล เช่น v0.0.12
const shortVersion = (file?: string | null) => file?.replace(/^model_signBridge_|\.npz$/g, "") ?? "";

// ความคืบหน้าการเทรน/Run Test เป็น toast ค้างไว้ทุกหน้า (เฉพาะแอดมิน) อัปเดต % เรื่อย ๆ และแจ้ง toast ผลเมื่อเสร็จ
//   ไม่แสดงอะไรเอง (ส่งให้ระบบ toast) — วางไว้ครั้งเดียวใน App
export default function TrainingProgress() {
  const { user } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<TrainStatus | null>(null);
  const isAdmin = user?.role === "admin";

  const training = status?.status === "running" || status?.status === "stalled";
  const evaluating = status?.evaluation?.status === "running";
  const busy = training || evaluating;

  // ถามสถานะเป็นระยะ (หยุดเมื่อไม่ใช่แอดมิน)
  useEffect(() => {
    if (!isAdmin) {
      setStatus(null);
      return;
    }
    let alive = true;
    const load = () =>
      getTrainStatus()
        .then((s) => alive && setStatus(s))
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, busy ? POLL_BUSY_MS : POLL_IDLE_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [isAdmin, busy]);

  // toast ความคืบหน้าการเทรน
  useEffect(() => {
    if (!isAdmin || !status || !training) {
      toast.progress("train", null);
      return;
    }
    const prog = status.run?.progress ?? {};
    const stalled = status.status === "stalled";
    toast.progress("train", {
      title: stalled ? "การเทรนขาดการติดต่อ" : "กำลังเทรนโมเดล",
      detail: stalled
        ? "ไม่ได้รับความคืบหน้าเกิน 2 นาที (เครื่องที่เทรนอาจปิดไป)"
        : [STAGES[prog.stage ?? "load"].label, prog.epoch && prog.epochs ? `รอบ ${prog.epoch}/${prog.epochs}` : null, status.run?.host]
            .filter(Boolean)
            .join(" · "),
      percent: Math.round(overall(prog) * 100),
      warning: stalled,
      link: { to: TRAIN_TAB, label: "ดูรายละเอียด →" },
    });
  }, [isAdmin, status, training, toast]);

  // toast ความคืบหน้า Run Test (ไม่รายงาน % = แถบวิ่ง)
  useEffect(() => {
    toast.progress(
      "evaluate",
      isAdmin && evaluating ? { title: "กำลัง Run Test", detail: "วัดผลทุกเวอร์ชันด้วยชุดทดสอบปัจจุบัน", percent: null } : null,
    );
  }, [isAdmin, evaluating, toast]);

  // เอา toast ความคืบหน้าออกเมื่อออกจากระบบ/ปิดหน้า
  useEffect(
    () => () => {
      toast.progress("train", null);
      toast.progress("evaluate", null);
    },
    [toast],
  );

  // เสร็จแล้วแจ้งผล (แจ้งที่นี่ที่เดียว ทุกหน้ารวมหน้าโมเดล)
  const prev = useRef<{ train?: string; evaluation?: string }>({});
  useEffect(() => {
    if (!status) return;
    const before = prev.current;
    const train = status.status;
    const evaluation = status.evaluation?.status;
    if (before.train === "running" && train === "succeeded") {
      const v = shortVersion(status.run?.model);
      toast.success(`เทรนเสร็จแล้ว${v ? ` ได้ ${v} เป็น Draft` : ""}`, { link: { to: TRAIN_TAB, label: "ดูผลและเผยแพร่ →" } });
    } else if (before.train === "running" && train === "failed") {
      toast.error("เทรนไม่สำเร็จ: " + (status.run?.error ?? "ดูรายละเอียดใน log"), {
        link: { to: TRAIN_TAB, label: "ดู log การเทรน →" },
      });
    }
    if (before.evaluation === "running" && evaluation === "succeeded")
      toast.success("Run Test เสร็จแล้ว", { link: { to: MODELS_PAGE, label: "ดูผลวัด →" } });
    else if (before.evaluation === "running" && evaluation === "failed")
      toast.error("Run Test ไม่สำเร็จ: " + (status.evaluation?.log.slice(-1)[0] ?? "ดู log"), { link: { to: MODELS_PAGE, label: "ไปหน้าโมเดล →" } });
    prev.current = { train, evaluation };
  }, [status, toast]);

  return null;
}
