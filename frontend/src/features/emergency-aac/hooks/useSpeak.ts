// hook อ่านออกเสียงข้อความ

import { useCallback, useState } from "react";
import { speak, ttsSupported } from "../../../lib/tts";

// hook พูดข้อความออกเสียง และจำข้อความล่าสุดไว้แสดง
export function useSpeak() {
  const [last, setLast] = useState<string>("");

  const say = useCallback((text: string) => {
    if (!text.trim()) return;
    setLast(text);
    speak(text);
  }, []);

  return { say, last, supported: ttsSupported };
}
