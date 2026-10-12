import { useOutletContext } from "react-router-dom";
import type { Split } from "../admin/services/adminApi";
import type { ModelsBrief, VocabEntry, WordStats } from "./services/contributorApi";

// ข้อมูลที่หน้าย่อยของล่ามใช้ร่วมกัน: สถิติคำ คลังคำศัพท์ ล่ามที่เลือก และการแจ้งข้อผิดพลาด
export interface ContributorContext {
  words: WordStats[];
  vocab: VocabEntry[];
  models: ModelsBrief | null;
  refresh: () => Promise<void>;
  signer: string | null;
  // คลิปที่อัดในชื่อล่ามที่เลือก จะเข้าชุดเทรนหรือชุดทดสอบ
  signerSplit: Split;
  setError: (msg: string | null) => void;
}

// ดึงข้อมูลร่วมของพื้นที่ล่ามจากหน้าย่อย
export const useContributor = () => useOutletContext<ContributorContext>();
