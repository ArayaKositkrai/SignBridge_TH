// แอดมิน → ผู้ใช้: ตารางผู้ใช้ เพิ่ม/แก้/ปิดบัญชี ตั้งบทบาท และตั้งชุดเทรน/เทสของล่าม

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import Badge, { type Tone } from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import Dialog from "../../components/ui/Dialog";
import Field from "../../components/ui/Field";
import Icon from "../../components/ui/Icon";
import SearchInput from "../../components/ui/SearchInput";
import Switch from "../../components/ui/Switch";
import { fmtDate } from "../../lib/format";
import DataTable, { type Column } from "./components/DataTable";
import PageHeader from "./components/PageHeader";
import StatCards, { type Stat } from "./components/StatCards";
import Toolbar from "./components/Toolbar";
import {
  addUser,
  deleteUser,
  listUsers,
  setUserSplit,
  updateUser,
  userCardImage,
  type Role,
  type Split,
  type User,
  type UserChanges,
} from "./services/adminApi";

// บทบาท: ชื่อไทย คำอธิบาย และสีป้าย
const ROLES: { value: Role; label: string; hint: string; tone: Tone }[] = [
  { value: "admin", label: "แอดมิน", hint: "จัดการทุกอย่างในระบบ", tone: "navy" },
  { value: "contributor", label: "ล่าม", hint: "อัดคลิปเก็บข้อมูลภาษามือ", tone: "brand" },
  { value: "user", label: "ผู้ใช้ทั่วไป", hint: "ใช้แปลภาษามือและปุ่ม AAC", tone: "neutral" },
];
const ROLE_OF = Object.fromEntries(ROLES.map((r) => [r.value, r])) as Record<Role, (typeof ROLES)[number]>;

// ตัวกรองผู้ใช้ (จากการ์ดตัวเลขด้านบน)
type Tab = "all" | Role | "performer" | "inactive";
// เงื่อนไขของแต่ละตัวกรอง (นับตามบทบาท รวมคนที่ยังไม่มีบัญชีเข้าสู่ระบบ ให้ตรงกับตัวเลขในแดชบอร์ด)
const TAB_TEST: Record<Tab, (u: User) => boolean> = {
  all: () => true,
  admin: (u) => u.role === "admin",
  contributor: (u) => u.role === "contributor",
  user: (u) => u.role === "user",
  performer: (u) => u.can_login === false,
  inactive: (u) => !u.active,
};

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

// จัดการผู้ใช้: ตัวเลขสรุป (กดกรองได้) ค้นหา ตารางผู้ใช้ แก้ไขและเพิ่มล่ามในหน้าต่างกลางจอแบบเดียวกัน
export default function UsersView() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  // เปิดมาที่ตัวกรองไหนก็ได้ผ่านลิงก์ เช่น /admin/users?tab=contributor (ค่าที่ไม่รู้จัก = ทั้งหมด)
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const t = params.get("tab") as Tab | null;
    return t && t in TAB_TEST ? t : "all";
  });
  const [selected, setSelected] = useState<User | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // โหลดรายชื่อผู้ใช้
  useEffect(() => {
    listUsers()
      .then(setUsers)
      .catch((e) => setError(e instanceof Error ? e.message : "โหลดรายชื่อไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, []);

  // แทนที่ผู้ใช้หนึ่งคนในรายการ (หลังแก้ไข)
  const replace = useCallback((u: User) => {
    setUsers((prev) => prev.map((x) => (x.id === u.id ? u : x)));
    setSelected((s) => (s?.id === u.id ? u : s));
  }, []);

  const rows = useMemo(() => {
    const test = TAB_TEST[tab];
    const needle = q.trim().toLowerCase();
    return users.filter(
      (u) =>
        test(u) &&
        (!needle || u.name.toLowerCase().includes(needle) || (u.email ?? "").toLowerCase().includes(needle) || (u.phone ?? "").includes(needle)),
    );
  }, [users, q, tab]);

  // จำนวนผู้ใช้ของแต่ละตัวกรอง
  const count = (t: Tab) => users.filter(TAB_TEST[t]).length;
  const stats: Stat[] = [
    { label: "ผู้ใช้ทั้งหมด", value: users.length, filter: "all" },
    { label: "แอดมิน", value: count("admin"), filter: "admin" },
    { label: "ล่าม", value: count("contributor"), filter: "contributor", hint: count("performer") ? `ยังไม่มีบัญชีเข้าสู่ระบบ ${count("performer")} คน` : undefined },
    { label: "ผู้ใช้ทั่วไป", value: count("user"), filter: "user" },
    { label: "ปิดใช้งาน", value: count("inactive"), filter: "inactive", tone: count("inactive") ? "warning" : "default" },
  ];

  const columns: Column<User>[] = [
    {
      key: "name",
      header: "ผู้ใช้",
      sort: (u) => u.name,
      cell: (u) => (
        <div className="flex items-center gap-3">
          <Avatar name={u.name} muted={!u.active} />
          <div className="min-w-0">
            <p className={`truncate font-semibold ${u.active ? "text-navy" : "text-ink/50"}`}>
              {u.name}
              {u.id === me?.id && <span className="ml-1.5 text-xs font-normal text-ink/45">(คุณ)</span>}
            </p>
            <p className="truncate text-xs text-ink/55">{u.can_login === false ? `${u.email ?? "ไม่มีอีเมล"} · ยังไม่มีบัญชีเข้าสู่ระบบ` : u.email}</p>
          </div>
        </div>
      ),
    },
    { key: "role", header: "บทบาท", sort: (u) => ROLE_OF[u.role].label, cell: (u) => <Badge tone={ROLE_OF[u.role].tone}>{ROLE_OF[u.role].label}</Badge> },
    {
      key: "split",
      header: "คลิปที่อัด",
      hideBelow: "md",
      sort: (u) => (u.split == null ? null : `${u.split}${String(u.clips ?? 0).padStart(6, "0")}`),
      cell: (u) => (u.split == null ? <span className="text-ink/35">–</span> : <SplitBadge split={u.split} clips={u.clips ?? 0} />),
    },
    { key: "phone", header: "เบอร์โทร", hideBelow: "lg", sort: (u) => u.phone, cell: (u) => <span className="tabular-nums text-ink/70">{u.phone ?? "–"}</span> },
    {
      key: "card",
      header: "บัตรคนพิการ",
      hideBelow: "lg",
      sort: (u) => (u.disability_card_number ? 1 : 0) + (u.has_card_image ? 1 : 0),
      cell: (u) =>
        u.disability_card_number || u.has_card_image ? (
          <Badge tone="brand">{u.has_card_image ? "มีเลข + รูป" : "มีเลขบัตร"}</Badge>
        ) : (
          <span className="text-ink/35">–</span>
        ),
    },
    {
      key: "login",
      header: "เข้าใช้ล่าสุด",
      hideBelow: "md",
      sort: (u) => u.last_login_at ?? "",
      cell: (u) => <span className="text-xs text-ink/60">{u.can_login === false ? "–" : ago(u.last_login_at)}</span>,
    },
    {
      key: "status",
      header: "สถานะ",
      hideBelow: "sm",
      sort: (u) => (u.active ? 1 : 0),
      cell: (u) => (u.active ? <Badge tone="success">ใช้งาน</Badge> : <Badge>ปิดใช้งาน</Badge>),
    },
    {
      key: "edit",
      header: <span className="sr-only">แก้ไข</span>,
      align: "right",
      width: "5rem",
      cell: () => <span className="text-xs font-semibold text-brand">แก้ไข</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="ผู้ใช้"
        description="เปลี่ยนบทบาท เปิด/ปิดการใช้งาน และดูข้อมูลส่วนตัวของผู้ใช้ (คลิกแถวเพื่อแก้ไข)"
        actions={
          <Button icon="plus" onClick={() => setAdding(true)}>
            เพิ่มล่าม
          </Button>
        }
      />
      <StatCards stats={stats} active={tab} onSelect={(f) => setTab((f || "all") as Tab)} />
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="ค้นหาชื่อ อีเมล หรือเบอร์โทร" className="min-w-[240px] flex-1" />
      </Toolbar>
      {error && <p className="mb-3 rounded-xl bg-danger/10 px-4 py-2 text-sm text-danger">{error}</p>}
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(u) => u.id}
        onRowClick={setSelected}
        loading={loading}
        initialSort={{ key: "name", dir: "asc" }}
        empty={users.length ? "ไม่พบผู้ใช้ตามที่ค้นหา" : "ยังไม่มีผู้ใช้"}
      />

      <UserDialog
        user={selected}
        creating={adding}
        isMe={!adding && selected?.id === me?.id}
        onClose={() => (adding ? setAdding(false) : setSelected(null))}
        onCreated={(u) => setUsers((prev) => [...prev, u])}
        onSaved={replace}
        onDeleted={(id) => {
          setUsers((prev) => prev.filter((x) => x.id !== id));
          setSelected(null);
        }}
      />
    </>
  );
}

// ชื่อและคำอธิบายของชุดข้อมูล (ใช้ทั้งในตารางและหน้าต่างแก้ไข)
const SPLITS: { value: Split; label: string; hint: string }[] = [
  { value: "train", label: "เทรน", hint: "ให้โมเดลเรียนจากท่าของคนนี้" },
  { value: "test", label: "ทดสอบ", hint: "กันไว้วัดความแม่นยำ โมเดลไม่เคยเห็นคนนี้" },
];

// ป้ายชุดข้อมูลของคลิปที่ล่ามคนนี้อัด พร้อมจำนวนคลิป
function SplitBadge({ split, clips }: { split: Split; clips: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={split === "test" ? "warning" : "brand"}>{split === "test" ? "ทดสอบ" : "เทรน"}</Badge>
      <span className="text-xs tabular-nums text-ink/50">{clips.toLocaleString("th-TH")} คลิป</span>
    </span>
  );
}

// ช่องข้อมูลที่เก็บของแต่ละบทบาท (ตรงกับ CARD_ROLES ใน backend: บัตรคนพิการเก็บเฉพาะผู้ใช้ทั่วไป)
const ROLE_FIELDS: Record<Role, { card: boolean; note: string }> = {
  admin: { card: false, note: "แอดมินเก็บชื่อ อีเมล และเบอร์ติดต่อ" },
  contributor: { card: false, note: "ล่ามเก็บชื่อ อีเมล และเบอร์ติดต่อ" },
  user: { card: true, note: "ผู้ใช้ทั่วไปเก็บเบอร์โทรและข้อมูลบัตรคนพิการ (เห็นได้เฉพาะเจ้าของและแอดมิน)" },
};

// กล่องข้อมูลสั้น ๆ (ชื่อหัวข้อ + ค่า)
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-panel px-3 py-2 ring-1 ring-sky">
      <dt className="text-xs text-ink/55">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-navy">{children}</dd>
    </div>
  );
}

// หน้าต่างแก้ไขผู้ใช้ (กลางจอ): ซ้าย = บทบาท/สถานะ ขวา = ข้อมูลส่วนตัวเฉพาะที่บทบาทนั้นเก็บ
function UserDialog({
  user: existing,
  creating = false,
  isMe,
  onClose,
  onCreated,
  onSaved,
  onDeleted,
}: {
  user: User | null;
  // true = โหมดเพิ่มล่ามใหม่ (หน้าตาเหมือนตอนแก้ไข แต่เก็บค่าไว้ในฟอร์มจนกดบันทึก)
  creating?: boolean;
  isMe: boolean;
  onClose: () => void;
  onCreated: (u: User) => void;
  onSaved: (u: User) => void;
  onDeleted: (id: string) => void;
}) {
  // ค่าบทบาท/สถานะ/ชุดข้อมูลที่เลือกไว้ตอนเพิ่ม (ยังไม่ส่งไป backend)
  const [draft, setDraft] = useState<{ role: Role; active: boolean; split: Split }>({ role: "contributor", active: true, split: "train" });
  const user: User | null = creating
    ? { id: "", name: "", first_name: "", last_name: null, email: null, role: draft.role, active: draft.active, can_login: true, split: draft.role === "user" ? null : draft.split, clips: 0 }
    : existing;
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", phone: "", disability_card_number: "" });
  const [busy, setBusy] = useState(false);
  // ข้อความผิดพลาดใต้ฟอร์ม (บันทึกสำเร็จแจ้งด้วย toast)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [card, setCard] = useState<string | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);

  // เปิดผู้ใช้คนใหม่: ใส่ค่าลงฟอร์ม ล้างข้อความ/รูปเดิม
  useEffect(() => {
    if (!user) return;
    if (creating) setDraft({ role: "contributor", active: true, split: "train" });
    setForm({
      first_name: user.first_name ?? user.name,
      last_name: user.last_name ?? "",
      email: user.email ?? "",
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
  }, [user?.id, creating]);

  // บันทึกการเปลี่ยนแปลงแล้วแจ้งผล
  const save = async (changes: UserChanges, okText = "บันทึกแล้ว") => {
    if (!user) return;
    if (creating) {
      setDraft((d) => ({ ...d, role: changes.role ?? d.role, active: changes.active ?? d.active }));
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      onSaved(await updateUser(user.id, changes));
      toast.success(okText);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" });
    } finally {
      setBusy(false);
    }
  };

  // เปลี่ยนชุดข้อมูลของคลิปทั้งหมดที่อัดในชื่อนี้
  const saveSplit = async (split: Split) => {
    if (!user || user.split === split) return;
    if (creating) {
      setDraft((d) => ({ ...d, split }));
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      onSaved({ ...user, ...(await setUserSplit(user.id, split)) });
      toast.success(split === "test" ? "ตั้งเป็นชุดเทสแล้ว" : "ตั้งเป็นชุดเทรนแล้ว");
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" });
    } finally {
      setBusy(false);
    }
  };

  const performer = user?.can_login === false;
  const fields = ROLE_FIELDS[user?.role ?? "user"];
  // ข้อมูลบัตรค้างจากตอนเป็นผู้ใช้ทั่วไป (บทบาทปัจจุบันไม่เก็บแล้ว)
  const leftoverCard = !!user && !fields.card && (!!user.disability_card_number || !!user.has_card_image);

  // ส่งฟอร์มข้อมูลส่วนตัว (ส่งเฉพาะช่องที่เปลี่ยน และเฉพาะช่องที่บทบาทนี้เก็บ)
  const create = async () => {
    setBusy(true);
    setMsg(null);
    let created: User;
    try {
      created = await addUser(form.first_name.trim(), draft.role);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "เพิ่มไม่สำเร็จ" });
      setBusy(false);
      return;
    }
    try {
      // backend สร้างได้ด้วยชื่อเท่านั้น ที่เหลือตั้งต่อด้วย API เดียวกับตอนแก้ไข
      const changes: UserChanges = {};
      if (form.last_name.trim()) changes.last_name = form.last_name.trim();
      if (form.email.trim()) changes.email = form.email.trim();
      if (form.phone.replace(/\D/g, "")) changes.phone = form.phone;
      if (fields.card && form.disability_card_number.replace(/\D/g, "")) changes.disability_card_number = form.disability_card_number;
      if (!draft.active) changes.active = false;
      if (Object.keys(changes).length) created = await updateUser(created.id, changes);
      if (draft.role !== "user" && draft.split === "test") created = { ...created, ...(await setUserSplit(created.id, "test")) };
    } catch (err) {
      // เพิ่มสำเร็จแล้วแต่ตั้งค่าต่อไม่ได้ ใส่เข้ารายการไว้ แล้วบอกให้ไปแก้ในหน้าแก้ไข
      onCreated(created);
      setMsg({ ok: false, text: `เพิ่มแล้ว แต่ตั้งค่าต่อไม่สำเร็จ (${err instanceof Error ? err.message : "ผิดพลาด"}) กรุณาแก้ในหน้าแก้ไข` });
      setBusy(false);
      return;
    }
    onCreated(created);
    setBusy(false);
    toast.success(`เพิ่ม ${created.name || form.first_name.trim()} แล้ว`);
    onClose();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!user || !form.first_name.trim()) return;
    if (creating) {
      void create();
      return;
    }
    const changes: UserChanges = {};
    if (form.first_name.trim() !== (user.first_name ?? user.name)) changes.first_name = form.first_name.trim();
    if (form.last_name.trim() !== (user.last_name ?? "")) changes.last_name = form.last_name.trim();
    if (performer && form.email.trim().toLowerCase() !== (user.email ?? "")) changes.email = form.email.trim();
    if (form.phone.replace(/\D/g, "") !== (user.phone ?? "")) changes.phone = form.phone;
    if (!performer && fields.card && form.disability_card_number.replace(/\D/g, "") !== (user.disability_card_number ?? "").replace(/\D/g, ""))
      changes.disability_card_number = form.disability_card_number;
    if (Object.keys(changes).length) void save(changes);
    else toast.info("ไม่มีอะไรเปลี่ยน");
  };

  // ลบผู้ใช้ (หลังยืนยัน)
  const remove = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await deleteUser(user.id);
      setConfirmDelete(false);
      onDeleted(user.id);
      toast.success(`ลบ ${user.name} แล้ว`);
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

  return (
    <>
      <Dialog
        open={!!user}
        size="xl"
        title={creating ? "เพิ่มล่าม" : user ? `แก้ไขผู้ใช้ · ${user.name}` : ""}
        subtitle={creating ? "ล่าม (ยังไม่มีบัญชีเข้าสู่ระบบ)" : performer ? "ล่าม (ไม่มีบัญชีเข้าสู่ระบบ)" : user?.email}
        onClose={onClose}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            {creating ? (
              <span />
            ) : (
              <Button size="sm" variant="ghost" icon="trash" className="text-danger" disabled={busy || isMe} onClick={() => setConfirmDelete(true)}>
                ลบผู้ใช้
              </Button>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {msg && <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-danger"}`}>{msg.text}</span>}
              <Button variant="ghost" onClick={onClose}>
                ปิด
              </Button>
              <Button type="submit" form="user-form" icon="check" disabled={busy || !form.first_name.trim()}>
                บันทึกข้อมูล
              </Button>
            </div>
          </div>
        }
      >
        {user && (
          <div className="grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            {/* ซ้าย: บัญชี (บทบาท สถานะ วันที่) */}
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-bold text-navy">บัญชี</h3>
              {performer ? (
                <p className="rounded-xl bg-panel px-3 py-2 text-sm text-ink/70 ring-1 ring-sky">
                  คนนี้ยังไม่มีบัญชีเข้าสู่ระบบ ใส่อีเมล Google ของเขาไว้ได้ เมื่อเขากด "เข้าสู่ระบบด้วย Google" ด้วยอีเมลนี้
                  จะเข้าบัญชีนี้เลย คลิปที่อัดไว้และการตั้งชุดเทรน/ทดสอบอยู่บัญชีเดียวกัน
                </p>
              ) : (
                <div role="radiogroup" aria-label="บทบาท" className="grid gap-2">
                  {ROLES.map((r) => {
                    const locked = isMe && r.value !== "admin";
                    return (
                      <label
                        key={r.value}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition ${
                          user.role === r.value ? "bg-brand/15 ring-2 ring-brand" : "bg-panel ring-1 ring-sky hover:ring-brand/50"
                        } ${locked ? "pointer-events-none opacity-50" : ""}`}
                      >
                        <input
                          type="radio"
                          name="role"
                          checked={user.role === r.value}
                          disabled={busy || locked}
                          onChange={() => void save({ role: r.value }, `เปลี่ยนเป็น${r.label}แล้ว`)}
                          className="h-4 w-4 accent-brand"
                        />
                        <span>
                          <span className="block text-sm font-semibold text-navy">{r.label}</span>
                          <span className="block text-xs text-ink/55">{r.hint}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              <div className="flex items-center justify-between gap-3 rounded-xl bg-panel px-3 py-2 ring-1 ring-sky">
                <span>
                  <span className="block text-sm font-semibold text-navy">เปิดใช้งาน</span>
                  <span className="block text-xs text-ink/55">ปิดแล้วเข้าสู่ระบบไม่ได้ทันที (ข้อมูลยังอยู่)</span>
                </span>
                <Switch checked={user.active} disabled={busy || isMe} label="เปิดใช้งาน" onChange={(v) => void save({ active: v }, v ? "เปิดใช้งานแล้ว" : "ปิดใช้งานแล้ว")} />
              </div>
              {isMe && <p className="text-xs text-ink/50">เปลี่ยนบทบาท ปิด หรือลบบัญชีของตัวเองไม่ได้</p>}
              {user.split != null && (
                <div className="rounded-xl bg-panel px-3 py-2.5 ring-1 ring-sky">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-navy">คลิปที่อัดในชื่อนี้ใช้เป็น</span>
                    <span className="text-xs tabular-nums text-ink/55">{(user.clips ?? 0).toLocaleString("th-TH")} คลิป</span>
                  </div>
                  <div role="radiogroup" aria-label="ชุดข้อมูล" className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-surface p-1 ring-1 ring-sky">
                    {SPLITS.map((sp) => {
                      const on = user.split === sp.value;
                      return (
                        <button
                          key={sp.value}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          disabled={busy}
                          onClick={() => void saveSplit(sp.value)}
                          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                            on ? (sp.value === "test" ? "bg-amber-400 text-amber-950" : "bg-deep text-white") : "text-ink/70 hover:bg-sky/40"
                          }`}
                        >
                          {sp.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-xs text-ink/55">
                    {SPLITS.find((sp) => sp.value === user.split)!.hint} · มีผลตอนเทรนครั้งถัดไป และคลิปที่จะอัดต่อจากนี้ด้วย
                  </p>
                </div>
              )}
              <dl className="grid grid-cols-2 gap-2">
                <Fact label="สมัครเมื่อ">{creating ? "–" : fmtDate(user.created_at)}</Fact>
                <Fact label="เข้าใช้ล่าสุด">{performer || creating ? "–" : ago(user.last_login_at)}</Fact>
              </dl>
            </section>

            {/* ขวา: ข้อมูลส่วนตัวตามบทบาท */}
            <form id="user-form" onSubmit={submit} className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-bold text-navy">ข้อมูลส่วนตัว</h3>
                {!performer && <p className="text-xs text-ink/55">{fields.note}</p>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="ชื่อ" value={form.first_name} onChange={set("first_name")} maxLength={50} required />
                <Field label="นามสกุล" value={form.last_name} onChange={set("last_name")} maxLength={50} />
                {performer || creating ? (
                  <Field
                    label="อีเมล (ไม่ใส่ก็ได้)"
                    type="email"
                    value={form.email}
                    onChange={set("email")}
                    maxLength={120}
                    placeholder="name@gmail.com"
                    hint="ใช้ล็อกอินด้วย Google ภายหลัง"
                  />
                ) : (
                  <Field label="อีเมล" value={user.email ?? "-"} disabled hint="ใช้เข้าสู่ระบบ เปลี่ยนไม่ได้" />
                )}
                <Field label="เบอร์โทร" value={form.phone} onChange={set("phone")} inputMode="tel" maxLength={14} placeholder="08xxxxxxxx" />
              </div>
              {!performer && fields.card && (
                <fieldset className="mt-1 flex flex-col gap-3 rounded-2xl bg-panel p-3 ring-1 ring-sky">
                  <legend className="px-1 text-sm font-bold text-navy">บัตรคนพิการ</legend>
                  <Field
                    label="เลขบัตรคนพิการ"
                    value={form.disability_card_number}
                    onChange={set("disability_card_number")}
                    inputMode="numeric"
                    maxLength={17}
                    placeholder="x-xxxx-xxxxx-xx-x"
                  />
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-navy">รูปบัตร</span>
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
                    {card && <img src={card} alt={`รูปบัตรของ ${user.name}`} className="mt-2 max-h-64 w-full rounded-lg object-contain ring-1 ring-sky" />}
                    {cardError && <p className="mt-1 text-xs text-danger">{cardError}</p>}
                  </div>
                </fieldset>
              )}
              {leftoverCard && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
                  <span>มีข้อมูลบัตรคนพิการค้างจากตอนเป็นผู้ใช้ทั่วไป (บทบาทนี้ไม่เก็บแล้ว)</span>
                  {user.disability_card_number && (
                    <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={() => void save({ disability_card_number: "" }, "ลบเลขบัตรแล้ว")}>
                      ลบเลขบัตร
                    </Button>
                  )}
                </div>
              )}
            </form>
          </div>
        )}
      </Dialog>
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
