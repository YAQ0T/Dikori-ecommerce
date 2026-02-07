import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, setApiToken } from "@/lib/api";

type TUser = {
  _id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role: string;
  phoneVerified?: boolean;
};

type LoginPayload = { phone?: string; email?: string; password: string };

type AuthContextType = {
  user: TUser | null;
  token: string | null;
  loading: boolean;
  login: (data: LoginPayload) => Promise<void>;
  logout: () => void;
  setSession: (token: string, user: TUser) => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<TUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // تحميل الجلسة من التخزين
  useEffect(() => {
    const t = localStorage.getItem("token");
    const u = localStorage.getItem("user");
    if (t && u) {
      setToken(t);
      try {
        const parsed: TUser = JSON.parse(u);
        setUser(parsed);
      } catch {
        localStorage.removeItem("user");
      }
      setApiToken(t);
    } else {
      setApiToken(null);
    }
    setLoading(false);
  }, []);

  const setSession = useCallback((t: string, u: TUser) => {
    setToken(t);
    setUser(u);
    localStorage.setItem("token", t);
    localStorage.setItem("user", JSON.stringify(u));
    setApiToken(t);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setApiToken(null);
  }, []);

  const login = useCallback(
    async (data: LoginPayload) => {
      try {
        const res = await api.post(
          "/auth/login",
          {
            phone: data.phone?.trim() || undefined,
            email: data.email?.trim().toLowerCase() || undefined,
            password: data.password,
          },
          { headers: { "Content-Type": "application/json" } }
        );

        const { token: t, user: u } = res.data || {};
        if (t && u) {
          setSession(t, u);
          return;
        }
        // استجابة غير متوقعة
        throw { code: "LOGIN_ERROR", message: "استجابة غير متوقعة من الخادم" };
      } catch (err: any) {
        const status = err?.response?.status;
        const payload = err?.response?.data || {};
        const message =
          payload?.message ||
          payload?.error ||
          err?.message ||
          "فشل تسجيل الدخول";

        // ✅ حالة 403: الهاتف غير موثّق — نرمي كائن بسيط يمكن للصفحات التقاطه
        if (status === 403) {
          throw {
            code: "NEEDS_VERIFICATION",
            userId: payload?.userId,
            phone: payload?.phone,
            message,
          };
        }

        // أخطاء أخرى نرميها بشكل موحّد
        throw { code: "LOGIN_ERROR", message };
      }
    },
    [setSession]
  );

  const value = useMemo(
    () => ({ user, token, loading, login, logout, setSession }),
    [user, token, loading, login, logout, setSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
