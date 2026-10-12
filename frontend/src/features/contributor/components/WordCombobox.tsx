import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Icon from "../../../components/ui/Icon";
import type { VocabEntry, WordStats } from "../services/contributorApi";

// ค่าที่ช่องเลือกคำรับ: คำปัจจุบัน ฟังก์ชันเปลี่ยนคำ คลังคำศัพท์ คำที่มีคลิปแล้ว และเป้าหมายจำนวนคลิปต่อคำ
interface Props {
  value: string;
  onChange: (word: string) => void;
  vocab: VocabEntry[];
  words: WordStats[];
}

// คำแนะนำหนึ่งรายการในรายการเลื่อนลง
interface Option {
  word: string;
  category: string | null;
  priority: string | null;
  toRecord: boolean;
  samples: number;
}

// จำนวนคำแนะนำสูงสุดที่แสดง
const MAX_OPTIONS = 8;
// ลำดับความสำคัญ (ใช้เรียงคำแนะนำ)
const PRIORITY_RANK: Record<string, number> = { สูง: 0, กลาง: 1, ต่ำ: 2 };

// ช่องพิมพ์คำศัพท์พร้อมคำแนะนำ (autocomplete): พิมพ์แล้วเห็นคำในคลังที่ใกล้เคียง เลือกด้วยเมาส์หรือลูกศร + Enter
//   ไม่บังคับให้เลือกจากรายการ พิมพ์คำใหม่ที่ไม่มีในคลังได้ (มีป้าย "คำใหม่")
export default function WordCombobox({ value, onChange, vocab, words }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // รวมคลังคำศัพท์กับคำที่มีคลิปแล้ว เป็นรายการเดียว
  const all = useMemo<Option[]>(() => {
    const samples = new Map(words.map((w) => [w.word, w.samples]));
    const out = new Map<string, Option>();
    for (const v of vocab) {
      out.set(v.word, {
        word: v.word,
        category: v.category,
        priority: v.priority,
        toRecord: v.to_record,
        samples: samples.get(v.word) ?? 0,
      });
    }
    for (const w of words) {
      if (!out.has(w.word)) out.set(w.word, { word: w.word, category: null, priority: null, toRecord: false, samples: w.samples });
    }
    return [...out.values()];
  }, [vocab, words]);

  // คำแนะนำตามที่พิมพ์: ขึ้นต้นด้วยข้อความก่อน แล้วคำที่มีข้อความนั้น; ยังไม่พิมพ์ = คำที่ต้องอัด (คลิปน้อยขึ้นก่อน)
  //   ไม่มีเป้าจำนวนคลิป อัดได้ไม่จำกัด
  const options = useMemo(() => {
    const q = value.trim();
    const rank = (o: Option) => Number(!o.toRecord) * 10 + (PRIORITY_RANK[o.priority ?? ""] ?? 3) + Math.min(o.samples, 99) / 100;
    const pool = q
      ? all.filter((o) => o.word.includes(q) && o.word !== q)
      : all.filter((o) => o.toRecord);
    const later = (o: Option) => Number(!o.word.startsWith(q));
    return pool.sort((a, b) => later(a) - later(b) || rank(a) - rank(b) || a.word.length - b.word.length).slice(0, MAX_OPTIONS);
  }, [all, value]);

  const exact = all.find((o) => o.word === value.trim());
  const isNewWord = !!value.trim() && !exact;
  const showList = open && options.length > 0;

  // คลิกนอกช่อง = ปิดรายการ
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // รายการเปลี่ยน = ยกเลิกรายการที่ไฮไลต์ไว้
  useEffect(() => setActive(-1), [options]);

  // เลือกคำจากรายการ แล้วปิดรายการ
  const choose = (word: string) => {
    onChange(word);
    setOpen(false);
  };

  // คีย์บอร์ด: ลูกศรขึ้น/ลงเลื่อน, Enter เลือก, Esc ปิด
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (options.length ? (i + step + options.length) % options.length : -1));
    } else if (e.key === "Enter") {
      if (showList && active >= 0) {
        e.preventDefault();
        choose(options[active].word);
      } else setOpen(false);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <Icon name="text" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand" />
      <input
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        maxLength={50}
        autoComplete="off"
        placeholder="พิมพ์คำศัพท์ที่จะอัด เช่น โรงพยาบาล"
        className="h-11 w-full rounded-xl border border-sky bg-surface pl-10 pr-24 text-base outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
      />
      {isNewWord && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
          คำใหม่
        </span>
      )}

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl bg-surface py-1 shadow-lg ring-1 ring-sky"
        >
          {!value.trim() && <li className="px-3 pb-1 pt-0.5 text-xs text-ink/50">คำที่ต้องอัด</li>}
          {options.map((o, i) => {
            return (
              <li
                key={o.word}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // กดแล้วไม่ให้ช่องพิมพ์เสียโฟกัสก่อนเลือก
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(o.word)}
                onPointerEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${i === active ? "bg-sky/60" : ""}`}
              >
                {o.priority === "สูง" && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" title="ความสำคัญสูง" />}
                <span className="truncate font-semibold text-navy">{o.word}</span>
                {o.category && <span className="truncate text-xs text-ink/50">{o.category}</span>}
                {/* จำนวนคลิปที่อัดแล้ว (ไม่มีเป้า) */}
                <span className="ml-auto shrink-0 rounded-full bg-sky/50 px-1.5 text-xs text-ink/70" title="คลิปที่อัดแล้ว">
                  {o.samples} คลิป
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
