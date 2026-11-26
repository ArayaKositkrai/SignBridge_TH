// hook แปลงเสียงพูดเป็นข้อความด้วย Web Speech API

import { useCallback, useEffect, useRef, useState } from "react";

// ชนิดข้อมูลผลลัพธ์จาก Web Speech API (ย่อเฉพาะที่ใช้)
// ชนิดข้อมูลของตัวรู้จำเสียง
interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

// ตัวสร้างตัวรู้จำเสียง
type RecognitionCtor = new () => Recognition;

// หาตัวรู้จำเสียงของเบราว์เซอร์ (ทั้งแบบมาตรฐานและแบบ webkit)
function getCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// แปลรหัส error ของการรู้จำเสียงเป็นข้อความไทย
const ERROR_TEXT: Record<string, string> = {
  "not-allowed": "ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน กรุณาอนุญาตในเบราว์เซอร์",
  "service-not-allowed": "เบราว์เซอร์ไม่อนุญาตให้ใช้บริการรู้จำเสียง",
  "no-speech": "ไม่ได้ยินเสียงพูด ลองพูดใกล้ไมค์ขึ้นอีกนิด",
  "audio-capture": "ไม่พบไมโครโฟนในอุปกรณ์นี้",
  network: "ต้องใช้อินเทอร์เน็ตสำหรับรู้จำเสียง (เบราว์เซอร์ส่งเสียงไปประมวลผลออนไลน์)",
  "language-not-supported": "เบราว์เซอร์นี้ไม่รองรับภาษาไทยสำหรับรู้จำเสียง",
};

// ค่าที่ hook รับ: onText = ข้อความระหว่างพูด, onFinal = เมื่อพูดจบ
interface Options {
  onText: (text: string) => void;
  onFinal?: (text: string) => void;
}

// hook พูดเป็นข้อความ (ภาษาไทย) คืนข้อความที่ได้ยินสด ๆ และ error
export function useSpeechRecognition({ onText, onFinal }: Options) {
  const supported = typeof window !== "undefined" && getCtor() !== null;
  const recRef = useRef<Recognition | null>(null);
  const cb = useRef({ onText, onFinal });
  cb.current = { onText, onFinal };
  const latest = useRef("");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  // หยุดฟัง
  const stop = useCallback(() => recRef.current?.stop(), []);

  // เริ่มฟังเสียงพูดภาษาไทย
  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "th-TH";
    rec.continuous = false;
    rec.interimResults = true;
    latest.current = "";
    setError(null);
    setInterim("");

    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      latest.current = text;
      setInterim(text);
      cb.current.onText(text);
    };
    rec.onerror = (e) => setError(ERROR_TEXT[e.error] ?? `รู้จำเสียงไม่สำเร็จ (${e.error})`);
    rec.onend = () => {
      setListening(false);
      setInterim("");
      const finalText = latest.current.trim();
      if (finalText) cb.current.onFinal?.(finalText);
    };

    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setError("เริ่มรู้จำเสียงไม่ได้ ลองอีกครั้ง");
    }
  }, []);

  // สลับเริ่ม/หยุดฟัง
  const toggle = useCallback(() => (listening ? stop() : start()), [listening, start, stop]);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, interim, error, toggle };
}
