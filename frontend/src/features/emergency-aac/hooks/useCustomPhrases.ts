import { useCallback, useEffect, useState } from "react";
import type { EmergencyPhrase } from "../../../types";
import { createCustomPhrase, deleteCustomPhrase, fetchCustomPhrases } from "../services/emergencyApi";

// hook จัดการวลีที่ผู้ใช้เพิ่มเอง: โหลด เพิ่ม ลบ (เก็บที่ backend)
export function useCustomPhrases() {
  const [phrases, setPhrases] = useState<EmergencyPhrase[]>([]);
  const [error, setError] = useState<string | null>(null);

  // โหลดวลีที่บันทึกไว้ตอนเปิดหน้า
  useEffect(() => {
    fetchCustomPhrases()
      .then(setPhrases)
      .catch(() => setError("โหลดคำที่บันทึกไว้ไม่ได้ (เชื่อมต่อ backend ไม่ได้)"));
  }, []);

  // เพิ่มวลีใหม่ คืน true เมื่อบันทึกสำเร็จ
  const add = useCallback(async (label: string, speak: string) => {
    try {
      const created = await createCustomPhrase(label, speak);
      setPhrases((p) => [...p, created]);
      setError(null);
      return true;
    } catch {
      setError("บันทึกไม่สำเร็จ (อาจเชื่อมต่อ backend ไม่ได้ หรือเพิ่มครบ 30 คำแล้ว)");
      return false;
    }
  }, []);

  // ลบวลีตาม id
  const remove = useCallback(async (id: string) => {
    try {
      await deleteCustomPhrase(id);
      setPhrases((p) => p.filter((x) => x.id !== id));
      setError(null);
    } catch {
      setError("ลบไม่สำเร็จ ลองใหม่อีกครั้ง");
    }
  }, []);

  return { phrases, error, add, remove };
}
