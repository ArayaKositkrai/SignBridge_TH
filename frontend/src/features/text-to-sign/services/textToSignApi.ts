import { apiPost } from "../../../lib/apiClient";
import type { TextToSignResponse } from "../../../types";

// ขอให้ backend แปลข้อความเป็นรายการท่าภาษามือ
export function translateText(text: string): Promise<TextToSignResponse> {
  return apiPost<{ text: string }, TextToSignResponse>("/api/text-to-sign", { text });
}
