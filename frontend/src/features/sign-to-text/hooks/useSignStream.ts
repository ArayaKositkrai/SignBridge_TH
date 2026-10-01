import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { LandmarkFrame, SignResult, SocketStatus } from "../../../types";
import { SignSocket } from "../services/signSocket";

// ค่าที่ hook รับ: ผลตรวจจับล่าสุด และเปิดใช้งานหรือไม่
interface Options {
  frameRef: MutableRefObject<LandmarkFrame | null>;
  frameIdRef: MutableRefObject<number>;
  aspect: number;
  version?: "active" | "draft";
  enabled: boolean;
}

// ส่งข้อมูลไป backend ทุกกี่มิลลิวินาที
const SEND_INTERVAL_MS = 100;
// ความมั่นใจขั้นต่ำที่จะนับเป็นคำ
const MIN_CONFIDENCE = 0.6;
// ต้องได้ผลเดิมกี่ครั้งติดกันถึงจะนับเป็นคำ
const STABLE_HITS = 3;
// จำนวนคำสูงสุดในประโยคหนึ่ง
const MAX_WORDS = 20;
// จำนวนประโยคที่เก็บไว้แสดง
const MAX_SENTENCES = 6;
// No hand for this long = the signer finished a sentence.
const SENTENCE_GAP_MS = 2500;

// hook ส่ง landmarks ผ่าน WebSocket ต่อคำเป็นประโยค และจบประโยคเมื่อลดมือ
export function useSignStream({ frameRef, frameIdRef, enabled, aspect, version = "active" }: Options) {
  // เก็บสัดส่วนภาพล่าสุดไว้ใน ref จะได้ไม่ต้องต่อ WebSocket ใหม่เมื่อค่าเปลี่ยน
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;
  const [status, setStatus] = useState<SocketStatus>("closed");
  const [result, setResult] = useState<SignResult | null>(null);
  const [words, setWords] = useState<string[]>([]);
  const [sentences, setSentences] = useState<string[]>([]);

  const wordsRef = useRef<string[]>([]);
  const pending = useRef({ text: "", hits: 0 });
  const lastActive = useRef(0);

  // อัปเดตรายการคำ (เก็บทั้งใน state และ ref)
  const setWordList = useCallback((next: string[]) => {
    wordsRef.current = next;
    setWords(next);
  }, []);

  // จบประโยค: ย้ายคำที่สะสมไปเป็นประโยคที่เสร็จแล้ว
  const commit = useCallback(() => {
    const sentence = wordsRef.current.join(" ").trim();
    if (!sentence) return;
    setSentences((s) => [...s, sentence].slice(-MAX_SENTENCES));
    setWordList([]);
    pending.current = { text: "", hits: 0 };
  }, [setWordList]);

  // รับผลจาก backend: นับเป็นคำเมื่อมั่นใจพอและได้ผลเดิมติดกันหลายครั้ง
  const onResult = useCallback(
    (r: SignResult) => {
      if (!r.text) {
        pending.current = { text: "", hits: 0 };
        setResult(null);
        return;
      }
      lastActive.current = performance.now();
      setResult(r);
      const p = pending.current;
      p.hits = r.text === p.text ? p.hits + 1 : 1;
      p.text = r.text;
      if (r.confidence >= MIN_CONFIDENCE && p.hits === STABLE_HITS) {
        const list = wordsRef.current;
        if (list[list.length - 1] !== r.text) setWordList([...list, r.text].slice(-MAX_WORDS));
      }
    },
    [setWordList],
  );

  // เปิด WebSocket และส่ง landmarks เป็นระยะ พร้อมเช็กว่าลดมือนานพอจะจบประโยคหรือยัง
  useEffect(() => {
    if (!enabled) {
      setStatus("closed");
      setResult(null);
      return;
    }
    const socket = new SignSocket(onResult, setStatus, version);
    socket.connect();

    let lastSent = -1;
    const timer = window.setInterval(() => {
      if (wordsRef.current.length && performance.now() - lastActive.current > SENTENCE_GAP_MS) {
        commit();
      }
      const frame = frameRef.current;
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
    pending.current = { text: "", hits: 0 };
  }, [setWordList]);

  return { status, result, words, sentences, commit, clear };
}
