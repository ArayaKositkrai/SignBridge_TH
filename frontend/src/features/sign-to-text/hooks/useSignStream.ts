import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { LandmarkFrame, SignResult, SocketStatus } from "../../../types";
import { logEvent } from "../../../lib/activityLog";
import { SignSocket } from "../services/signSocket";

// ค่าที่ hook รับ: ผลตรวจจับล่าสุด และเปิดใช้งานหรือไม่
interface Options {
  frameRef: MutableRefObject<LandmarkFrame | null>;
  frameIdRef: MutableRefObject<number>;
  aspect: number;
  version?: "active" | "draft";
  enabled: boolean;
}

// ส่งข้อมูลไป backend ทุกกี่มิลลิวินาที (20 เฟรม/วิ: ท่าเร็ว ๆ ยาว 0.7 วิ ยังได้ ~14 เฟรม พอให้โมเดลจำได้)
const SEND_INTERVAL_MS = 50;
// จำนวนคำสูงสุดในประโยคหนึ่ง
const MAX_WORDS = 20;
// จำนวนประโยคที่เก็บไว้แสดง
const MAX_SENTENCES = 6;
// ลดมือ/ไม่เห็นมือนานเท่านี้ = จบประโยค (ระหว่างยังเห็นมือ ถือว่ากำลังทำท่าคำถัดไปอยู่ ไม่ตัดประโยค)
const SENTENCE_GAP_MS = 2000;

// เฟรมนี้เห็นมืออย่างน้อยหนึ่งข้างไหม
const hasHands = (f: LandmarkFrame | null) => !!f && (f.leftHand.length > 0 || f.rightHand.length > 0);

// hook ส่ง landmarks ผ่าน WebSocket ต่อคำเป็นประโยค และจบประโยคเมื่อลดมือ
export function useSignStream({ frameRef, frameIdRef, enabled, aspect, version = "active" }: Options) {
  // เก็บสัดส่วนภาพล่าสุดไว้ใน ref จะได้ไม่ต้องต่อ WebSocket ใหม่เมื่อค่าเปลี่ยน
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;
  const [status, setStatus] = useState<SocketStatus>("closed");
  const [result, setResult] = useState<SignResult | null>(null);
  const [words, setWords] = useState<string[]>([]);
  const [sentences, setSentences] = useState<string[]>([]);
  // ข้อความแจ้งจาก backend (เช่น ยังไม่มีโมเดล) null = ไม่มี
  const [notice, setNotice] = useState<string | null>(null);

  const wordsRef = useRef<string[]>([]);
  // เวลาล่าสุดที่ยังเห็นมือหรือได้คำ (ใช้ตัดสินว่าจบประโยคหรือยัง)
  const lastActive = useRef(0);

  // อัปเดตรายการคำ (เก็บทั้งใน state และ ref)
  const setWordList = useCallback((next: string[]) => {
    wordsRef.current = next;
    setWords(next);
  }, []);

  // จบประโยค: ย้ายคำที่สะสมไปเป็นประโยคที่เสร็จแล้ว
  const commit = useCallback(() => {
    // ภาษาไทยไม่เว้นวรรคระหว่างคำ (อ่านออกเสียงได้เป็นประโยคต่อเนื่อง)
    const sentence = wordsRef.current.join("").trim();
    if (!sentence) return;
    // บันทึกแค่จำนวนคำที่แปลได้ ไม่บันทึกตัวคำ
    logEvent("แปลภาษามือได้ 1 ประโยค", `${wordsRef.current.length} คำ`);
    setSentences((s) => [...s, sentence].slice(-MAX_SENTENCES));
    setWordList([]);
  }, [setWordList]);

  // รับผลจาก backend: แสดงคำที่กำลังดู และต่อคำเข้าประโยคเมื่อ backend ส่ง word มา (backend ตัดสินและกันคำซ้ำให้แล้ว)
  const onResult = useCallback(
    (r: SignResult) => {
      setNotice(r.notice ?? null);
      setResult(r.text ? r : null);
      if (r.word) {
        lastActive.current = performance.now();
        setWordList([...wordsRef.current, r.word].slice(-MAX_WORDS));
      }
    },
    [setWordList],
  );

  // ลบคำล่าสุดออกจากประโยค (กรณีระบบจับผิด)
  const removeLast = useCallback(() => setWordList(wordsRef.current.slice(0, -1)), [setWordList]);

  // เปิด WebSocket และส่ง landmarks เป็นระยะ พร้อมเช็กว่าลดมือนานพอจะจบประโยคหรือยัง
  useEffect(() => {
    if (!enabled) {
      setStatus("closed");
      setResult(null);
      setNotice(null);
      return;
    }
    const socket = new SignSocket(onResult, setStatus, version);
    socket.connect();

    let lastSent = -1;
    const timer = window.setInterval(() => {
      const frame = frameRef.current;
      if (hasHands(frame)) lastActive.current = performance.now();
      if (wordsRef.current.length && performance.now() - lastActive.current > SENTENCE_GAP_MS) {
        commit();
      }
      if (!frame || frameIdRef.current === lastSent) return;
      lastSent = frameIdRef.current;
      socket.send(frame, aspectRef.current);
    }, SEND_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      socket.close();
    };
  }, [enabled, version, frameRef, frameIdRef, onResult, commit]);

  // ล้างคำและประโยคทั้งหมด
  const clear = useCallback(() => {
    setWordList([]);
    setSentences([]);
    setResult(null);
  }, [setWordList]);

  return { status, result, notice, words, sentences, commit, clear, removeLast };
}
