import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import Badge, { type Tone } from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import Drawer from "../../components/ui/Drawer";
import Field from "../../components/ui/Field";
import Icon from "../../components/ui/Icon";
import Modal from "../../components/ui/Modal";
import SearchInput from "../../components/ui/SearchInput";
import Switch from "../../components/ui/Switch";
import { fmtDate } from "../../lib/format";
import { addUser, deleteUser, listUsers, updateUser, userCardImage, type Role, type User, type UserChanges } from "./services/adminApi";

// บทบาท: ชื่อไทย คำอธิบาย และสีป้าย
const ROLES: { value: Role; label: string; hint: string; tone: Tone }[] = [
  { value: "admin", label: "แอดมิน", hint: "จัดการทุกอย่างในระบบ", tone: "navy" },
  { value: "contributor", label: "ล่าม", hint: "อัดคลิปเก็บข้อมูลภาษามือ", tone: "brand" },
  { value: "user", label: "ผู้ใช้ทั่วไป", hint: "ใช้แปลภาษามือและปุ่ม AAC", tone: "neutral" },
];
const ROLE_OF = Object.fromEntries(ROLES.map((r) => [r.value, r])) as Record<Role, (typeof ROLES)[number]>;

// แท็บกรองผู้ใช้
type Tab = "all" | Role | "performer" | "inactive";

// จัดรูปเวลาเข้าใช้ล่าสุดแบบสัมพัทธ์ เช่น "3 ชม.ที่แล้ว"
function ago(iso: string | null | undefined) {
  if (!iso) return "ยังไม่เคยเข้า";
  const min = (Date.now() - new Date(iso).getTime()) / 60000;
  if (min < 1) return "เมื่อสักครู่";
  if (min < 60) return `${Math.round(min)} นาทีที่แล้ว`;
  if (min < 60 * 24) return `${Math.round(min / 60)} ชม.ที่แล้ว`;
  if (min < 60 * 24 * 30) return `${Math.round(min / 60 / 24)} วันที่แล้ว`;
  return fmtDate(iso);
}

// วงกลมอักษรย่อของผู้ใช้
function Avatar({ name, muted }: { name: string; muted?: boolean }) {
  return (
    <span
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${
        muted ? "bg-ink/10 text-ink/50" : "bg-gradient-to-br from-brand to-royal text-white"
      }`}
    >
      {name.trim().slice(0, 1) || "?"}
    </span>
  );
}

// จัดการผู้ใช้: ค้นหา กรองตามบทบาท แก้ไขข้อมูล/บทบาท/สถานะ เพิ่มผู้แสดง และลบ
export default function UsersView() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [selected, setSelected] = useState<User | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // โหลดรายชื่อผู้ใช้
  useEffect(() => {
    listUsers()
      .then(setUsers)
      .catch((e) => setError(e instanceof Error ? e.message : "โหลดรายชื่อไม่สำเร็จ"));
  }, []);

  // แทนที่ผู้ใช้หนึ่งคนในรายการ (หลังแก้ไข)
  const replace = useCallback((u: User) => {
    setUsers((prev) => prev.map((x) => (x.id === u.id ? u : x)));
    setSelected((s) => (s?.id === u.id ? u : s));
  }, []);

  // เงื่อนไขของแต่ละแท็บ
  const tabs: { value: Tab; label: string; test: (u: User) => boolean }[] = [
    { value: "all", label: "ทั้งหมด", test: () => true },
    ...ROLES.map((r) => ({ value: r.value as Tab, label: r.label, test: (u: User) => u.role === r.value && u.can_login !== false })),
    { value: "performer", label: "ผู้แสดง (ไม่มีบัญชี)", test: (u: User) => u.can_login === false },
    { value: "inactive", label: "ปิดใช้งาน", test: (u: User) => !u.active },
  ];

  const rows = useMemo(() => {
    const test = tabs.find((t) => t.value === tab)!.test;
    const needle = q.trim().toLowerCase();
    return users.filter(
      (u) => test(u) && (!needle || u.name.toLowerCase().includes(needle) || (u.email ?? "").toLowerCase().includes(needle) || (u.phone ?? "").includes(needle)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, q, tab]);

  return (
    <Card
      title={`ผู้ใช้ (${users.length})`}
      action={
        <Button size="sm" variant="soft" icon="plus" onClick={() => setAdding(true)}>
          เพิ่มผู้แสดง
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="ค้นหาชื่อ อีเมล หรือเบอร์โทร" className="min-w-[220px] flex-1" />
      </div>
      <nav className="scrollbar-none mt-3 flex gap-1 overflow-x-auto border-b border-sky/70" aria-label="กรองตามบทบาท">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-semibold transition ${
              tab === t.value ? "border-brand text-navy" : "border-transparent text-ink/55 hover:text-navy"
            }`}
          >
            {t.label} <span className="ml-0.5 text-xs font-normal text-ink/45">{users.filter(t.test).length}</span>
          </button>
        ))}
      </nav>

      {error && <p className="mt-3 rounded-xl bg-danger/10 px-4 py-2 text-sm text-danger">{error}</p>}

      {rows.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-sky px-4 py-10 text-center text-sm text-ink/55">
          {users.length ? "ไม่พบผู้ใช้ตามที่ค้นหา" : "ยังไม่มีผู้ใช้"}
        </p>
      ) : (
        <div className="scrollbar-thin mt-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink/50">
              <tr>
                <th className="py-2 pr-3 font-semibold">ผู้ใช้</th>
                <th className="py-2 pr-3 font-semibold">บทบาท</th>
                <th className="hidden py-2 pr-3 font-semibold sm:table-cell">เข้าใช้ล่าสุด</th>
                <th className="hidden py-2 pr-3 font-semibold sm:table-cell">สถานะ</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/50">
              {rows.map((u) => (
                <tr key={u.id} onClick={() => setSelected(u)} className="cursor-pointer transition hover:bg-sky/20">
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} muted={!u.active} />
                      <div className="min-w-0">
                        <p className={`truncate font-semibold ${u.active ? "text-navy" : "text-ink/50"}`}>
                          {u.name}
                          {u.id === me?.id && <span className="ml-1.5 text-xs font-normal text-ink/45">(คุณ)</span>}
                        </p>
                        <p className="truncate text-xs text-ink/55">{u.can_login === false ? "ผู้แสดง ไม่มีบัญชีเข้าสู่ระบบ" : u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <Badge tone={ROLE_OF[u.role].tone}>{ROLE_OF[u.role].label}</Badge>
                  </td>
                  <td className="hidden py-2.5 pr-3 text-xs text-ink/60 sm:table-cell">{u.can_login === false ? "-" : ago(u.last_login_at)}</td>
                  <td className="hidden py-2.5 pr-3 sm:table-cell">
                    {u.active ? <Badge tone="success">ใช้งาน</Badge> : <Badge>ปิดใช้งาน</Badge>}
                  </td>
                  <td className="hidden py-2.5 text-ink/35 sm:table-cell">
                    <Icon name="arrow" size={16} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UserDrawer
        user={selected}
        isMe={selected?.id === me?.id}
        onClose={() => setSelected(null)}
        onSaved={replace}
        onDeleted={(id) => {
          setUsers((prev) => prev.filter((x) => x.id !== id));
          setSelected(null);
        }}
      />
      <AddPerformer
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(u) => {
          setUsers((prev) => [...prev, u]);
          setAdding(false);
        }}
      />
    </Card>
  );
}

// แผงแก้ไขผู้ใช้: ข้อมูลส่วนตัว บทบาท สถานะ ข้อมูลบัตรคนพิการ และลบ
function UserDrawer({
  user,
  isMe,
  onClose,
  onSaved,
  onDeleted,
}: {
  user: User | null;
  isMe: boolean;
  onClose: () => void;
  onSaved: (u: User) => void;
  onDeleted: (id: string) => void;
}) {
  const [form, setForm] = useState({ first_name: "", last_name: "", phone: "", disability_card_number: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [card, setCard] = useState<string | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);

  // เปิดผู้ใช้คนใหม่: ใส่ค่าลงฟอร์ม ล้างข้อความ/รูปเดิม
  useEffect(() => {
    if (!user) return;
    setForm({
      first_name: user.first_name ?? user.name,
      last_name: user.last_name ?? "",
      phone: user.phone ?? "",
      disability_card_number: user.disability_card_number ?? "",
    });
    setMsg(null);
    setCardError(null);
    setCard((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // บันทึกการเปลี่ยนแปลงแล้วแจ้งผล
  const save = async (changes: UserChanges, okText = "บันทึกแล้ว") => {
    if (!user) return;
    setBusy(true);
    setMsg(null);
    try {
      onSaved(await updateUser(user.id, changes));
      setMsg({ ok: true, text: okText });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" });
    } finally {
      setBusy(false);
    }
  };

  // ส่งฟอร์มข้อมูลส่วนตัว (ส่งเฉพาะช่องที่เปลี่ยน)
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!user || !form.first_name.trim()) return;
    const changes: UserChanges = {};
    if (form.first_name.trim() !== (user.first_name ?? user.name)) changes.first_name = form.first_name.trim();
    if (form.last_name.trim() !== (user.last_name ?? "")) changes.last_name = form.last_name.trim();
    if (form.phone.replace(/\D/g, "") !== (user.phone ?? "")) changes.phone = form.phone;
    if (form.disability_card_number.replace(/\D/g, "") !== (user.disability_card_number ?? "").replace(/\D/g, ""))
      changes.disability_card_number = form.disability_card_number;
    if (Object.keys(changes).length) void save(changes);
  };

  // ลบผู้ใช้ (หลังยืนยัน)
  const remove = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await deleteUser(user.id);
      setConfirmDelete(false);
      onDeleted(user.id);
    } catch (e) {
      setConfirmDelete(false);
      setMsg({ ok: false, text: e instanceof Error ? e.message : "ลบไม่สำเร็จ" });
    } finally {
      setBusy(false);
    }
  };

  // โหลดรูปบัตรคนพิการ (เฉพาะตอนแอดมินกดดู)
  const showCard = async () => {
    if (!user) return;
    try {
      setCard(await userCardImage(user.id));
    } catch (e) {
      setCardError(e instanceof Error ? e.message : "โหลดรูปไม่สำเร็จ");
    }
  };

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const performer = user?.can_login === false;

  return (
    <>
      <Drawer
        open={!!user}
        title={user?.name ?? ""}
        subtitle={performer ? "ผู้แสดง (ไม่มีบัญชีเข้าสู่ระบบ)" : user?.email}
        onClose={onClose}
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-ink/50">สมัครเมื่อ {fmtDate(user?.created_at)}</span>
            <Button size="sm" variant="ghost" icon="trash" className="text-danger" disabled={busy || isMe} onClick={() => setConfirmDelete(true)}>
              ลบผู้ใช้
            </Button>
          </div>
        }
      >
        {user && (
          <div className="flex flex-col gap-5">
            {/* บทบาทและสถานะ */}
            <section>
              <h3 className="mb-2 text-sm font-bold text-navy">บทบาท</h3>
              <div className="grid gap-2">
                {ROLES.map((r) => (
                  <label
                    key={r.value}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 ring-1 transition ${
                      user.role === r.value ? "bg-white ring-brand" : "bg-white/60 ring-sky hover:ring-brand/50"
                    } ${isMe && r.value !== "admin" ? "pointer-events-none opacity-50" : ""}`}
                  >
                    <input
                      type="radio"
                      name="role"
                      checked={user.role === r.value}
                      disabled={busy || (isMe && r.value !== "admin")}
                      onChange={() => void save({ role: r.value }, `เปลี่ยนเป็น${r.label}แล้ว`)}
                      className="h-4 w-4 accent-brand"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-navy">{r.label}</span>
                      <span className="block text-xs text-ink/55">{r.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-xl bg-white/60 px-3 py-2 ring-1 ring-sky">
                <span>
                  <span className="block text-sm font-semibold text-navy">เปิดใช้งาน</span>
                  <span className="block text-xs text-ink/55">ปิดแล้วเข้าสู่ระบบไม่ได้ทันที (ข้อมูลยังอยู่)</span>
                </span>
                <Switch
                  checked={user.active}
                  disabled={busy || isMe}
                  label="เปิดใช้งาน"
                  onChange={(v) => void save({ active: v }, v ? "เปิดใช้งานแล้ว" : "ปิดใช้งานแล้ว")}
                />
              </div>
              {isMe && <p className="mt-1.5 text-xs text-ink/50">เปลี่ยนบทบาทหรือปิดบัญชีของตัวเองไม่ได้</p>}
            </section>

            {/* ข้อมูลส่วนตัว */}
            <form onSubmit={submit} className="flex flex-col gap-3">
              <h3 className="text-sm font-bold text-navy">ข้อมูลส่วนตัว</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="ชื่อ" value={form.first_name} onChange={set("first_name")} maxLength={50} required />
                <Field label="นามสกุล" value={form.last_name} onChange={set("last_name")} maxLength={50} />
              </div>
              {!performer && (
                <>
                  <Field label="เบอร์โทร" value={form.phone} onChange={set("phone")} inputMode="tel" maxLength={14} placeholder="-" />
                  <Field label="เลขบัตรคนพิการ" value={form.disability_card_number} onChange={set("disability_card_number")} inputMode="numeric" maxLength={17} placeholder="-" />
                  <div className="rounded-xl bg-white/60 px-3 py-2 ring-1 ring-sky">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-navy">รูปบัตรคนพิการ</span>
                      {user.has_card_image ? (
                        !card && (
                          <Button size="sm" variant="soft" icon="eye" type="button" onClick={() => void showCard()}>
                            ดูรูป
                          </Button>
                        )
                      ) : (
                        <span className="text-xs text-ink/50">ผู้ใช้ยังไม่ได้อัปโหลด</span>
                      )}
                    </div>
                    {card && <img src={card} alt={`รูปบัตรของ ${user.name}`} className="mt-2 w-full rounded-lg ring-1 ring-sky" />}
                    {cardError && <p className="mt-1 text-xs text-danger">{cardError}</p>}
                  </div>
                </>
              )}
              <div className="flex items-center gap-3">
                <Button type="submit" icon="check" disabled={busy || !form.first_name.trim()}>
                  บันทึกข้อมูล
                </Button>
                {msg && <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-danger"}`}>{msg.text}</span>}
              </div>
            </form>
          </div>
        )}
      </Drawer>
      <ConfirmDialog
        open={confirmDelete}
        title="ลบผู้ใช้"
        danger
        busy={busy}
        confirmLabel="ลบถาวร"
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
      >
        ลบ <b>{user?.name}</b> และข้อมูลส่วนตัวทั้งหมด (รูปบัตร ปุ่ม AAC ที่สร้างเอง) ย้อนกลับไม่ได้ · คลิปที่เคยอัดยังเก็บไว้
        {!performer && <p className="mt-2 text-xs text-ink/60">ถ้าแค่ไม่ให้เข้าใช้ชั่วคราว ให้ปิดสวิตช์ "เปิดใช้งาน" แทน</p>}
      </ConfirmDialog>
    </>
  );
}

// หน้าต่างเพิ่มผู้แสดง: ชื่อคนที่ทำท่าในคลิป (ไม่มีอีเมล ล็อกอินไม่ได้)
function AddPerformer({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (u: User) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // เพิ่มผู้แสดงจากฟอร์ม
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onAdded(await addUser(name.trim(), "contributor"));
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "เพิ่มไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="เพิ่มผู้แสดง" onClose={onClose}>
      <p className="mb-3 text-sm text-ink/70">
        ใช้เป็นชื่อ "ผู้แสดง" ตอนล่ามอัดคลิป (คนที่ทำท่าในคลิป) ไม่มีบัญชีเข้าสู่ระบบ — ถ้าต้องการให้คนนั้นเข้าพื้นที่ล่ามเอง
        ให้เขาสมัครสมาชิกแล้วเปลี่ยนบทบาทเป็นล่ามแทน
      </p>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <Field label="ชื่อผู้แสดง" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="เช่น ล่ามสมศรี" error={error} autoFocus />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="submit" icon="plus" disabled={busy || !name.trim()}>
            เพิ่ม
          </Button>
        </div>
      </form>
    </Modal>
  );
}
