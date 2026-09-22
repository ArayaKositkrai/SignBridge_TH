// เบราว์เซอร์รองรับการอ่านออกเสียงหรือไม่
export const ttsSupported =
  typeof window !== "undefined" && "speechSynthesis" in window;

// อ่านข้อความออกเสียงภาษาไทย (ตัดเสียงเก่าที่ค้างอยู่ก่อน)
export function speak(text: string): void {
  if (!ttsSupported || !text.trim()) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "th-TH";
  const thai = window.speechSynthesis
    .getVoices()
    .find((v) => v.lang.toLowerCase().startsWith("th"));
  if (thai) utter.voice = thai;
  utter.rate = 0.95;
  window.speechSynthesis.speak(utter);
}

// หยุดการอ่านออกเสียง
export function stopSpeaking(): void {
  if (ttsSupported) window.speechSynthesis.cancel();
}
