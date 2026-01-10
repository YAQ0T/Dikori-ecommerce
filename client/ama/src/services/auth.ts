import axios from "axios";

const RAW = import.meta.env.VITE_API_URL || "";
const BASE = RAW.replace(/\/+$/, ""); // تنظيف أي سلاش زائد في النهاية

const api = axios.create({
  baseURL: `${BASE}/api`, // ✅ كل شيء يمر عبر /api
  headers: { "Content-Type": "application/json" },
});

export type LoginDto = { email: string; password: string };
export type RegisterDto = { name: string; email: string; password: string };
export type ForgotDto = { email: string };
export type ResetDto = {
  token: string;
  password: string;
  confirmPassword?: string;
  email?: string;
  phone?: string;
};

export async function login(dto: LoginDto) {
  const { data } = await api.post("/auth/login", dto);
  return data; // { token, user, ... }
}

export async function register(dto: RegisterDto) {
  const { data } = await api.post("/auth/register", dto);
  return data;
}

export async function me(token?: string) {
  const { data } = await api.get("/auth/me", {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return data;
}

/** إرسال رابط إعادة تعيين كلمة المرور إلى البريد */
export async function forgotPassword(dto: ForgotDto) {
  // ✅ لاحظ /api في baseURL
  const { data } = await api.post("/auth/password/forgot", dto);
  return data; // { message: "..." }
}

/** تأكيد إعادة التعيين بكود/توكن */
export async function resetPassword(dto: ResetDto) {
  // ✅ لاحظ /api في baseURL
  const payload: any = { token: dto.token, password: dto.password };
  if (dto.confirmPassword != null)
    payload.confirmPassword = dto.confirmPassword;
  if (dto.email) payload.email = dto.email; // بعض السيرفرات تطلب الإيميل كذلك
  if (dto.phone) payload.phone = dto.phone; // دعم مسار إعادة التعيين عبر رقم الجوال

  const { data } = await api.post("/auth/password/reset", payload);
  return data; // { message: "..." }
}
