import { API_URL } from "../../../config/env";
import { send } from "../../contributor/services/contributorApi";
import type { Role } from "../../admin/services/adminApi";

// ที่อยู่ API ของระบบล็อกอิน
const BASE = `${API_URL}/api/auth`;

// วิธีล็อกอินด้วยบัญชีภายนอก
export type Provider = "google" | "line";

// ผู้ใช้ที่ล็อกอินอยู่
export interface AuthUser {
  id: string;
  name: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  role: Role;
  has_password: boolean;
  providers: Provider[];
  phone: string | null;
  // เลขบัตรคนพิการแบบปิดบางหลัก (เลขเต็มอยู่ในหน้าโปรไฟล์)
  disability_card_masked: string | null;
  has_card_image: boolean;
}

// ข้อมูลที่ส่งตอนสมัครสมาชิก
export interface RegisterInput {
  first_name: string;
  last_name?: string;
  email: string;
  password: string;
}

// แปลงข้อมูลเป็น JSON สำหรับ POST
const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// ผู้ใช้ปัจจุบัน (null = ยังไม่ล็อกอิน) และวิธีล็อกอินภายนอกที่เปิดใช้
export const getMe = () => send<{ user: AuthUser | null; providers: Provider[] }>(`${BASE}/me`);

// ล็อกอินด้วยอีเมล/รหัสผ่าน
export const login = (email: string, password: string) =>
  send<{ user: AuthUser }>(`${BASE}/login`, post({ email, password })).then((r) => r.user);

// สมัครสมาชิก (ล็อกอินให้ทันที)
export const register = (input: RegisterInput) =>
  send<{ user: AuthUser }>(`${BASE}/register`, post(input)).then((r) => r.user);

// ออกจากระบบ
export const logout = () => send<void>(`${BASE}/logout`, { method: "POST" });

// ลิงก์ไปล็อกอินที่ Google/LINE แล้วกลับมาที่หน้า returnTo
export const providerLoginUrl = (provider: Provider, returnTo: string) =>
  `${BASE}/${provider}/start?return_to=${encodeURIComponent(returnTo)}`;

// ลิงก์ผูกบัญชี Google/LINE เข้ากับผู้ใช้ที่ล็อกอินอยู่ แล้วกลับมาที่หน้า returnTo
export const providerLinkUrl = (provider: Provider, returnTo: string) =>
  `${providerLoginUrl(provider, returnTo)}&link=true`;

// ชื่อผู้ให้บริการที่แสดงบนหน้าเว็บ
export const PROVIDER_NAMES: Record<Provider, string> = { google: "Google", line: "LINE" };
