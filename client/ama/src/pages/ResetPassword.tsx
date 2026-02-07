import React, { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useNavigate, useSearchParams } from "react-router-dom";

const OTP_MAX_LEN = 6; // عدّلها لو طول الـ OTP عندك مختلف

const ResetPassword: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  // نجيب userId من الرابط إن وُجد
  const userId = useMemo(() => params.get("userId") || "", [params]);

  // ✅ نخزّن الكود بحالة قابلة للتعديل، ونملؤها من الرابط إن وُجد
  const [code, setCode] = useState("");

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // عند التحميل الأول: لو فيه code في الرابط نعبّيه كبداية، لكن يبقى قابل للتعديل
  useEffect(() => {
    const qp = params.get("code");
    if (qp) {
      setCode(qp);
    }
  }, [params]);

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // تنظيف الإدخال: إزالة الفراغات، قبول أرقام فقط (لو OTP رقمي)، وتحديد الطول
    const raw = e.target.value || "";
    const cleaned = raw.replace(/\s+/g, ""); // يشيل المسافات
    // إن كان الـ OTP عندك حروف+أرقام، احذف السطر التالي واستبدله بتنظيف أخف
    const digitsOnly = cleaned.replace(/\D+/g, "");
    setCode(digitsOnly.slice(0, OTP_MAX_LEN));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setOkMsg("");

    if (!userId) return setError("المعرف مفقود، أعد المحاولة من البداية.");
    if (!code) return setError("فضلاً أدخل رمز التحقق (OTP).");
    if (password.length < 6)
      return setError("كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف.");
    if (password !== password2) return setError("تأكيد كلمة المرور غير مطابق.");

    try {
      setLoading(true);
      await api.post("/auth/password/reset", {
        userId,
        code,
        newPassword: password,
      });

      setOkMsg("تم تحديث كلمة المرور بنجاح! سيتم تحويلك لتسجيل الدخول.");
      setTimeout(() => navigate("/login"), 1200);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "فشل تحديث كلمة المرور";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <main className="container max-w-xl mx-auto py-10">
        <h1 className="text-2xl font-bold mb-6 text-center">
          تعيين كلمة مرور جديدة
        </h1>

        {error && (
          <div className="mb-4 p-3 rounded bg-red-100 text-red-700">
            {error}
          </div>
        )}
        {okMsg && (
          <div className="mb-4 p-3 rounded bg-green-100 text-green-700">
            {okMsg}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block mb-1">رمز التحقق (OTP)</label>
            <Input
              value={code}
              onChange={handleCodeChange}
              placeholder="الكود من رسالة SMS"
              // تحسينات للهواتف وتعبئة تلقائية
              inputMode="numeric"
              autoComplete="one-time-code"
              // لو OTP عندك قد يحتوي أحرف، احذف pattern/ inputMode
              pattern="\d*"
              required
            />
            <p className="text-xs text-muted-foreground mt-1">
              أدخل الكود المرسل إلى جوالك. لو تعذّر لصق الكود، اكتب الأرقام
              يدوياً.
            </p>
          </div>

          <div>
            <label className="block mb-1">كلمة المرور الجديدة</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <div>
            <label className="block mb-1">تأكيد كلمة المرور الجديدة</label>
            <Input
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <div className="text-left">
            <Button type="submit" disabled={loading}>
              {loading ? "جارٍ التحديث..." : "تحديث كلمة المرور"}
            </Button>
          </div>
        </form>
      </main>
      <Footer />
    </>
  );
};

export default ResetPassword;
