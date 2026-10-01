import { useOutletContext } from "react-router-dom";
import type { VocabEntry, WordStats } from "./services/contributorApi";

// ข้อมูลที่หน้าย่อยของล่ามใช้ร่วมกัน: สถิติคำ คลังคำศัพท์ ผู้แสดงที่เลือก และการแจ้งข้อผิดพลาด
export interface ContributorContext {
  words: WordStats[];
  vocab: VocabEntry[];
  refresh: () => Promise<void>;
  signer: string | null;
  setError: (msg: string | null) => void;
}

// ดึงข้อมูลร่วมของพื้นที่ล่ามจากหน้าย่อย
export const useContributor = () => useOutletContext<ContributorContext>();
