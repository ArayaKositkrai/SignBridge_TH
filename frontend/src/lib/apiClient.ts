import { API_URL } from "../config/env";

// ส่งคำขอ HTTP ไป backend แล้วแปลงผลเป็น JSON (สถานะ 204 = ไม่มีเนื้อหา)
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${method} ${path} failed: ${res.status}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

// เรียก GET
export const apiGet = <T>(path: string) => request<T>("GET", path);
// เรียก POST พร้อมส่ง JSON
export const apiPost = <TReq, TRes>(path: string, body: TReq) => request<TRes>("POST", path, body);
// เรียก DELETE
export const apiDelete = (path: string) => request<void>("DELETE", path);
