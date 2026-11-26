// หน้าข้อความ → ภาษามือ: พิมพ์/พูด แปล แล้วให้อวตารทำท่า

import { useEffect, useMemo, useState } from "react";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Chip from "../../components/ui/Chip";
import Icon from "../../components/ui/Icon";
import PageTitle from "../../components/ui/PageTitle";
import type { SignClip, TextToSignResponse } from "../../types";
import SignPlayer from "./components/SignPlayer";
import TextInput from "./components/TextInput";
import VoiceInput from "./components/VoiceInput";
import { useSignPlayback } from "./hooks/useSignPlayback";
import { listSignWords, translateText, type SignWord } from "./services/textToSignApi";
import { logEvent } from "../../lib/activityLog";

// หน้าข้อความ -> ภาษามือ: กรอกหรือพูด แล้วให้ตัวละครทำท่า
export default function TextToSignPage() {
  const [text, setText] = useState("");
  const [clips, setClips] = useState<SignClip[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ผลการแก้คำ/คำที่ไม่มีท่า/ส่วนที่อ่านไม่ออก ของการแปลล่าสุด และข้อความที่ส่งไปแปล
  const [notes, setNotes] = useState<Pick<TextToSignResponse, "fixes" | "no_sign" | "unknown"> | null>(null);
  const [sent, setSent] = useState("");
  const player = useSignPlayback(clips);
  // คำที่อวตารทำท่าได้ (จากฐานข้อมูล) และคำค้นหา
  const [signWords, setSignWords] = useState<SignWord[]>([]);
  const [query, setQuery] = useState("");

  // โหลดรายการคำที่อวตารทำท่าได้ครั้งเดียวตอนเปิดหน้า
  useEffect(() => {
    listSignWords()
      .then(setSignWords)
      .catch(() => setSignWords([]));
  }, []);

  // คำที่ตรงกับคำค้นหา
  const shownWords = useMemo(() => {
    const q = query.trim();
    return q ? signWords.filter((w) => w.word.includes(q)) : signWords;
  }, [signWords, query]);

  // ส่งข้อความไปแปลที่ backend แล้วเริ่มเล่นท่าทาง
  const submit = async (value = text) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await translateText(trimmed);
      setClips(res.clips);
      setSent(trimmed);
      setNotes({ fixes: res.fixes ?? [], no_sign: res.no_sign ?? [], unknown: res.unknown ?? [] });
      if (res.fixes?.length) logEvent("แก้คำพิมพ์ผิด", res.fixes.map((f) => `${f.typed}→${f.word}`).join(", "));
      if (!res.clips.length) setError("ไม่พบคำที่แปลเป็นภาษามือได้");
    } catch {
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
    }
  };

  // แทนส่วนที่พิมพ์ด้วยคำที่ผู้ใช้เลือก แล้วแปลใหม่
  const replaceWith = (from: string, to: string) => {
    const next = sent.includes(from) ? sent.replace(from, to) : sent;
    setText(next);
    void submit(next);
  };
  // ใช้ข้อความที่แก้แล้วในช่องพิมพ์
  const applyFixes = () => {
    let next = sent;
    for (const f of notes?.fixes ?? []) next = next.replace(f.typed, f.word);
    setText(next);
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
    {/* grid-cols-[minmax(0,1fr)] บนมือถือ: กันคอลัมน์ขยายตามขนาด canvas จนกล่องอวตารกว้างล้นจอไม่รู้จบ */}
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-6">
      <div className="order-2 flex flex-col gap-4 lg:order-1">
        <Card title="ข้อความที่ต้องการแปล">
          <TextInput value={text} onChange={setText} onSubmit={() => void submit()} />
          <div className="mt-3 grid items-start gap-2 sm:grid-cols-2">
            <VoiceInput
              onText={setText}
              onFinal={(t) => {
                logEvent("ใช้เสียงพูดแทนการพิมพ์");
                void submit(t);
              }}
            />
            <Button icon="play" onClick={() => void submit()} disabled={!text.trim() || loading}>
              แปลเป็นภาษามือ
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger-dark">
              {error}
            </p>
          )}
          {notes && <FixNotes notes={notes} onPick={replaceWith} onApply={applyFixes} />}
        </Card>

        {signWords.length > 0 && (
          <Card title={`คำที่อวตารทำท่าได้ (${signWords.length})`}>
            <div className="relative mb-2">
              <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ค้นหาคำ"
                className="h-9 w-full rounded-lg border border-sky bg-surface pl-9 pr-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </div>
            {/* แถวเดียวเลื่อนแนวนอน ไม่ให้คำจำนวนมากกองเต็มหน้า */}
            <div className="scrollbar-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-1.5">
              {shownWords.map((w) => (
                <Chip
                  key={w.word}
                  onClick={() => append(w.word)}
                  className="shrink-0 whitespace-nowrap"
                  title={w.source === "extracted" ? "ท่าจากข้อมูลจริง" : "ท่าเขียนมือ"}
                >
                  + {w.word}
                </Chip>
              ))}
              {!shownWords.length && <span className="py-1 text-sm text-ink/45">ไม่พบคำที่ค้นหา</span>}
            </div>
          </Card>
        )}
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

// กล่องแจ้งผลการแปล: คำที่แก้ให้ (กดคำอื่นได้), คำที่อ่านไม่ออก (กดคำแนะนำได้), และคำที่ยังไม่มีท่า
function FixNotes({
  notes,
  onPick,
  onApply,
}: {
  notes: Pick<TextToSignResponse, "fixes" | "no_sign" | "unknown">;
  onPick: (from: string, to: string) => void;
  onApply: () => void;
}) {
  const fixes = notes.fixes ?? [];
  const unknown = notes.unknown ?? [];
  const noSign = notes.no_sign ?? [];
  if (!fixes.length && !unknown.length && !noSign.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-2 text-sm">
      {fixes.length > 0 && (
        <div className="rounded-lg bg-brand/10 px-3 py-2 text-navy">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Icon name="check" size={15} className="shrink-0 text-brand" />
            <span className="font-semibold">แก้คำให้แล้ว:</span>
            {fixes.map((f) => (
              <span key={f.typed}>
                <s className="text-ink/50">{f.typed}</s> → <b>{f.word}</b>
              </span>
            ))}
            <button type="button" onClick={onApply} className="ml-auto text-xs font-semibold text-brand hover:underline">
              ใช้ข้อความที่แก้แล้ว
            </button>
          </p>
          {fixes.some((f) => f.alternatives.length) && (
            <div className="mt-1.5 flex flex-col gap-1">
              {fixes
                .filter((f) => f.alternatives.length)
                .map((f) => (
                  <div key={f.typed} className="flex flex-wrap items-center gap-1.5 text-xs text-ink/70">
                    "{f.typed}" ไม่ได้หมายถึง "{f.word}"? เลือกคำอื่น:
                    {f.alternatives.map((a) => (
                      <Chip key={a} onClick={() => onPick(f.typed, a)} className="!px-2 !py-0.5 text-xs">
                        {a}
                      </Chip>
                    ))}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
      {unknown.map((u) => (
        <div key={u.text} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
          <Icon name="help" size={15} className="shrink-0" />
          <span>
            ไม่รู้จัก "<b>{u.text}</b>"
          </span>
          {u.suggestions.length > 0 ? (
            <>
              <span>— หมายถึง</span>
              {u.suggestions.map((w) => (
                <Chip key={w} onClick={() => onPick(u.text, w)} className="!px-2 !py-0.5 text-xs">
                  {w}
                </Chip>
              ))}
              <span>ใช่ไหม?</span>
            </>
          ) : (
            <span>— ข้ามไป</span>
          )}
        </div>
      ))}
      {noSign.length > 0 && (
        <p className="rounded-lg bg-sky/40 px-3 py-2 text-ink/70">
          <span className="font-semibold">ยังไม่มีท่าภาษามือ (ข้ามไป):</span> {noSign.join(", ")}
        </p>
      )}
    </div>
  );
}
