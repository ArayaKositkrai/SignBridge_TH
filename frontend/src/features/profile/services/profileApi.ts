// ฟังก์ชันเรียก API โปรไฟล์ (/api/profile)

import { API_URL } from "../../../config/env";
import type { AuthUser, Provider } from "../../auth/services/authApi";
import { send } from "../../contributor/services/contributorApi";

// ที่อยู่ API ของหน้าโปรไฟล์
const BASE = `${API_URL}/api/profile`;

// โปรไฟล์ของตัวเองแบบเต็ม (เลขบัตรเต็มเพราะเป็นเจ้าของ)
export interface Profile extends AuthUser {
  disability_card_number: string | null;
  created_at: string;
}

// ช่องที่แก้ได้ในโปรไฟล์ (ค่าว่าง = ลบค่านั้น ยกเว้นชื่อ)
export type ProfileChanges = Partial<Pick<Profile, "first_name" | "last_name" | "phone" | "disability_card_number">>;

// ส่ง JSON ไปพร้อม header ที่ถูกต้อง
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// ดึงโปรไฟล์ของตัวเอง
export const getProfile = () => send<Profile>(BASE);

// บันทึกข้อมูลส่วนตัว
export const updateProfile = (changes: ProfileChanges) => send<Profile>(BASE, json("PATCH", changes));

// อัปโหลดรูปบัตรคนพิการ (แทนรูปเดิม)
export function uploadCardImage(file: File) {
  const form = new FormData();
  form.append("file", file);
  return send<Profile>(`${BASE}/card-image`, { method: "PUT", body: form });
}

// ลบรูปบัตรคนพิการ
export const deleteCardImage = () => send<Profile>(`${BASE}/card-image`, { method: "DELETE" });

// ดึงรูปบัตรของตัวเองเป็น blob URL (รูปส่วนตัว ดึงผ่าน backend พร้อม cookie)
export async function cardImageUrl(): Promise<string> {
  const res = await fetch(`${BASE}/card-image`, { credentials: "include" });
  if (!res.ok) throw new Error(res.status === 404 ? "ยังไม่มีรูปบัตร" : `โหลดรูปไม่สำเร็จ (${res.status})`);
  return URL.createObjectURL(await res.blob());
}

// เปลี่ยน/ตั้งรหัสผ่าน
export const changePassword = (currentPassword: string | null, newPassword: string, email?: string) =>
  send<{ message: string }>(`${BASE}/password`, json("POST", { current_password: currentPassword, new_password: newPassword, email }));

// เลิกเชื่อมบัญชี Google/LINE
export const unlinkProvider = (provider: Provider) =>
  send<Profile>(`${BASE}/identities/${provider}`, { method: "DELETE" });

// ลบบัญชีของตัวเอง (พิมพ์ข้อความยืนยัน + รหัสผ่านถ้ามี)
export const deleteAccount = (confirm: string, password: string | null) =>
  send<void>(BASE, json("DELETE", { confirm, password }));
