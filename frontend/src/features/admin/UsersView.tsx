import { useEffect, useState, type FormEvent } from "react";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Icon from "../../components/ui/Icon";
import { fmtDate } from "../../lib/format";
import { addUser, deleteUser, listUsers, updateUser, type Role, type User } from "./services/adminApi";

// ชื่อบทบาทภาษาไทย พร้อมคำอธิบาย
const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "admin", label: "แอดมิน", hint: "จัดการทุกอย่าง" },
  { value: "contributor", label: "ล่าม", hint: "อัดคลิปเก็บข้อมูล" },
  { value: "user", label: "ผู้ใช้ทั่วไป", hint: "ใช้แปลภาษามือ" },
];

// จัดการผู้ใช้: เพิ่ม เปลี่ยนบทบาท เปิด/ปิดการใช้งาน ลบ
export default function UsersView() {
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("contributor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // โหลดรายชื่อผู้ใช้
  useEffect(() => {
    listUsers()
      .then(setUsers)
      .catch((e) => setError(e instanceof Error ? e.message : "โหลดรายชื่อไม่สำเร็จ"));
  }, []);

  // เรียก API แล้วแสดงข้อผิดพลาดถ้ามี
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาด");
    } finally {
      setBusy(false);
    }
  };

  // เพิ่มผู้ใช้จากฟอร์ม
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    void run(async () => {
      const user = await addUser(name.trim(), role);
      setUsers((prev) => [...prev, user]);
      setName("");
    });
  };

  // แก้ไขบทบาทหรือสถานะ แล้วแทนที่แถวเดิม
  const patch = (u: User, changes: Partial<Pick<User, "role" | "active">>) =>
    void run(async () => {
      const updated = await updateUser(u.id, changes);
      setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
    });

  // ลบผู้ใช้ (ถามยืนยันก่อน)
  const remove = (u: User) => {
    if (!window.confirm(`ลบผู้ใช้ "${u.name}" ใช่ไหม?`)) return;
    void run(async () => {
      await deleteUser(u.id);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
        <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
        <span>
          ตอนนี้ยังไม่มีระบบล็อกอิน รายชื่อนี้ใช้เป็นตัวเลือก "ผู้แสดง" ในพื้นที่ล่าม และบันทึกว่าใครอัดคลิปไหน
          ทุกคนที่เปิดหน้านี้ได้ยังแก้ไขได้
        </span>
      </div>

      <Card title="เพิ่มผู้ใช้">
        <form onSubmit={submit} className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="ชื่อ เช่น ล่ามสมศรี"
            className="h-11 min-w-[200px] flex-1 rounded-xl border border-sky bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-brand/30"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="h-11 rounded-xl border border-sky bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            aria-label="บทบาท"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label} — {r.hint}
              </option>
            ))}
          </select>
          <Button type="submit" icon="plus" disabled={busy || !name.trim()}>
            เพิ่ม
          </Button>
        </form>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </Card>

      <Card title={`ผู้ใช้ทั้งหมด (${users.length})`}>
        {users.length === 0 ? (
          <p className="text-sm text-ink/60">ยังไม่มีผู้ใช้</p>
        ) : (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-ink/60">
                <tr>
                  <th className="py-2 pr-3 font-semibold">ชื่อ</th>
                  <th className="py-2 pr-3 font-semibold">บทบาท</th>
                  <th className="py-2 pr-3 font-semibold">สถานะ</th>
                  <th className="py-2 pr-3 font-semibold">เพิ่มเมื่อ</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-sky/60">
                {users.map((u) => (
                  <tr key={u.id} className={u.active ? "" : "opacity-55"}>
                    <td className="py-2 pr-3 font-semibold text-navy">{u.name}</td>
                    <td className="py-2 pr-3">
                      <select
                        value={u.role}
                        onChange={(e) => patch(u, { role: e.target.value as Role })}
                        disabled={busy}
                        className="h-9 rounded-lg border border-sky bg-white px-2 text-sm"
                        aria-label={`บทบาทของ ${u.name}`}
                      >
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={u.active}
                        onClick={() => patch(u, { active: !u.active })}
                        disabled={busy}
                        className={`relative h-6 w-11 rounded-full transition ${u.active ? "bg-emerald-500" : "bg-ink/25"}`}
                        aria-label={u.active ? "ปิดการใช้งาน" : "เปิดการใช้งาน"}
                      >
                        <span
                          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                            u.active ? "left-[22px]" : "left-0.5"
                          }`}
                        />
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-xs text-ink/60">{fmtDate(u.created_at)}</td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => remove(u)}
                        disabled={busy}
                        className="grid h-8 w-8 place-items-center rounded-lg text-danger hover:bg-danger/10"
                        aria-label={`ลบ ${u.name}`}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
