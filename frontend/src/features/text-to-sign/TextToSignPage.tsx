import { useState } from "react";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Chip from "../../components/ui/Chip";
import Icon from "../../components/ui/Icon";
import PageTitle from "../../components/ui/PageTitle";
import { QUICK_WORDS } from "../../config/emergencyPhrases";
import type { SignClip } from "../../types";
import SignPlayer from "./components/SignPlayer";
import TextInput from "./components/TextInput";
import VoiceInput from "./components/VoiceInput";
import { useSignPlayback } from "./hooks/useSignPlayback";
import { translateText } from "./services/textToSignApi";

// ประโยคตัวอย่างให้กดลองแปล
const EXAMPLES = ["สวัสดี ขอบคุณ", "ช่วยด้วย ผมเจ็บ", "ขอโทษ ไม่เข้าใจ"];

// หน้าข้อความ -> ภาษามือ: กรอกหรือพูด แล้วให้ตัวละครทำท่า
export default function TextToSignPage() {
  const [text, setText] = useState("");
  const [clips, setClips] = useState<SignClip[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const player = useSignPlayback(clips);

  // ส่งข้อความไปแปลที่ backend แล้วเริ่มเล่นท่าทาง
  const submit = async (value = text) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await translateText(trimmed);
      setClips(res.clips);
      if (!res.clips.length) setError("ไม่พบคำที่แปลเป็นภาษามือได้");
    } catch {
      setError("เชื่อมต่อ backend ไม่ได้ ลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
    }
  };

  // เติมคำลงท้ายข้อความในช่อง
  const append = (word: string) => setText((t) => (t ? `${t} ${word}` : word));

  return (
    <>
    <PageTitle
      icon="text"
      title="ข้อความ → ภาษามือ"
      subtitle="พิมพ์หรือพูด แล้วดูคลิปภาษามือทีละคำ"
    />
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-6">
      <div className="order-2 flex flex-col gap-4 lg:order-1">
        <Card title="ข้อความที่ต้องการแปล">
          <TextInput value={text} onChange={setText} onSubmit={() => void submit()} />
          <div className="mt-3 grid items-start gap-2 sm:grid-cols-2">
            <VoiceInput onText={setText} onFinal={(t) => void submit(t)} />
            <Button icon="play" onClick={() => void submit()} disabled={!text.trim() || loading}>
              แปลเป็นภาษามือ
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger-dark">
              {error}
            </p>
          )}
        </Card>

        <Card title="คำและประโยคที่ใช้บ่อย">
          <div className="flex flex-wrap gap-2">
            {QUICK_WORDS.map((w) => (
              <Chip key={w} onClick={() => append(w)}>
                + {w}
              </Chip>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-sky/60 pt-3">
            {EXAMPLES.map((ex) => (
              <Chip
                key={ex}
                onClick={() => {
                  setText(ex);
                  void submit(ex);
                }}
                className="!bg-white ring-1 ring-sky"
              >
                {ex}
              </Chip>
            ))}
          </div>
        </Card>
      </div>

      <div className="order-1 flex flex-col gap-4 lg:order-2">
        <SignPlayer
          clip={player.current}
          index={player.index}
          total={clips.length}
          playing={player.playing}
          progress={player.progress}
          progressRef={player.progressRef}
          loading={loading}
          onToggle={player.toggle}
          onVideoEnded={player.advance}
          onVideoProgress={player.setClipProgress}
        />
        <Card title="คำในประโยค">
          {clips.length ? (
            <div className="flex flex-wrap items-center gap-2">
              {clips.map((c, i) => (
                <div key={`${c.gloss}-${i}`} className="flex items-center gap-2">
                  {i > 0 && <Icon name="arrow" size={14} className="text-brand/60" />}
                  <Chip active={i === player.index} onClick={() => player.seek(i)}>
                    {c.word}
                  </Chip>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink/50">คำที่แปลแล้วจะแสดงที่นี่ กดที่คำเพื่อดูซ้ำ</p>
          )}
        </Card>
      </div>
    </div>
    </>
  );
}
