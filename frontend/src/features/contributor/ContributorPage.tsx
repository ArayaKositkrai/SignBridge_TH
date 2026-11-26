// พื้นที่ล่าม: เลือกล่าม แล้วสลับหน้าย่อย อัดคลิป / คลังคำศัพท์

import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, Route, Routes } from "react-router-dom";
import Icon, { type IconName } from "../../components/ui/Icon";
import PageTitle from "../../components/ui/PageTitle";
import { fmtDuration, fmtNumber } from "../../lib/format";
import { listSigners, type Split, type User } from "../admin/services/adminApi";
import SplitNotice from "./components/SplitNotice";
import type { ContributorContext } from "./context";
import LibraryView from "./LibraryView";
import RecordView from "./RecordView";
import { listVocabulary, listWords, type ModelsBrief, type VocabEntry, type WordStats } from "./services/contributorApi";

// key ที่จำล่ามที่เลือกไว้ในเบราว์เซอร์
const SIGNER_KEY = "signbridge.signer";

// อ่านค่าที่จำไว้ (เบราว์เซอร์บางโหมดใช้ localStorage ไม่ได้)
function readSigner(): string | null {
  try {
    return localStorage.getItem(SIGNER_KEY);
  } catch {
    return null;
  }
}

// จำล่ามที่เลือกไว้ (ว่าง = ลบ)
function writeSigner(name: string | null) {
  try {
    if (name) localStorage.setItem(SIGNER_KEY, name);
    else localStorage.removeItem(SIGNER_KEY);
  } catch {
    // ไม่มีที่เก็บก็ใช้ต่อได้ แค่ไม่จำค่า
  }
}

// เคล็ดลับการอัดให้ได้ข้อมูลดี
const TIPS = [
  "ยืนให้เห็นตั้งแต่ศีรษะถึงเอว มืออยู่ในกรอบตลอดท่า",
  "ให้มีคนเดียวในภาพ ระบบจับ skeleton ได้ทีละคน",
  "เริ่มและจบด้วยมือวางข้างตัว ทำท่าเดียวต่อหนึ่งคลิป",
  "อัดหลายรอบ เปลี่ยนความเร็ว ระยะ แสงเล็กน้อย",
];

// เมนูใน sidebar
const MENU: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/contributor", label: "อัดคลิป", icon: "camera", end: true },
  { to: "/contributor/library", label: "คลังคำศัพท์", icon: "book" },
];

// พื้นที่ล่าม: sidebar (ล่าม เมนู สรุปข้อมูล) + หน้าอัดคลิป / คลังคำศัพท์
export default function ContributorPage() {
  return (
    <Routes>
      <Route element={<ContributorLayout />}>
        <Route index element={<RecordView />} />
        <Route path="library" element={<LibraryView />} />
      </Route>
    </Routes>
  );
}

// โครงหน้าพื้นที่ล่าม: โหลดข้อมูลร่วม แล้วแสดง sidebar คู่กับหน้าย่อย
function ContributorLayout() {
  const [words, setWords] = useState<WordStats[]>([]);
  const [vocab, setVocab] = useState<VocabEntry[]>([]);
  const [models, setModels] = useState<ModelsBrief | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [unknownSplit, setUnknownSplit] = useState<Split>("train");
  const [signer, setSigner] = useState<string | null>(readSigner);
  const [error, setError] = useState<string | null>(null);

  // โหลดสถิติคำที่อัดแล้วและคลังคำศัพท์
  const refresh = useCallback(async () => {
    try {
      const [w, v] = await Promise.all([listWords(), listVocabulary()]);
      setWords(w);
      setVocab(v.items);
      setModels(v.models);
    } catch (e) {
      setError(e instanceof Error ? e.message : "เชื่อมต่อ backend ไม่ได้");
    }
  }, []);

  // โหลดคำศัพท์และรายชื่อล่ามตอนเปิดหน้า
  useEffect(() => {
    void refresh();
    listSigners()
      .then((r) => {
        setUsers(r.users);
        setUnknownSplit(r.unknown_split);
      })
      .catch(() => setUsers([]));
  }, [refresh]);

  // เลือกล่ามแล้วจำไว้
  const chooseSigner = (name: string) => {
    const value = name || null;
    setSigner(value);
    writeSigner(value);
  };

  const signers = users.filter((u) => u.active && u.role !== "user");
  // ชุดข้อมูลของล่ามที่เลือก (ไม่ระบุ/ไม่พบชื่อ = ตามค่าของ "ไม่ระบุ")
  const signerSplit: Split = (signer ? users.find((u) => u.name === signer)?.split : null) ?? unknownSplit;
  // คลิปที่อัดผ่านระบบ และคลิปชุด TSL (ไฟล์ที่ใช้เทรน) ของทุกคำในคลัง
  const recorded = words.reduce((n, w) => n + w.samples, 0);
  const tsl = vocab.reduce((n, v) => n + Object.values(v.external ?? {}).reduce((m, e) => m + e.clips, 0), 0);
  const total = {
    // จำนวนคำทั้งหมดในคลังคำศัพท์
    words: vocab.length,
    samples: recorded + tsl,
    recorded,
    tsl,
    frames: words.reduce((n, w) => n + w.frames, 0),
    duration: words.reduce((n, w) => n + w.duration_ms, 0),
  };

  return (
    <>
      <PageTitle icon="camera" title="พื้นที่ล่าม" subtitle="อัดท่าภาษามือเก็บเป็นข้อมูลสำหรับเทรนโมเดล" />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-danger/10 px-4 py-2 text-sm text-danger">
          <Icon name="alert" size={16} />
          {error}
          <button type="button" className="ml-auto" onClick={() => setError(null)} aria-label="ปิด">
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-6">
        <aside className="flex flex-col gap-3 lg:sticky lg:top-20 lg:self-start">
          {/* ล่าม */}
          <div className="glass-card">
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand">
              <Icon name="user" size={14} />
              ล่าม
            </label>
            <select
              value={signer ?? ""}
              onChange={(e) => chooseSigner(e.target.value)}
              className="h-10 w-full rounded-xl border border-sky bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            >
              <option value="">---เลือกล่าม---</option>
              {signers.map((u) => (
                <option key={u.id} value={u.name}>
                  {u.name}
                </option>
              ))}
              {signer && !signers.some((u) => u.name === signer) && <option value={signer}>{signer}</option>}
            </select>
            <div className="mt-2">
              <SplitNotice signer={signer} split={signerSplit} />
            </div>
            {!signers.length && (
              <p className="mt-1.5 text-xs text-ink/60">
                ยังไม่มีรายชื่อ เพิ่มได้ที่{" "}
                <Link to="/admin/users" className="font-semibold text-brand underline">
                  แอดมิน › ผู้ใช้
                </Link>
              </p>
            )}
          </div>

          {/* เมนู */}
          <nav className="glass-card flex gap-1 p-2 lg:flex-col" aria-label="เมนูพื้นที่ล่าม">
            {MENU.map((m) => (
              <NavLink
                key={m.to}
                to={m.to}
                end={m.end}
                className={({ isActive }) =>
                  `flex flex-1 items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                    isActive ? "bg-deep text-white shadow" : "text-navy hover:bg-sky/50"
                  }`
                }
              >
                <Icon name={m.icon} size={18} />
                {m.label}
                {m.to.endsWith("library") && (
                  <span className="ml-auto rounded-full bg-sky/70 px-2 text-xs text-navy">{total.words}</span>
                )}
              </NavLink>
            ))}
          </nav>

          {/* สรุปข้อมูลทั้งหมด */}
          <div className="glass-card hidden lg:block">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-brand">ข้อมูลทั้งหมด</h3>
            <dl className="grid grid-cols-2 gap-2 text-center">
              {[
                ["คำ", fmtNumber(total.words)],
                ["คลิป", fmtNumber(total.samples)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-surface/70 px-2 py-2 ring-1 ring-sky">
                  <dd className="text-base font-bold text-navy">{v}</dd>
                  <dt className="text-[11px] text-ink/60">{k}</dt>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-center text-[11px] text-ink/55">
              คลิป: อัดผ่านระบบ {fmtNumber(total.recorded)} · ชุด TSL {fmtNumber(total.tsl)}
            </p>
          </div>

          {/* เคล็ดลับการอัด */}
          <div className="glass-card hidden lg:block">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-brand">เคล็ดลับการอัด</h3>
            <ul className="flex flex-col gap-1.5 text-xs text-ink/75">
              {TIPS.map((t) => (
                <li key={t} className="flex gap-1.5">
                  <Icon name="check" size={14} className="mt-0.5 shrink-0 text-brand" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <div className="min-w-0">
          <Outlet context={{ words, vocab, models, refresh, signer, signerSplit, setError } satisfies ContributorContext} />
        </div>
      </div>
    </>
  );
}
