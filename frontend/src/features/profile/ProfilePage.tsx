import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Field from "../../components/ui/Field";
import Icon from "../../components/ui/Icon";
import Modal from "../../components/ui/Modal";
import PageTitle from "../../components/ui/PageTitle";
import { fmtDate } from "../../lib/format";
import { useAuth } from "../auth/AuthContext";
import { PROVIDER_NAMES, providerLinkUrl, type Provider } from "../auth/services/authApi";
import * as api from "./services/profileApi";
import type { Profile } from "./services/profileApi";

// ชื่อบทบาทภาษาไทย
const ROLE_LABEL = { admin: "แอดมิน", contributor: "ล่าม", user: "ผู้ใช้ทั่วไป" } as const;
// ข้อความที่ต้องพิมพ์ก่อนลบบัญชี (ตรงกับ backend)
const DELETE_CONFIRM = "ลบบัญชี";
// ขนาดรูปบัตรสูงสุด
const MAX_CARD_BYTES = 5 * 1024 * 1024;

// เหลือแต่ตัวเลข
const digits = (v: string) => v.replace(/\D/g, "");

// ตรวจเบอร์โทร (ว่างได้) คืนข้อความผิดพลาดหรือ null
function phoneError(v: string): string | null {
  const d = digits(v);
  if (!d) return null;
  return /^0\d{8,9}$/.test(d) ? null : "เบอร์โทรต้องเป็นตัวเลข 9-10 หลัก ขึ้นต้นด้วย 0";
}

// ตรวจเลขบัตร 13 หลักพร้อมหลักตรวจสอบ (ว่างได้) คืนข้อความผิดพลาดหรือ null
function cardError(v: string): string | null {
  const d = digits(v);
  if (!d) return null;
  if (d.length !== 13) return "เลขบัตรต้องมี 13 หลัก";
  const sum = [...d.slice(0, 12)].reduce((s, c, i) => s + Number(c) * (13 - i), 0);
  return (11 - (sum % 11)) % 10 === Number(d[12]) ? null : "เลขบัตรไม่ถูกต้อง กรุณาตรวจอีกครั้ง";
}

// จัดรูปเลขบัตรระหว่างพิมพ์ เช่น 1-2345-67890-12-3
function formatCard(v: string): string {
  const d = digits(v).slice(0, 13);
  const parts = [d.slice(0, 1), d.slice(1, 5), d.slice(5, 10), d.slice(10, 12), d.slice(12, 13)];
  return parts.filter(Boolean).join("-");
}

// หน้าโปรไฟล์: ข้อมูลส่วนตัว บัตรคนพิการ รหัสผ่าน บัญชีที่เชื่อม และลบบัญชี
export default function ProfilePage() {
  const { setUser, providers: enabledProviders } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  // โหลดโปรไฟล์ตอนเปิดหน้า
  useEffect(() => {
    api
      .getProfile()
      .then(setProfile)
      .catch((e) => setError(e instanceof Error ? e.message : "โหลดโปรไฟล์ไม่สำเร็จ"));
  }, []);

  // เก็บโปรไฟล์ใหม่ และอัปเดตชื่อบนแถบเมนูด้วย
  const applyProfile = (p: Profile) => {
    setProfile(p);
    setUser(p);
  };

  if (error) return <p className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>;
  if (!profile) return <p className="text-sm text-ink/60">กำลังโหลด…</p>;

  return (
    <>
      <PageTitle icon="user" title="โปรไฟล์" subtitle="จัดการข้อมูลส่วนตัว รหัสผ่าน และบัญชีที่ใช้เข้าสู่ระบบ" />
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <ProfileHeader profile={profile} />
        <PersonalCard profile={profile} onSaved={applyProfile} />
        <DisabilityCard profile={profile} onSaved={applyProfile} />
        <SecurityCard profile={profile} />
        <AccountsCard profile={profile} enabled={enabledProviders} onSaved={applyProfile} />
        <DangerCard profile={profile} />
      </div>
    </>
  );
}

// หัวโปรไฟล์: อักษรย่อ ชื่อ อีเมล บทบาท วันที่สมัคร
function ProfileHeader({ profile }: { profile: Profile }) {
  return (
    <section className="glass-card flex items-center gap-4">
      <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand to-royal text-2xl font-bold text-white">
        {profile.first_name.slice(0, 1)}
      </span>
      <div className="min-w-0">
        <h2 className="truncate text-xl font-bold text-navy">{profile.name}</h2>
        {profile.email && <p className="truncate text-sm text-ink/60">{profile.email}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink/55">
          <Badge tone="brand">{ROLE_LABEL[profile.role]}</Badge>
          สมาชิกตั้งแต่ {fmtDate(profile.created_at)}
        </div>
      </div>
    </section>
  );
}

// ข้อความผลลัพธ์ใต้ฟอร์ม (สำเร็จ = เขียว, ผิดพลาด = แดง)
function Status({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-danger"}`}>{msg.text}</p>;
}

// เรียก API พร้อมจัดการสถานะกำลังทำ/ข้อความผล
function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // ทำงาน แล้วแสดงข้อความสำเร็จหรือข้อผิดพลาด
  const run = async (action: () => Promise<void>, okText?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await action();
      if (okText) setMsg({ ok: true, text: okText });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "เกิดข้อผิดพลาด" });
    } finally {
      setBusy(false);
    }
  };
  return { busy, msg, run, setMsg };
}

// การ์ดข้อมูลส่วนตัว: ชื่อ นามสกุล เบอร์โทร (อีเมลเปลี่ยนไม่ได้)
function PersonalCard({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const [first, setFirst] = useState(profile.first_name);
  const [last, setLast] = useState(profile.last_name ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const { busy, msg, run } = useAction();
  const pErr = phoneError(phone);
  const changed = first.trim() !== profile.first_name || last.trim() !== (profile.last_name ?? "") || digits(phone) !== (profile.phone ?? "");

  // บันทึกข้อมูลส่วนตัว
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!first.trim() || pErr) return;
    void run(async () => {
      onSaved(await api.updateProfile({ first_name: first.trim(), last_name: last.trim(), phone: digits(phone) }));
    }, "บันทึกแล้ว");
  };

  return (
    <Card title="ข้อมูลส่วนตัว">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="ชื่อ" value={first} onChange={(e) => setFirst(e.target.value)} maxLength={50} required error={first.trim() ? null : "กรุณากรอกชื่อ"} />
        <Field label="นามสกุล" value={last} onChange={(e) => setLast(e.target.value)} maxLength={50} />
        <Field
          label="เบอร์โทรศัพท์"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          maxLength={14}
          placeholder="08xxxxxxxx"
          error={pErr}
          hint="ใช้ติดต่อกลับในกรณีจำเป็น"
        />
        <Field label="อีเมล" value={profile.email ?? "-"} disabled hint="เปลี่ยนอีเมลไม่ได้" />
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" icon="check" disabled={busy || !changed || !first.trim() || !!pErr}>
            บันทึก
          </Button>
          <Status msg={msg} />
        </div>
      </form>
    </Card>
  );
}

// การ์ดบัตรคนพิการ: เลขบัตร และรูปบัตร (เห็นเฉพาะเจ้าของและแอดมิน)
function DisabilityCard({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const [number, setNumber] = useState(profile.disability_card_number ?? "");
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { busy, msg, run, setMsg } = useAction();
  const nErr = cardError(number);
  const changed = digits(number) !== digits(profile.disability_card_number ?? "");

  // โหลดรูปบัตรเดิม (ถ้ามี) และคืนหน่วยความจำของรูปเมื่อเปลี่ยน/ออกจากหน้า
  useEffect(() => {
    if (!profile.has_card_image) {
      setPreview(null);
      return;
    }
    let url: string | null = null;
    let alive = true;
    api
      .cardImageUrl()
      .then((u) => {
        url = u;
        if (alive) setPreview(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => alive && setPreview(null));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [profile.has_card_image, profile]);

  // บันทึกเลขบัตร
  const saveNumber = (e: FormEvent) => {
    e.preventDefault();
    if (nErr) return;
    void run(async () => onSaved(await api.updateProfile({ disability_card_number: digits(number) })), "บันทึกเลขบัตรแล้ว");
  };

  // อัปโหลดรูปบัตรที่เลือก (ตรวจชนิด/ขนาดก่อนส่ง)
  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMsg({ ok: false, text: "รองรับเฉพาะรูป JPG, PNG หรือ WEBP" });
      return;
    }
    if (file.size > MAX_CARD_BYTES) {
      setMsg({ ok: false, text: "รูปใหญ่เกิน 5 MB" });
      return;
    }
    void run(async () => onSaved(await api.uploadCardImage(file)), "อัปโหลดรูปบัตรแล้ว");
  };

  return (
    <Card title="บัตรประจำตัวคนพิการ">
      <p className="mb-3 flex items-start gap-2 rounded-xl bg-sky/30 px-3 py-2 text-xs text-navy">
        <Icon name="shield" size={16} className="mt-0.5 shrink-0" />
        ข้อมูลนี้เป็นข้อมูลส่วนบุคคล เห็นได้เฉพาะคุณและแอดมินของระบบ ใช้ตรวจสอบสิทธิ์เท่านั้น ลบออกได้ทุกเมื่อ
      </p>
      <form onSubmit={saveNumber} className="flex flex-wrap items-start gap-2">
        <Field
          label="เลขบัตร (13 หลัก)"
          value={number}
          onChange={(e) => setNumber(formatCard(e.target.value))}
          inputMode="numeric"
          placeholder="x-xxxx-xxxxx-xx-x"
          error={nErr}
          className="min-w-[240px] flex-1"
        />
        <Button type="submit" className="mt-6" disabled={busy || !changed || !!nErr}>
          บันทึกเลขบัตร
        </Button>
      </form>

      <div className="mt-4">
        <span className="text-sm font-semibold text-navy">รูปบัตร</span>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          {preview ? (
            <img src={preview} alt="รูปบัตรคนพิการ" className="h-28 rounded-xl object-cover ring-1 ring-sky" />
          ) : (
            <div className="grid h-28 w-44 place-items-center rounded-xl border border-dashed border-sky text-xs text-ink/50">
              ยังไม่มีรูป
            </div>
          )}
          <div className="flex flex-col gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Button size="sm" variant="soft" icon="upload" onClick={() => fileRef.current?.click()} disabled={busy}>
              {profile.has_card_image ? "เปลี่ยนรูป" : "อัปโหลดรูป"}
            </Button>
            {profile.has_card_image && (
              <Button
                size="sm"
                variant="ghost"
                icon="trash"
                disabled={busy}
                onClick={() => void run(async () => onSaved(await api.deleteCardImage()), "ลบรูปบัตรแล้ว")}
              >
                ลบรูป
              </Button>
            )}
            <span className="text-xs text-ink/50">JPG / PNG / WEBP ไม่เกิน 5 MB</span>
          </div>
        </div>
      </div>
      <div className="mt-2">
        <Status msg={msg} />
      </div>
    </Card>
  );
}

// การ์ดรหัสผ่าน: เปลี่ยนรหัส (ต้องใส่รหัสเดิม) หรือตั้งรหัสใหม่สำหรับบัญชีที่ใช้ Google/LINE อย่างเดียว
function SecurityCard({ profile }: { profile: Profile }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const { busy, msg, run } = useAction();
  const mismatch = confirm && next !== confirm ? "รหัสผ่านไม่ตรงกัน" : null;
  const short = next && next.length < 8 ? "อย่างน้อย 8 ตัวอักษร" : null;

  // ส่งรหัสผ่านใหม่
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mismatch || short || !next) return;
    void run(async () => {
      await api.changePassword(profile.has_password ? current : null, next);
      setCurrent("");
      setNext("");
      setConfirm("");
    }, "เปลี่ยนรหัสผ่านแล้ว");
  };

  if (!profile.email) return null;
  return (
    <Card title={profile.has_password ? "เปลี่ยนรหัสผ่าน" : "ตั้งรหัสผ่าน"}>
      {!profile.has_password && (
        <p className="mb-3 text-sm text-ink/70">ตอนนี้คุณเข้าสู่ระบบด้วยบัญชีภายนอกอย่างเดียว ตั้งรหัสผ่านไว้เพื่อเข้าด้วยอีเมลได้ด้วย</p>
      )}
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        {profile.has_password && (
          <Field label="รหัสผ่านปัจจุบัน" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        )}
        <Field label="รหัสผ่านใหม่" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" error={short} />
        <Field label="ยืนยันรหัสผ่านใหม่" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" error={mismatch} />
        <div className="flex items-center gap-3 sm:col-span-3">
          <Button type="submit" icon="shield" disabled={busy || !next || !confirm || !!mismatch || !!short || (profile.has_password && !current)}>
            {profile.has_password ? "เปลี่ยนรหัสผ่าน" : "ตั้งรหัสผ่าน"}
          </Button>
          <Status msg={msg} />
        </div>
      </form>
    </Card>
  );
}

// การ์ดบัญชีที่เชื่อม: Google / LINE (เชื่อม / เลิกเชื่อม)
function AccountsCard({ profile, enabled, onSaved }: { profile: Profile; enabled: Provider[]; onSaved: (p: Profile) => void }) {
  const { busy, msg, run } = useAction();
  const all = Array.from(new Set<Provider>([...enabled, ...profile.providers]));
  if (!all.length) return null;
  // เลิกเชื่อมได้ไหม: ต้องเหลือวิธีเข้าสู่ระบบอื่นอย่างน้อย 1 วิธี
  const canUnlink = profile.has_password || profile.providers.length > 1;
  return (
    <Card title="บัญชีที่เชื่อม">
      <ul className="flex flex-col divide-y divide-sky/60">
        {all.map((p) => {
          const linked = profile.providers.includes(p);
          return (
            <Row key={p} title={PROVIDER_NAMES[p]} subtitle={linked ? "เชื่อมแล้ว ใช้เข้าสู่ระบบได้" : "ยังไม่ได้เชื่อม"}>
              {linked ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || !canUnlink}
                  title={canUnlink ? undefined : "ตั้งรหัสผ่านก่อน จึงจะเลิกเชื่อมได้"}
                  onClick={() => void run(async () => onSaved(await api.unlinkProvider(p)), `เลิกเชื่อม ${PROVIDER_NAMES[p]} แล้ว`)}
                >
                  เลิกเชื่อม
                </Button>
              ) : (
                <a href={providerLinkUrl(p, window.location.href)} className="inline-flex h-9 items-center rounded-xl bg-sky/60 px-3 text-sm font-semibold text-navy hover:bg-sky">
                  เชื่อมบัญชี
                </a>
              )}
            </Row>
          );
        })}
      </ul>
      <Status msg={msg} />
    </Card>
  );
}

// แถวรายการ: ชื่อ คำอธิบาย และปุ่มทางขวา
function Row({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div>
        <p className="font-semibold text-navy">{title}</p>
        <p className="text-xs text-ink/60">{subtitle}</p>
      </div>
      {children}
    </li>
  );
}

// การ์ดลบบัญชี: ยืนยันด้วยการพิมพ์ข้อความ + รหัสผ่าน (ถ้ามี)
function DangerCard({ profile }: { profile: Profile }) {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [password, setPassword] = useState("");
  const { busy, msg, run } = useAction();

  // ลบบัญชีแล้วออกจากระบบ กลับหน้าแรก
  const remove = () =>
    void run(async () => {
      await api.deleteAccount(text.trim(), profile.has_password ? password : null);
      setUser(null);
      navigate("/");
    });

  return (
    <Card title="ลบบัญชี" className="ring-1 ring-danger/20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink/70">ลบบัญชีและข้อมูลส่วนตัวทั้งหมด (ชื่อ เบอร์ ข้อมูลบัตร ปุ่ม AAC ที่สร้างเอง) ย้อนกลับไม่ได้</p>
        <Button variant="danger" icon="trash" size="sm" onClick={() => setOpen(true)}>
          ลบบัญชี
        </Button>
      </div>
      <Modal open={open} title="ยืนยันการลบบัญชี" onClose={() => !busy && setOpen(false)}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink/75">
            พิมพ์ <b className="text-danger">{DELETE_CONFIRM}</b> เพื่อยืนยัน
          </p>
          <Field label="ข้อความยืนยัน" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
          {profile.has_password && (
            <Field label="รหัสผ่าน" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          )}
          <Status msg={msg} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              ยกเลิก
            </Button>
            <Button variant="danger" onClick={remove} disabled={busy || text.trim() !== DELETE_CONFIRM || (profile.has_password && !password)}>
              ลบบัญชีถาวร
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
