// ฟังก์ชันเรียก API ข้อความ → ภาษามือ

import { apiGet, apiPost } from "../../../lib/apiClient";
import type { TextToSignResponse } from "../../../types";

// ขอให้ backend แปลข้อความเป็นรายการท่าภาษามือ
export function translateText(text: string): Promise<TextToSignResponse> {
  return apiPost<{ text: string }, TextToSignResponse>("/api/text-to-sign", { text });
}

// คำที่อวตารทำท่าได้หนึ่งคำ (source = extracted ท่าจากข้อมูลจริง, handmade ท่าเขียนมือ)
export interface SignWord {
  word: string;
  source: string;
}

// ดึงรายการคำที่อวตารทำท่าได้จากฐานข้อมูล
export function listSignWords(): Promise<SignWord[]> {
  return apiGet<{ words: SignWord[] }>("/api/text-to-sign/words").then((r) => r.words);
}
