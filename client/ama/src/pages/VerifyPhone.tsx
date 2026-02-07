import React, { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

const OTP_MAX_LEN = 6;

const VerifyPhone: React.FC = () => {
  const [sp] = useSearchParams();
  const navigate = useNavigate();

  // نجلب userId من الكويري أو sessionStorage
  const fromQuery = sp.get("userId") || "";
  const fromSession = sessionStorage.getItem("pendingUserId") || "";
  const initialUserId = fromQuery || fromSession;

  const [userId, setUserId] = useState(initialUserId);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [sentInfo, setSentInfo] = useState("");

  const { setSession } = useAuth();

  const canSubmit = useMemo(
    () => userId.trim().length > 0 && code.trim().length > 0,
    [userId, code]
  );

  const onChangeCode = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value || "";
    const cleaned = raw.replace(/\s+/g, "");
    const digitsOnly = cleaned.replace(/\D+/g, "");
    setCode(digitsOnly.slice(0, OTP_MAX_LEN));
  };

  useEffect(() => {
    // لو معنا userId ولكن لا يوجد كود بعد، فلن نحاول شيء تلقائي هنا.
    // بإمكانك إضافة منطق لإعادة الإرسال تلقائيًا إن رغبت.
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setOkMsg("");

    if (!userId) return setError("معرّف المستخدم مفقود.");
    if (!code) return setError("الرجاء إدخال رمز التحقق (OTP).");

    try {
      setLoading(true);
      const res = await api.post("/auth/verify-sms", { userId, code });

      // ✅ تسجيل دخول تلقائي: السيرفر يعيد { token, user, message }
      const { token, user, message } = res.data || {};
      if (token && user) {
        setSession(token, user);
        // نظّف الـ pendingUserId بعد النجاح
        sessionStorage.removeItem("pendingUserId");
        setOkMsg(message || "تم التوثيق وتسجيل الدخول تلقائيًا.");
        setTimeout(() => {
          navigate("/account");
        }, 500);
      } else {
        setOkMsg(message || "تم التوثيق بنجاح.");
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "فشل التحقق من الرمز.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setError("");
    setSentInfo("");
    if (!userId) return setError("أدخل معرّف المستخدم لإعادة الإرسال.");

    try {
      setLoading(true);
      const res = await api.post("/auth/send-sms-code", { userId });
      const msg =
        res?.data?.message ||
        "إن كان الحساب موجودًا وسيحتاج تحقق، سيتم إرسال رمز جديد.";
      setSentInfo(msg);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "تعذر إعادة الإرسال.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <main className="container mx-auto p-4 max-w-xl">
        <h1 className="text-2xl font-bold mb-2">توثيق رقم الجوال</h1>
        <p className="text-sm text-muted-foreground mb-4">
          أدخل رمز التحقق المكوّن من 6 أرقام.
        </p>

        {error && (
          <div className="p-3 mb-3 rounded bg-red-50 text-red-700">{error}</div>
        )}
        {okMsg && (
          <div className="p-3 mb-3 rounded bg-green-50 text-green-700">
            {okMsg}
          </div>
        )}
        {sentInfo && (
          <div className="p-3 mb-3 rounded bg-blue-50 text-blue-700">
            {sentInfo}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          {!userId && (
            <div>
              <label className="block mb-1">معرّف المستخدم</label>
              <Input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="userId"
              />
            </div>
          )}

          <div>
            <label className="block mb-1">رمز التحقق</label>
            <Input
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={OTP_MAX_LEN}
              value={code}
              onChange={onChangeCode}
              placeholder="123456"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={loading || !canSubmit}>
              {loading ? "جاري التحقق..." : "تحقق"}
            </Button>

            <Button
              variant="secondary"
              onClick={resend}
              disabled={loading || !userId}
            >
              إعادة إرسال الرمز
            </Button>
          </div>
        </form>
      </main>
      <Footer />
    </>
  );
};

export default VerifyPhone;
