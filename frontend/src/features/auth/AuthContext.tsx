import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as api from "./services/authApi";
import type { AuthUser, Provider, RegisterInput } from "./services/authApi";

// ค่าที่แชร์ทั้งแอป: ผู้ใช้ปัจจุบัน และคำสั่งล็อกอิน/ออก
interface AuthState {
  user: AuthUser | null;
  // true ระหว่างเช็กว่าล็อกอินอยู่หรือไม่ตอนเปิดเว็บ
  loading: boolean;
  providers: Provider[];
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

// ครอบแอปเพื่อให้ทุกหน้ารู้ว่าใครล็อกอินอยู่ (session เก็บใน cookie ฝั่ง backend)
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);

  // เช็ก session ตอนเปิดเว็บ และแจ้งผลการผูกบัญชีที่ backend ส่งกลับมาทาง URL
  useEffect(() => {
    const url = new URL(window.location.href);
    const linked = url.searchParams.get("auth_linked") as Provider | null;
    const error = url.searchParams.get("auth_error");
    if (linked || error) {
      url.searchParams.delete("auth_linked");
      url.searchParams.delete("auth_error");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      window.alert(error ?? `ผูกบัญชี ${api.PROVIDER_NAMES[linked!] ?? linked} แล้ว ครั้งหน้าล็อกอินด้วยบัญชีนี้ได้เลย`);
    }

    api
      .getMe()
      .then((r) => {
        setUser(r.user);
        setProviders(r.providers);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setUser(await api.login(email, password));
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    setUser(await api.register(input));
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, providers, login, register, logout }),
    [user, loading, providers, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ใช้ข้อมูลล็อกอินในคอมโพเนนต์
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth ต้องใช้ภายใน AuthProvider");
  return ctx;
}
