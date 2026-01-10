import React, { useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import axios from "axios";
import { useNavigate } from "react-router-dom";

/** ✅ قاعدة API موحّدة */
const RAW_BASE = (
  import.meta.env.VITE_API_BASE?.toString() ||
  import.meta.env.VITE_API_URL?.toString() ||
  "http://localhost:3001"
).replace(/\/+$/, "");
const API_BASE = `${RAW_BASE}/api`;

function normalizePhone(p: string) {
  if (!p) return "";
  let s = p.trim().replace(/\s+/g, "");
  // إزالة أي رموز غير الأرقام و+
  s = s.replace(/[^\d+]/g, "");
  // إزالة أصفار البداية لو ما في +
  if (!s.startsWith("+")) s = s.replace(/^0+/, "");
  // إن ما بدأ بـ + أضف +970
  if (!s.startsWith("+")) s = "+970" + s;
  return s;
}

type Phase = "request" | "reset";

const ForgotPassword: React.FC = () => {
  const navigate = useNavigate();

  // ====== المرحلة 1: طلب إرسال الرمز ======
  const [phase, setPhase] = useState<Phase>("request");
  const [phone, setPhone] = useState("");
  const [reqLoading, setReqLoading] = useState(false);
  const [reqError, setReqError] = useState("");
  const [reqInfo, setReqInfo] = useState("");

  // ====== المرحلة 2: إدخال الرمز وكلمة المرور الجديدة ======
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetInfo, setResetInfo] = useState("");

  const normalizedPhone = useMemo(() => normalizePhone(phone), [phone]);
  const canRequest = useMemo(
    () => normalizedPhone.trim().length > 0,
    [normalizedPhone]
  );

  const canReset = useMemo(() => {
    return (
      code.trim().length > 0 && password.length >= 6 && password === confirm
    );
  }, [code, password, confirm]);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setReqError("");
    setReqInfo("");

    if (!canRequest) {
      setReqError("الرجاء إدخال رقم الجوال.");
      return;
    }

    try {
      setReqLoading(true);

      const sanitized = normalizedPhone;
      const payload = { phone: sanitized };

      const res = await axios.post(
        `${API_BASE}/auth/password/request-reset`,
        payload,
        { headers: { "Content-Type": "application/json" } }
      );

      const msg =
        res?.data?.message ||
        "إن كان الحساب موجودًا سنرسل لك رمز الاستعادة (صالح 10 دقائق).";
      setReqInfo(msg);

      // ننقل مباشرة للمرحلة الثانية
      setPhase("reset");
      sessionStorage.setItem("pwreset_phone", sanitized);
      setPhone(sanitized);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "تعذر إرسال رمز الاستعادة.";
      setReqError(msg);
    } finally {
      setReqLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError("");
    setResetInfo("");

    if (!canReset) {
      setResetError(
        !code
          ? "الرجاء إدخال رمز الاستعادة."
          : password.length < 6
          ? "كلمة المرور يجب أن تكون 6 أحرف على الأقل."
          : "تأكيد كلمة المرور غير مطابق."
      );
      return;
    }

    if (!normalizedPhone) {
      setResetError(
        "رقم الجوال مفقود. عد للخطوة الأولى وأعد إرسال رمز الاستعادة."
      );
      return;
    }

    try {
      setResetLoading(true);

      // نرسل دائمًا token و password (المعرّف ليس مطلوبًا حاليًا)
      const body: any = {
        token: code.trim(),
        password,
        phone: normalizedPhone,
      };

      const res = await axios.post(`${API_BASE}/auth/password/reset`, body, {
        headers: { "Content-Type": "application/json" },
      });

      const okMsg =
        res?.data?.message ||
        "تم تحديث كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.";
      setResetInfo(okMsg);

      // تنظيف القيم المؤقتة والتوجيه لتسجيل الدخول
      sessionStorage.removeItem("pwreset_phone");
      setTimeout(() => navigate("/login"), 900);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "تعذر تحديث كلمة المرور. تأكد من صحة الرمز وعدم انتهاء صلاحيته.";
      setResetError(msg);
    } finally {
      setResetLoading(false);
    }
  };

  const resend = async () => {
    // إعادة طلب الإرسال تستخدم نفس Endpoint الخاص بالاستعادة
    setReqError("");
    setReqInfo("");

    if (!canRequest) {
      setReqError("رقم الجوال مفقود. الرجاء العودة للخطوة الأولى وإدخاله.");
      setPhase("request");
      return;
    }

    try {
      setReqLoading(true);
      const sanitized = normalizedPhone;
      const body = { phone: sanitized };

      const res = await axios.post(
        `${API_BASE}/auth/password/request-reset`,
        body,
        { headers: { "Content-Type": "application/json" } }
      );

      const msg =
        res?.data?.message ||
        "إن كان الحساب موجودًا سنرسل لك رمز الاستعادة (صالح 10 دقائق).";
      setReqInfo(msg);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "تعذر إعادة إرسال الرمز.";
      setReqError(msg);
    } finally {
      setReqLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <main className="container mx-auto p-4 max-w-xl">
        <h1 className="text-2xl font-bold mb-2">استعادة كلمة المرور</h1>
        <p className="text-sm text-muted-foreground mb-4">
          أدخل رقم جوالك لتصلك رسالة قصيرة (SMS) تحوي رمز الاستعادة، ثم قم
          بتعيين كلمة مرور جديدة.
        </p>

        {/* رسائل عامة للمرحلة الأولى */}
        {phase === "request" && reqInfo && (
          <div className="p-3 mb-3 rounded bg-blue-50 text-blue-700">
            {reqInfo}
          </div>
        )}
        {phase === "request" && reqError && (
          <div className="p-3 mb-3 rounded bg-red-50 text-red-700">
            {reqError}
          </div>
        )}

        {/* رسائل المرحلة الثانية */}
        {phase === "reset" && resetInfo && (
          <div className="p-3 mb-3 rounded bg-green-50 text-green-700">
            {resetInfo}
          </div>
        )}
        {phase === "reset" && resetError && (
          <div className="p-3 mb-3 rounded bg-red-50 text-red-700">
            {resetError}
          </div>
        )}

        {/* ====== المرحلة 1: طلب الإرسال ====== */}
        {phase === "request" && (
          <form onSubmit={handleRequest} className="space-y-4">
            <div>
              <label className="block mb-1">رقم الجوال</label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="مثال: 059XXXXXXX"
                required
              />
            </div>

            <div className="flex items-center gap-3">
              <Button
                type="submit"
                className="min-w-32"
                disabled={reqLoading || !canRequest}
              >
                {reqLoading ? "جاري الإرسال..." : "أرسل الرمز"}
              </Button>
              <Button
                type="button"
                variant="link"
                onClick={() => navigate("/login")}
              >
                العودة لتسجيل الدخول
              </Button>
            </div>
          </form>
        )}

        {/* ====== المرحلة 2: إدخال الرمز وتعيين كلمة جديدة ====== */}
        {phase === "reset" && (
          <form onSubmit={handleReset} className="space-y-4">
            <div>
              <label className="block mb-1">تم إرسال الرمز إلى</label>
              <Input value={normalizedPhone} disabled />
              <p className="text-xs text-muted-foreground mt-1">
                لم يصلك الرمز؟{" "}
                <button
                  type="button"
                  onClick={resend}
                  className="text-blue-600 hover:underline disabled:opacity-50"
                  disabled={reqLoading}
                >
                  إعادة الإرسال
                </button>
              </p>
              {reqInfo && (
                <div className="p-2 mt-2 rounded bg-blue-50 text-blue-700">
                  {reqInfo}
                </div>
              )}
              {reqError && (
                <div className="p-2 mt-2 rounded bg-red-50 text-red-700">
                  {reqError}
                </div>
              )}
            </div>

            <div>
              <label className="block mb-1">رمز الاستعادة (OTP)</label>
              <Input
                inputMode="numeric"
                pattern="[0-9]*"
                value={code}
                onChange={(e) =>
                  setCode(
                    (e.target.value || "").replace(/\D+/g, "").slice(0, 6)
                  )
                }
                placeholder="6 أرقام"
                maxLength={6}
                required
              />
            </div>

            <div>
              <label className="block mb-1">كلمة المرور الجديدة</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                يجب أن تكون 6 أحرف على الأقل.
              </p>
            </div>

            <div>
              <label className="block mb-1">تأكيد كلمة المرور الجديدة</label>
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="أعد كتابة كلمة المرور"
                required
              />
            </div>

            <div className="flex items-center gap-3">
              <Button
                type="submit"
                className="min-w-32"
                disabled={resetLoading || !canReset}
              >
                {resetLoading ? "جاري التعيين..." : "تعيين كلمة المرور"}
              </Button>
              <Button
                type="button"
                variant="link"
                onClick={() => navigate("/login")}
              >
                العودة لتسجيل الدخول
              </Button>
            </div>
          </form>
        )}
      </main>
      <Footer />
    </>
  );
};

export default ForgotPassword;
