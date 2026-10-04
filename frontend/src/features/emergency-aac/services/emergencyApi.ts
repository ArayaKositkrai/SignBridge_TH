import type { IconName } from "../../../components/ui/Icon";
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../lib/apiClient";
import type { EmergencyPhrase } from "../../../types";

// รูปแบบวลีที่ backend เก็บ
interface StoredPhrase {
  id: string;
  label: string;
  speak: string;
  icon?: IconName;
}

// ข้อมูลที่ส่งตอนเพิ่ม/แก้ปุ่ม: ชื่อบนปุ่ม ข้อความที่พูด (ว่าง = พูดตามชื่อ) และไอคอน
export interface PhraseInput {
  label: string;
  speak: string;
  icon: IconName;
}

// แปลงวลีจาก backend เป็นปุ่มบนหน้าจอ (วลีเก่าที่ไม่มีไอคอนใช้ดาว)
const toPhrase = (p: StoredPhrase): EmergencyPhrase => ({ ...p, icon: p.icon ?? "star", custom: true });

// ดึงวลีที่ผู้ใช้เพิ่มไว้ทั้งหมด
export async function fetchCustomPhrases(): Promise<EmergencyPhrase[]> {
  const res = await apiGet<{ phrases: StoredPhrase[] }>("/api/emergency-phrases");
  return res.phrases.map(toPhrase);
}

// เพิ่มวลีใหม่ที่ backend
export async function createCustomPhrase(input: PhraseInput): Promise<EmergencyPhrase> {
  return toPhrase(await apiPost<PhraseInput, StoredPhrase>("/api/emergency-phrases", input));
}

// แก้ไขวลีที่ backend
export async function updateCustomPhrase(id: string, input: PhraseInput): Promise<EmergencyPhrase> {
  return toPhrase(await apiPatch<PhraseInput, StoredPhrase>(`/api/emergency-phrases/${encodeURIComponent(id)}`, input));
}

// ลบวลีที่ backend
export function deleteCustomPhrase(id: string): Promise<void> {
  return apiDelete(`/api/emergency-phrases/${encodeURIComponent(id)}`);
}
