import { useCallback, useEffect, useState } from "react";
import type { EmergencyPhrase } from "../../../types";
import {
  createCustomPhrase,
  deleteCustomPhrase,
  fetchCustomPhrases,
  updateCustomPhrase,
  type PhraseInput,
} from "../services/emergencyApi";

// hook จัดการปุ่มที่ผู้ใช้เพิ่มเอง: โหลด เพิ่ม แก้ไข ลบ (เก็บที่ backend แยกตามผู้ใช้)
// userId = ผู้ใช้ที่ล็อกอินอยู่ (null = ยังไม่ล็อกอิน ไม่มีปุ่มที่เพิ่มเอง)
export function useCustomPhrases(userId: string | null) {
  const [phrases, setPhrases] = useState<EmergencyPhrase[]>([]);
  const [error, setError] = useState<string | null>(null);

  // โหลดปุ่มของผู้ใช้ตอนเปิดหน้า และโหลดใหม่เมื่อล็อกอิน/ออกจากระบบ/เปลี่ยนคน
  useEffect(() => {
    setPhrases([]);
    setError(null);
    if (!userId) return;
    let cancelled = false;
    fetchCustomPhrases()
      .then((p) => !cancelled && setPhrases(p))
      .catch(() => !cancelled && setError("โหลดปุ่มที่บันทึกไว้ไม่ได้ (เชื่อมต่อเซิร์ฟเวอร์ไม่ได้)"));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // เพิ่มวลีใหม่ คืน true เมื่อบันทึกสำเร็จ
  const add = useCallback(async (input: PhraseInput) => {
    try {
      const created = await createCustomPhrase(input);
      setPhrases((p) => [...p, created]);
      setError(null);
      return true;
    } catch {
      setError("บันทึกไม่สำเร็จ (อาจเชื่อมต่อเซิร์ฟเวอร์ไม่ได้ หรือเพิ่มครบ 30 คำแล้ว)");
      return false;
    }
  }, []);

  // แก้ไขวลี คืน true เมื่อบันทึกสำเร็จ
  const update = useCallback(async (id: string, input: PhraseInput) => {
    try {
      const updated = await updateCustomPhrase(id, input);
      setPhrases((p) => p.map((x) => (x.id === id ? updated : x)));
      setError(null);
      return true;
    } catch {
      setError("แก้ไขไม่สำเร็จ ลองใหม่อีกครั้ง");
      return false;
    }
  }, []);

  // ลบวลีตาม id คืน true เมื่อลบสำเร็จ
  const remove = useCallback(async (id: string) => {
    try {
      await deleteCustomPhrase(id);
      setPhrases((p) => p.filter((x) => x.id !== id));
      setError(null);
      return true;
    } catch {
      setError("ลบไม่สำเร็จ ลองใหม่อีกครั้ง");
      return false;
    }
  }, []);

  return { phrases, error, add, update, remove };
}
