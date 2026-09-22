import { apiDelete, apiGet, apiPost } from "../../../lib/apiClient";
import type { EmergencyPhrase } from "../../../types";

// รูปแบบวลีที่ backend เก็บ
interface StoredPhrase {
  id: string;
  label: string;
  speak: string;
}

// แปลงวลีจาก backend เป็นปุ่มบนหน้าจอ (ไอคอนดาว)
const toPhrase = (p: StoredPhrase): EmergencyPhrase => ({ ...p, icon: "star", custom: true });

// ดึงวลีที่ผู้ใช้เพิ่มไว้ทั้งหมด
export async function fetchCustomPhrases(): Promise<EmergencyPhrase[]> {
  const res = await apiGet<{ phrases: StoredPhrase[] }>("/api/emergency-phrases");
  return res.phrases.map(toPhrase);
}

// เพิ่มวลีใหม่ที่ backend
export async function createCustomPhrase(label: string, speak: string): Promise<EmergencyPhrase> {
  return toPhrase(await apiPost<{ label: string; speak: string }, StoredPhrase>("/api/emergency-phrases", { label, speak }));
}

// ลบวลีที่ backend
export function deleteCustomPhrase(id: string): Promise<void> {
  return apiDelete(`/api/emergency-phrases/${encodeURIComponent(id)}`);
}
