import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import PageTitle from "../../components/ui/PageTitle";
import { useAuth } from "./AuthContext";
import { providerLoginUrl, type Provider } from "./services/authApi";

// สไตล์ช่องกรอกข้อมูล
const INPUT =
  "h-11 w-full rounded-xl border border-sky bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-brand/30";

// ปุ่มล็อกอินด้วยบัญชีภายนอก: ชื่อ สี และโลโก้
const PROVIDERS: Record<Provider, { label: string; className: string; logo: JSX.Element }> = {
  google: {
    label: "เข้าสู่ระบบด้วย Google",
    className: "bg-surface text-ink ring-1 ring-sky hover:bg-sky/30",
    logo: (
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
    ),
  },
  line: {
    label: "เข้าสู่ระบบด้วย LINE",
    className: "bg-[#06C755] text-white hover:brightness-105",
    logo: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 3C6.5 3 2 6.6 2 11.1c0 4 3.6 7.4 8.4 8 .3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.6 1.1-.5 5.9-3.5 8-5.9C21.6 14.6 22 12.9 22 11.1 22 6.6 17.5 3 12 3z" />
      </svg>
    ),
  },
};

// หน้าเข้าสู่ระบบ / สมัครสมาชิก
export default function LoginPage() {
  const { user, loading, providers, login, register } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // ข้อผิดพลาดจากฟอร์ม หรือที่ backend ส่งกลับมาหลังล็อกอินด้วย Google/LINE ไม่สำเร็จ
  const [error, setError] = useState<string | null>(params.get("error"));

  // หน้าที่จะกลับไปหลังล็อกอิน (รับเฉพาะ path ในเว็บนี้)
  const nextParam = params.get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  if (!loading && user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(email, password);
      else await register({ first_name: firstName, last_name: lastName || undefined, email, password });
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (m: "login" | "register") => {
    setMode(m);
    setError(null);
  };

  return (
    <div className="mx-auto max-w-md">
      <PageTitle
        icon="user"
        title={mode === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
        subtitle="สำหรับล่ามและแอดมิน ส่วนการแปลภาษามือใช้ได้โดยไม่ต้องล็อกอิน"
      />

      <Card>
        {/* สลับเข้าสู่ระบบ / สมัครสมาชิก */}
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-full bg-sky/40 p-1" role="tablist">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              className={`rounded-full py-1.5 text-sm font-semibold transition ${
                mode === m ? "bg-deep text-white shadow" : "text-navy hover:bg-surface/70"
              }`}
            >
              {m === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === "register" && (
            <div className="grid grid-cols-2 gap-2">
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="ชื่อ"
                autoComplete="given-name"
                maxLength={50}
                required
                className={INPUT}
              />
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="นามสกุล (ไม่บังคับ)"
                autoComplete="family-name"
                maxLength={50}
                className={INPUT}
              />
            </div>
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="อีเมล"
            autoComplete="email"
            required
            className={INPUT}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "register" ? "รหัสผ่าน (อย่างน้อย 8 ตัว)" : "รหัสผ่าน"}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            minLength={mode === "register" ? 8 : undefined}
            maxLength={128}
            required
            className={INPUT}
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={busy}>
            {mode === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
          </Button>
        </form>

        {providers.length > 0 && (
          <>
            <div className="my-4 flex items-center gap-3 text-xs text-ink/50">
              <span className="h-px flex-1 bg-sky" />
              หรือ
              <span className="h-px flex-1 bg-sky" />
            </div>
            <div className="flex flex-col gap-2">
              {providers.map((p) => (
                <a
                  key={p}
                  href={providerLoginUrl(p, window.location.origin + next)}
                  className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition ${PROVIDERS[p].className}`}
                >
                  {PROVIDERS[p].logo}
                  {PROVIDERS[p].label}
                </a>
              ))}
            </div>
          </>
        )}

        {mode === "register" && (
          <p className="mt-4 text-xs text-ink/60">
            บัญชีใหม่จะเป็นผู้ใช้ทั่วไป แอดมินจะเปลี่ยนเป็นล่ามหรือแอดมินให้ภายหลัง
          </p>
        )}
      </Card>
    </div>
  );
}
