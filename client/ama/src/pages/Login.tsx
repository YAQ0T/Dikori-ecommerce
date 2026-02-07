import React, { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const normalizePhone = (value: string) => value.replace(/\D+/g, "");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);

    try {
      await login({
        phone: normalizePhone(phone),
        password,
      });

      // لو نجح يسجّل دخول ويرجعنا
      navigate("/account");
    } catch (err: any) {
      // ✅ نتعامل مع الكائن الذي يرميه الـ AuthContext عند 403
      if (err?.code === "NEEDS_VERIFICATION") {
        const userId = err?.userId;

        // حفظ userId مؤقتًا لتسهيل تجربة التوثيق
        if (userId) {
          sessionStorage.setItem("pendingUserId", String(userId));
          // محاولـة تأكيد إرسال الرمز (في حال كنت على نسخة سيرفر قديمة)
          try {
            await api.post("/auth/send-sms-code", { userId });
          } catch {
            /* تجاهل - مجرد تعزيز للتجربة */
          }
        }

        setInfo(
          err?.message ||
            "يجب توثيق رقم جوالك قبل تسجيل الدخول. سيتم تحويلك لصفحة التحقق الآن."
        );

        setTimeout(() => {
          if (userId) {
            navigate(`/verify?userId=${encodeURIComponent(userId)}`);
          } else {
            navigate(`/verify`);
          }
        }, 600);
      } else {
        const msg =
          err?.response?.data?.message ||
          err?.response?.data?.error ||
          err?.message ||
          "فشل تسجيل الدخول";
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <main className="container mx-auto p-4 max-w-xl">
        <h1 className="text-2xl font-bold mb-4">تسجيل الدخول</h1>

        {info && (
          <div className="p-3 mb-3 rounded bg-blue-50 text-blue-700">
            {info}
          </div>
        )}
        {error && (
          <div className="p-3 mb-3 rounded bg-red-50 text-red-700">{error}</div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block mb-1">
              رقم الجوال
            </label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="أدخل رقم جوالك"
              required
            />
          </div>

          <div>
            <label className="block mb-1">كلمة المرور</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={loading} className="min-w-32">
              {loading ? "جاري الدخول..." : "دخول"}
            </Button>
            <Button
              variant="link"
              type="button"
              onClick={() => navigate("/forgot-password")}
            >
              نسيت كلمة المرور؟
            </Button>
          </div>
        </form>
      </main>
      <Footer />
    </>
  );
};

export default Login;
