// client/ama/src/pages/Cart.tsx
import React, { useState, useEffect, useMemo } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { getLocalizedText } from "@/lib/localized";
import { useLanguage } from "@/context/LanguageContext";
import QuantityInput from "@/components/common/QuantityInput";
import { useNavigate } from "react-router-dom";

// reCAPTCHA v3
import {
  GoogleReCaptchaProvider,
  useGoogleReCaptcha,
} from "react-google-recaptcha-v3";

type DiscountPreview = {
  items: Array<{
    productId: string;
    variantId: string;
    name: string;
    quantity: number;
    price: number;
    color?: string | null;
    measure?: string | null;
    sku?: string | null;
  }>;
  subtotal: number;
  discount: {
    applied: boolean;
    ruleId: string | null;
    type: "percent" | "fixed" | null;
    value: number;
    amount: number;
    threshold: number;
    name: string;
  };
  total: number;
};

const currency = (n: number) => `₪${Number(n || 0).toFixed(2)}`;

function normalizeMobile(input: string) {
  const s = String(input || "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("00")) return `+${s.slice(2)}`;
  if (s.startsWith("0")) return `+970${s.slice(1)}`;
  return s;
}

// مفاتيح v3
const RECAPTCHA_SITE_KEY = "6LcENrsrAAAAALomNaP-d0iFoJIIglAqX2uWfMWH";
const RECAPTCHA_ACTION = "checkout";
const RECAPTCHA_MIN_SCORE = 0.5;

// ---------------------------
//  محتوى الصفحة الحقيقي
// ---------------------------
const CartPageContent: React.FC = () => {
  const navigate = useNavigate();
  const { cart, removeFromCart, updateQuantity, clearCart } = useCart();
  const { user, token } = useAuth();
  const { locale } = useLanguage();

  const [userData, setUserData] = useState({
    name: "",
    phone: "",
    address: "",
    email: "",
  });
  const [paymentMethod, setPaymentMethod] = useState<"card" | "cod">("card");
  const [notes, setNotes] = useState("");

  const [preview, setPreview] = useState<DiscountPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // v3 hook
  const { executeRecaptcha } = useGoogleReCaptcha();

  // Checkbox السياسات
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setUserData((prev) => ({
        ...prev,
        name: (user as any).name || "",
        phone: (user as any).phone || "",
        email: (user as any).email || "",
      }));
    }
  }, [user]);

  const localSubtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart]
  );
  const localTotal = useMemo(() => localSubtotal, [localSubtotal]);

  useEffect(() => {
    const applyDiscountPreview = async () => {
      if (cart.length === 0) {
        setPreview(null);
        return;
      }
      try {
        setLoadingPreview(true);
        const payload = {
          items: cart.map((item) => ({
            productId: item._id,
            quantity: item.quantity,
            sku: (item as any).sku || undefined,
            color: (item as any).selectedColor || null,
            measure: (item as any).selectedMeasure || null,
            name: getLocalizedText(item.name, locale),
          })),
        };
        const headers = token
          ? { Authorization: `Bearer ${token}` }
          : undefined;
        const res = await api.post("/discounts/apply", payload, { headers });
        setPreview(res.data as DiscountPreview);
      } catch (err) {
        console.error("فشل في معاينة الخصم:", err);
        setPreview(null);
      } finally {
        setLoadingPreview(false);
      }
    };
    applyDiscountPreview();
  }, [cart, token, locale]);

  const summary = useMemo(() => {
    if (preview) {
      return {
        subtotal: preview.subtotal,
        discountAmount:
          preview.discount?.applied && preview.discount?.amount > 0
            ? preview.discount.amount
            : 0,
        total: preview.total,
        discountLabel:
          preview.discount?.applied && preview.discount?.amount > 0
            ? preview.discount?.type === "percent"
              ? `${preview.discount.value}%${
                  preview.discount.name ? ` - ${preview.discount.name}` : ""
                }`
              : `₪${preview.discount.value}${
                  preview.discount.name ? ` - ${preview.discount.name}` : ""
                }`
            : null,
        threshold: preview.discount?.threshold || 0,
      };
    }
    return {
      subtotal: localSubtotal,
      discountAmount: 0,
      total: localTotal,
      discountLabel: null as string | null,
      threshold: 0,
    };
  }, [preview, localSubtotal, localTotal]);

  // طلب توكن v3 لإرساله مع الطلبات (التحقق يتم في الخادم)
  const getRecaptchaToken = async () => {
    if (!executeRecaptcha) {
      throw new Error("reCAPTCHA not ready");
    }
    return executeRecaptcha(RECAPTCHA_ACTION);
  };

  const handleCreateCOD = async () => {
    // الدفع عند التوصيل: يتطلب حساب
    if (!user) {
      setPolicyError("الدفع عند التوصيل يتطلب تسجيل الدخول.");
      return;
    }
    if (!userData.address.trim()) return alert("الرجاء تعبئة العنوان");
    if (cart.length === 0) return alert("السلة فارغة");

    // تأكد من قبول السياسات
    setPolicyError(null);
    if (!acceptedPolicies) {
      setPolicyError("يجب الموافقة على سياسة الإرجاع/التبديل والخصوصية.");
      return;
    }

    try {
      const recaptchaToken = await getRecaptchaToken();

      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      await api.post(
        "/orders",
        {
          recaptchaToken,
          recaptchaAction: RECAPTCHA_ACTION,
          recaptchaMinScore: RECAPTCHA_MIN_SCORE,

          address: userData.address,
          paymentMethod: "cod",
          paymentStatus: "unpaid",
          status: "waiting_confirmation",
          notes,
          items: cart.map((it) => ({
            productId: it._id,
            name: getLocalizedText(it.name, locale),
            quantity: it.quantity,
            sku: (it as any).sku || undefined,
            color: (it as any).selectedColor || null,
            measure: (it as any).selectedMeasure || null,
          })),
        },
        { headers }
      );

      clearCart();
      navigate("/checkout/success?method=cod");
    } catch (e: any) {
      console.error(e);
      alert(e?.response?.data?.message || "تعذر إنشاء طلب الدفع عند التوصيل");
    }
  };

  /** الدفع بالبطاقة (Card) متاح للزوار أيضًا */
  const handlePayCardRedirect = async () => {
    // السماح للزوار: لا نتحقق من وجود user
    if (!userData.address.trim())
      return alert("الرجاء تعبئة العنوان قبل الدفع.");
    if (!userData.phone.trim())
      return alert("الرجاء إدخال رقم الهاتف للتواصل.");
    if (cart.length === 0) return alert("سلة الشراء فارغة");

    // تأكد من قبول السياسات
    setPolicyError(null);
    if (!acceptedPolicies) {
      setPolicyError("يجب الموافقة على سياسة الإرجاع/التبديل والخصوصية.");
      return;
    }

    try {
      const recaptchaToken = await getRecaptchaToken();

      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

      // 1) إنشاء طلب مبدئي (pending/unpaid)
      const prep = await api.post(
        "/orders/prepare-card",
        {
          recaptchaToken,
          recaptchaAction: RECAPTCHA_ACTION,
          recaptchaMinScore: RECAPTCHA_MIN_SCORE,

          address: userData.address,
          notes,
          // في حال الزائر، نرسل guestInfo ليستخدمه السيرفر (اختياري/غير كسّار)
          guestInfo: !user
            ? {
                name: userData.name || undefined,
                phone: userData.phone || undefined,
                email: userData.email || undefined,
                address: userData.address || undefined,
              }
            : undefined,
          items: cart.map((it) => ({
            productId: it._id,
            name: getLocalizedText(it.name, locale),
            quantity: it.quantity,
            sku: (it as any).sku || undefined,
            color: (it as any).selectedColor || null,
            measure: (it as any).selectedMeasure || null,
          })),
        },
        { headers }
      );

      const orderId = prep?.data?._id;
      if (!orderId) throw new Error("فشل تحضير الطلب");

      // 2) تهيئة دفع لَهْزة + ربط المرجع بالطلب
      const amountMinor = Math.round(Number(summary.total || 0) * 100);
      const callback_url = `${window.location.origin}/checkout/success`;

      const mobile = normalizeMobile(
        userData.phone || (user as any)?.phone || ""
      );
      const resp = await api.post(
        "/payments/create",
        {
          orderId,
          amountMinor,
          currency: "ILS",
          email: (user as any)?.email || userData.email || undefined,
          name: userData.name || (user as any)?.name || undefined,
          mobile,
          metadata: {
            orderId,
            cartCount: cart.length,
            subtotal: summary.subtotal,
            discount: summary.discountAmount,
            finalTotal: summary.total,
            address: userData.address || "",
            // إشارة أن العملية تمت كضيف (للاستخدام التحليلي/الدعائي)
            guestCheckout: !user,
          },
          callback_url,
        },
        { headers }
      );

      const { authorization_url } = resp.data;
      if (!authorization_url) {
        alert("تعذر الحصول على رابط الدفع من السيرفر");
        return;
      }

      // 3) الانتقال لبوابة الدفع
      window.location.href = authorization_url;
    } catch (e: any) {
      console.error(e);
      alert(
        e?.response?.data?.error ||
          e?.response?.data?.message ||
          "تعذر إنشاء معاملة الدفع"
      );
    }
  };

  const isGuest = !user;

  return (
    <>
      <Navbar />
      <main className="container mx-auto p-6 text-right">
        <h1 className="text-3xl font-bold mb-6">سلة المشتريات</h1>

        {/* بيانات العميل */}
        <div className="grid md:grid-cols-4 gap-4 my-6">
          <input
            className="border p-2 rounded"
            placeholder="اسمك"
            value={userData.name}
            readOnly={!!user}
            onChange={(e) => setUserData({ ...userData, name: e.target.value })}
          />
          <input
            className="border p-2 rounded"
            placeholder="رقم الهاتف"
            value={userData.phone}
            readOnly={!!user}
            onChange={(e) =>
              setUserData({ ...userData, phone: e.target.value })
            }
          />
          {/* بريد إلكتروني يظهر للزائرين فقط (مفيد لإيصالات الدفع) */}
          {!user && (
            <input
              className="border p-2 rounded"
              type="email"
              placeholder="البريد الإلكتروني (اختياري للإيصال)"
              value={userData.email}
              onChange={(e) =>
                setUserData({ ...userData, email: e.target.value })
              }
            />
          )}
          <input
            className="border p-2 rounded"
            placeholder="العنوان"
            value={userData.address}
            onChange={(e) =>
              setUserData({ ...userData, address: e.target.value })
            }
          />
        </div>

        {/* ملاحظات */}
        <textarea
          className="border p-2 rounded w-full mb-4"
          placeholder="ملاحظات إضافية (اختياري)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {/* 💻 لسطح المكتب: جدول العناصر */}
        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full border text-right">
            <thead className="bg-gray-100 dark:bg-black dark:text-white">
              <tr>
                <th className="py-2 px-4 border">المنتج</th>
                <th className="py-2 px-4 border">اللون</th>
                <th className="py-2 px-4 border">المقاس</th>
                <th className="py-2 px-4 border">السعر</th>
                <th className="py-2 px-4 border">الكمية</th>
                <th className="py-2 px-4 border">الإجمالي الفرعي</th>
                <th className="py-2 px-4 border">إزالة</th>
              </tr>
            </thead>
            <tbody>
              {cart.map((item) => {
                const displayName =
                  getLocalizedText(item.name, locale) || item._id;
                return (
                  <tr
                    key={`${item._id}-${(item as any).selectedColor}-${
                      (item as any).selectedMeasure
                    }`}
                  >
                    <td className="py-2 px-4 border">{displayName}</td>
                  <td className="py-2 px-4 border">
                    {(item as any).selectedColor || "-"}
                  </td>
                  <td className="py-2 px-4 border">
                    {(item as any).selectedMeasure || "-"}
                  </td>
                  <td className="py-2 px-4 border">{currency(item.price)}</td>
                  <td className="py-2 px-4 border">
                    <div className="flex items-center gap-2">
                      <button
                        className="px-2 py-1 border rounded"
                        onClick={() =>
                          updateQuantity(
                            item._id,
                            item.quantity - 1,
                            (item as any).selectedColor,
                            (item as any).selectedMeasure
                          )
                        }
                        disabled={item.quantity <= 1}
                      >
                        -
                      </button>

                      <QuantityInput
                        quantity={item.quantity}
                        onChange={(newQty) =>
                          updateQuantity(
                            item._id,
                            newQty,
                            (item as any).selectedColor,
                            (item as any).selectedMeasure
                          )
                        }
                      />

                      <button
                        className="px-2 py-1 border rounded"
                        onClick={() =>
                          updateQuantity(
                            item._id,
                            item.quantity + 1,
                            (item as any).selectedColor,
                            (item as any).selectedMeasure
                          )
                        }
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="py-2 px-4 border">
                    {currency(item.price * item.quantity)}
                  </td>
                  <td className="py-2 px-4 border">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        removeFromCart(
                          item._id,
                          (item as any).selectedColor,
                          (item as any).selectedMeasure
                        )
                      }
                    >
                      إزالة
                    </Button>
                  </td>
                </tr>
              );
              })}
              {cart.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-gray-500">
                    السلة فارغة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 📱 للموبايل: كروت العناصر */}
        <div className="grid gap-4 md:hidden">
          {cart.map((item) => {
            const displayName =
              getLocalizedText(item.name, locale) || item._id;
            return (
              <div
                key={`${item._id}-${(item as any).selectedColor}-${
                  (item as any).selectedMeasure
                }`}
                className="border rounded-lg p-4 text-right"
              >
                <h3 className="text-lg font-semibold mb-1">{displayName}</h3>
                <p className="text-sm text-gray-500">
                  اللون: {(item as any).selectedColor || "-"} | المقاس:{" "}
                  {(item as any).selectedMeasure || "-"}
                </p>
                <p className="text-gray-600 mb-1">
                  السعر: {currency(item.price)}
                </p>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-gray-600">الكمية:</span>
                  <QuantityInput
                    quantity={item.quantity}
                    onChange={(newQty) =>
                      updateQuantity(
                        item._id,
                        newQty,
                        (item as any).selectedColor,
                        (item as any).selectedMeasure
                      )
                    }
                  />
                </div>
                <p className="text-gray-700 font-semibold mb-3">
                  الإجمالي: {currency(item.price * item.quantity)}
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() =>
                    removeFromCart(
                      item._id,
                      (item as any).selectedColor,
                      (item as any).selectedMeasure
                    )
                  }
                >
                  إزالة
                </Button>
              </div>
            );
          })}
          {cart.length === 0 && (
            <p className="text-center text-gray-500">السلة فارغة.</p>
          )}
        </div>

        {/* الملخص + اختيار طريقة الدفع */}
        <div className="mt-6 grid gap-4">
          <div className="space-y-1">
            <p className="text-base">
              المجموع الفرعي:{" "}
              <span className="font-medium">{currency(summary.subtotal)}</span>
            </p>
            {loadingPreview ? (
              <p className="text-sm text-muted-foreground">
                جارٍ احتساب الخصم…
              </p>
            ) : (
              summary.discountAmount > 0 && (
                <>
                  <p className="text-base text-green-700">
                    الخصم
                    {summary.discountLabel ? ` (${summary.discountLabel})` : ""}
                    :{" "}
                    <span className="font-medium">
                      -{currency(summary.discountAmount)}
                    </span>
                  </p>
                  {summary.threshold > 0 && (
                    <p className="text-xs text-muted-foreground">
                      تم تطبيق شريحة عند ≥ {currency(summary.threshold)}
                    </p>
                  )}
                </>
              )
            )}
            <p className="text-xl font-bold border-t pt-2">
              الإجمالي: <span>{currency(summary.total)}</span>
            </p>
          </div>

          {/* اختيار طريقة الدفع */}
          <div className="border rounded p-4 space-y-3">
            <h3 className="font-semibold">طريقة الدفع</h3>

            {/* الدفع بالبطاقة: متاح للجميع (زوار + مسجلين) */}
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="pay"
                checked={paymentMethod === "card"}
                onChange={() => setPaymentMethod("card")}
              />
              <div>
                <div className="font-medium">
                  💳 الدفع بالبطاقة (فيزا/ماستر)
                </div>
                <div className="text-sm text-green-700">
                  متاح للزوار بدون إنشاء حساب — الأسرع لمعالجة الطلب.
                </div>
              </div>
            </label>

            {/* الدفع عند التوصيل: يظهر لكنه معطّل للزوار */}
            <label
              className={`flex items-start gap-2 ${
                isGuest ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
              }`}
            >
              <input
                type="radio"
                name="pay"
                disabled={isGuest}
                checked={paymentMethod === "cod"}
                onChange={() => setPaymentMethod("cod")}
              />
              <div>
                <div className="font-medium">🚚 الدفع عند التوصيل (COD)</div>
                <div className="text-sm text-amber-700">
                  {isGuest ? (
                    <>
                      هذا الخيار متاح فقط للمستخدمين المسجّلين.{" "}
                      <a
                        href="/login"
                        className="underline text-blue-600"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        سجّل الدخول
                      </a>{" "}
                      أو{" "}
                      <a
                        href="/register"
                        className="underline text-blue-600"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        أنشئ حسابًا
                      </a>{" "}
                      لتفعيله.
                    </>
                  ) : (
                    <>
                      قد يتم <strong>إجراءات إضافية</strong> للتحقق (تأكيد
                      هاتفي/عربون).
                    </>
                  )}
                </div>
              </div>
            </label>
          </div>

          {/* Checkbox السياسات */}
          <div className="border rounded p-4 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={acceptedPolicies}
                onChange={(e) => {
                  setAcceptedPolicies(e.target.checked);
                  setPolicyError(null);
                }}
              />
              <span className="text-sm">
                أُقرّ بأنني قرأت وأوافق على{" "}
                <a
                  href="/returnes"
                  className="text-blue-600 underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  سياسة الإرجاع والتبديل
                </a>{" "}
                و{" "}
                <a
                  href="/privacy-policy"
                  className="text-blue-600 underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  سياسة الخصوصية
                </a>
                .
              </span>
            </label>
            {policyError && (
              <p className="text-red-600 text-sm">{policyError}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {paymentMethod === "card" ? (
              <Button
                onClick={handlePayCardRedirect}
                disabled={cart.length === 0}
              >
                ادفع الآن بالبطاقة
              </Button>
            ) : (
              <Button
                onClick={handleCreateCOD}
                variant="outline"
                disabled={cart.length === 0 || isGuest}
                title={
                  isGuest ? "سجّل الدخول لتفعيل الدفع عند التوصيل" : undefined
                }
              >
                إنشاء طلب دفع عند التوصيل
              </Button>
            )}

            {/* تلميحات للزائر */}
            {isGuest && (
              <p className="text-xs text-muted-foreground">
                تذكير: يمكنك إتمام الطلب كـ <strong>ضيف</strong> باستخدام الدفع
                بالبطاقة. لإتاحة الدفع عند التوصيل، يرجى تسجيل الدخول أو إنشاء
                حساب.
              </p>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
};

// ---------------------------
//  مُغلِّف بمُزوِّد v3 (بدون container)
// ---------------------------
const Cart: React.FC = () => {
  return (
    <GoogleReCaptchaProvider
      reCaptchaKey={RECAPTCHA_SITE_KEY}
      scriptProps={{ async: true, defer: true, appendTo: "head" }}
    >
      <CartPageContent />
    </GoogleReCaptchaProvider>
  );
};

export default Cart;
