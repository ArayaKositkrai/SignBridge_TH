// hook ส่ง landmark ไป backend ทาง WebSocket และรวมคำที่ได้เป็นประโยค

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
// แสดงคำใกล้เคียงของคำล่าสุดค้างไว้นานเท่านี้ ให้ผู้ใช้มีเวลากดเลือก (มิลลิวินาที)
const CHOICE_HOLD_MS = 8000;
// หลังกดเลือกคำแทนคำที่ระบบกำลังดูอยู่ ไม่รับคำเดิมนั้นจาก backend ภายในเวลานี้ (กันได้คำซ้อน 2 คำ)
const IGNORE_AFTER_PICK_MS = 1500;

// คำใกล้เคียงของคำล่าสุดที่ระบบขึ้น (ค้างไว้ให้กดเลือกแทน)
export interface Choices {
  word: string;
  options: string[];
}

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
  // คำที่ผู้ใช้เพิ่งเลือกคำใกล้เคียงแทน (backend ยังส่งผลเดิมซ้ำมาระยะหนึ่ง ไม่ต้องแสดงซ้ำ)
  const dismissed = useRef<string | null>(null);
  // คำที่ backend อาจยืนยันตามมาหลังผู้ใช้เลือกคำอื่นแทนไปแล้ว และเวลาที่หมดการกัน
  const ignoreWord = useRef<{ text: string; until: number } | null>(null);
  // คำใกล้เคียงของคำล่าสุด (null = ไม่มี) ค้างไว้ CHOICE_HOLD_MS แล้วหายเอง
  const [choices, setChoicesState] = useState<Choices | null>(null);
  const choicesRef = useRef<Choices | null>(null);
  const choiceTimer = useRef<number | undefined>(undefined);

  // ตั้งคำใกล้เคียงที่ค้างไว้ และนับเวลาให้หายเอง
  const setChoices = useCallback((next: Choices | null) => {
    choicesRef.current = next;
    setChoicesState(next);
    window.clearTimeout(choiceTimer.current);
    if (next) choiceTimer.current = window.setTimeout(() => setChoices(null), CHOICE_HOLD_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(choiceTimer.current), []);

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
      if (r.word || r.text !== dismissed.current) dismissed.current = null;
      setResult(r.text && !dismissed.current ? r : null);
      const ig = ignoreWord.current;
      if (r.word && ig && r.word === ig.text && performance.now() < ig.until) {
        ignoreWord.current = null;
        return;
      }
      if (r.word) {
        lastActive.current = performance.now();
        setWordList([...wordsRef.current, r.word].slice(-MAX_WORDS));
        const options = r.candidates.map((c) => c.text).filter((t) => t !== r.word).slice(0, 3);
        setChoices(options.length ? { word: r.word, options } : null);
      }
    },
    [setWordList, setChoices],
  );

  // เลือกคำใกล้เคียง (top-3) แทนคำล่าสุดที่ระบบขึ้น: แทนที่ในประโยคที่กำลังต่อ หรือในประโยคที่เพิ่งจบไป
  //   ถ้าไม่มีคำค้างให้แทน (เลือกจากคำที่ระบบกำลังดูอยู่) เพิ่มเป็นคำใหม่
  const pickCandidate = useCallback(
    (word: string) => {
      const target = choicesRef.current?.word ?? null;
      const list = wordsRef.current;
      lastActive.current = performance.now();
      if (target && list[list.length - 1] === target) {
        setWordList([...list.slice(0, -1), word]);
      } else if (target && !list.length) {
        setSentences((all) => {
          const last = all[all.length - 1];
          if (!last?.endsWith(target)) return all;
          return [...all.slice(0, -1), last.slice(0, -target.length) + word];
        });
      } else {
        setWordList([...list, word].slice(-MAX_WORDS));
        // เลือกจากคำที่ระบบกำลังดูอยู่ (ยังไม่ขึ้นคำ): backend อาจยืนยันคำเดิมตามมา ไม่ต้องรับ
        if (result?.text) ignoreWord.current = { text: result.text, until: performance.now() + IGNORE_AFTER_PICK_MS };
      }
      dismissed.current = result?.text ?? null;
      setResult(null);
      setChoices(null);
    },
    [result, setWordList, setChoices],
  );

  // ลบคำล่าสุดออกจากประโยค (กรณีระบบจับผิด)
  const removeLast = useCallback(() => setWordList(wordsRef.current.slice(0, -1)), [setWordList]);

  // เปิด WebSocket ทันทีที่เข้าหน้า (ไม่ต้องรอเปิดกล้อง) ให้ backend เตรียมโมเดลรอไว้ เปิดกล้องแล้วแปลได้เลย
  const socketRef = useRef<SignSocket | null>(null);
  useEffect(() => {
    const socket = new SignSocket(onResult, setStatus, version);
    socketRef.current = socket;
    socket.connect();
    return () => {
      socketRef.current = null;
      socket.close();
    };
  }, [version, onResult]);

  // ระหว่างเปิดกล้อง: ส่ง landmarks เป็นระยะ พร้อมเช็กว่าลดมือนานพอจะจบประโยคหรือยัง
  useEffect(() => {
    if (!enabled) {
      setResult(null);
      return;
    }
    let lastSent = -1;
    const timer = window.setInterval(() => {
      const frame = frameRef.current;
      if (hasHands(frame)) lastActive.current = performance.now();
      if (wordsRef.current.length && performance.now() - lastActive.current > SENTENCE_GAP_MS) {
        commit();
      }
      if (!frame || frameIdRef.current === lastSent) return;
      lastSent = frameIdRef.current;
      socketRef.current?.send(frame, aspectRef.current);
    }, SEND_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, frameRef, frameIdRef, commit]);

  // ล้างคำและประโยคทั้งหมด
  const clear = useCallback(() => {
    setWordList([]);
    setSentences([]);
    setResult(null);
    setChoices(null);
  }, [setWordList, setChoices]);

  return { status, result, notice, words, sentences, commit, clear, removeLast, pickCandidate, choices };
}
