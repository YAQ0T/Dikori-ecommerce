// client/ama/src/pages/Cart.tsx
import React, { useState, useEffect, useMemo, useCallback } from "react";
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
const MAX_ORDER_QTY = 999999;

type VariantOption = {
  _id: string;
  product: string;
  measure: string;
  measureUnit?: string;
  measureSlug?: string;
  color?: {
    name?: string;
    images?: string[];
  };
  colorSlug?: string;
  price?: {
    amount?: number;
    compareAt?: number;
    discount?: {
      type?: "percent" | "amount";
      value?: number;
      startAt?: string;
      endAt?: string;
    };
  };
  stock?: {
    inStock?: number;
    sku?: string;
  };
  trackQuantity?: boolean;
};

type CartVariantMeta = {
  selectedVariantId?: string;
  selectedSku?: string;
  selectedColor?: string;
  selectedMeasure?: string;
  selectedMeasureUnit?: string;
  trackQuantity?: boolean;
};

const normalizeText = (value?: string) =>
  String(value || "").trim().toLowerCase();

const slugifyText = (value?: string) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

const variantMeasureKey = (variant?: VariantOption | null) =>
  normalizeText(variant?.measureSlug || slugifyText(variant?.measure));

const variantColorKey = (variant?: VariantOption | null) =>
  normalizeText(variant?.colorSlug || slugifyText(variant?.color?.name));

function normalizeVariantsResponse(data: any): VariantOption[] {
  if (Array.isArray(data?.items)) return data.items as VariantOption[];
  if (Array.isArray(data)) return data as VariantOption[];
  return [];
}

function computeVariantUnitPrice(variant?: VariantOption): number {
  if (!variant) return 0;
  const amount = Number(variant.price?.amount ?? 0);
  const discount = variant.price?.discount;
  if (!discount || !discount.value || amount <= 0) return amount;

  const now = Date.now();
  const startAt = discount.startAt ? new Date(discount.startAt).getTime() : null;
  const endAt = discount.endAt ? new Date(discount.endAt).getTime() : null;
  const inWindow =
    (startAt === null || now >= startAt) && (endAt === null || now < endAt);
  if (!inWindow) return amount;

  if (discount.type === "amount") {
    return Math.max(0, Number((amount - Number(discount.value || 0)).toFixed(2)));
  }
  if (discount.type === "percent") {
    return Math.max(
      0,
      Number((amount - (amount * Number(discount.value || 0)) / 100).toFixed(2))
    );
  }
  return amount;
}

function getVariantMaxQty(variant: VariantOption | null): number {
  if (!variant || variant.trackQuantity !== true) return MAX_ORDER_QTY;
  const stock = Math.max(0, Number(variant.stock?.inStock || 0));
  return Math.min(MAX_ORDER_QTY, stock);
}

type MeasureOption = {
  key: string;
  label: string;
};

type ColorOption = {
  key: string;
  label: string;
};

function getMeasureOptions(variants: VariantOption[]): MeasureOption[] {
  const map = new Map<string, MeasureOption>();
  for (const variant of variants) {
    const key = variantMeasureKey(variant);
    if (!key) continue;
    if (map.has(key)) continue;
    const label = variant.measureUnit
      ? `${variant.measure} ${variant.measureUnit}`
      : variant.measure || "بدون مقاس";
    map.set(key, { key, label });
  }
  return Array.from(map.values());
}

function getColorOptions(variants: VariantOption[]): ColorOption[] {
  const map = new Map<string, ColorOption>();
  for (const variant of variants) {
    const key = variantColorKey(variant);
    if (!key) continue;
    if (map.has(key)) continue;
    map.set(key, { key, label: variant.color?.name || "بدون لون" });
  }
  return Array.from(map.values());
}

function findVariantBySelections(
  variants: VariantOption[],
  currentVariant: VariantOption | null,
  {
    measureKey,
    colorKey,
  }: {
    measureKey?: string;
    colorKey?: string;
  }
): VariantOption | null {
  if (!variants.length) return null;
  const targetMeasure = normalizeText(measureKey || variantMeasureKey(currentVariant));
  const targetColor = normalizeText(colorKey || variantColorKey(currentVariant));

  if (targetMeasure && targetColor) {
    const exact = variants.find(
      (variant) =>
        variantMeasureKey(variant) === targetMeasure &&
        variantColorKey(variant) === targetColor
    );
    if (exact) return exact;
  }

  if (targetMeasure) {
    const byMeasure = variants.find(
      (variant) => variantMeasureKey(variant) === targetMeasure
    );
    if (byMeasure) return byMeasure;
  }

  if (targetColor) {
    const byColor = variants.find(
      (variant) => variantColorKey(variant) === targetColor
    );
    if (byColor) return byColor;
  }

  return currentVariant || variants[0] || null;
}

function resolveCartItemVariant(
  item: CartVariantMeta,
  variants: VariantOption[]
): VariantOption | null {
  if (!variants.length) return null;

  if (item.selectedVariantId) {
    const byId = variants.find((v) => String(v._id) === String(item.selectedVariantId));
    if (byId) return byId;
  }

  if (item.selectedSku) {
    const skuNorm = normalizeText(item.selectedSku);
    const bySku = variants.find((v) => normalizeText(v.stock?.sku) === skuNorm);
    if (bySku) return bySku;
  }

  if (item.selectedMeasure || item.selectedColor) {
    const measureNorm = normalizeText(item.selectedMeasure);
    const colorNorm = normalizeText(item.selectedColor);
    const measureSlug = slugifyText(item.selectedMeasure);
    const colorSlug = slugifyText(item.selectedColor);
    const byLabels = variants.find((v) => {
      const sameMeasure =
        !measureNorm ||
        normalizeText(v.measure) === measureNorm ||
        slugifyText(v.measure) === measureSlug ||
        normalizeText(v.measureSlug) === measureSlug;
      const sameColor =
        !colorNorm ||
        normalizeText(v.color?.name) === colorNorm ||
        slugifyText(v.color?.name) === colorSlug ||
        normalizeText(v.colorSlug) === colorSlug;
      return sameMeasure && sameColor;
    });
    if (byLabels) return byLabels;
  }

  return variants[0] || null;
}

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
  const { cart, addToCart, removeFromCart, updateQuantity, clearCart } = useCart();
  const { user, token } = useAuth();
  const { locale } = useLanguage();

  const [userData, setUserData] = useState({
    name: "",
    phone: "",
    address: "",
    email: "",
  });
  const [paymentMethod, setPaymentMethod] = useState<
    "card" | "cod" | "bank_transfer"
  >("card");
  const [notes, setNotes] = useState("");

  const [preview, setPreview] = useState<DiscountPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [variantsByProduct, setVariantsByProduct] = useState<
    Record<string, VariantOption[]>
  >({});

  // v3 hook
  const { executeRecaptcha } = useGoogleReCaptcha();

  // Checkbox السياسات
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);

  const productIdsKey = useMemo(() => {
    const ids = Array.from(new Set(cart.map((item) => String(item._id))));
    ids.sort();
    return ids.join("|");
  }, [cart]);

  useEffect(() => {
    const productIds = productIdsKey ? productIdsKey.split("|") : [];
    if (!productIds.length) {
      setVariantsByProduct({});
      return;
    }

    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        productIds.map(async (productId) => {
          try {
            const { data } = await api.get("/variants", {
              params: { product: productId, limit: 500 },
            });
            return [productId, normalizeVariantsResponse(data)] as const;
          } catch {
            return [productId, []] as const;
          }
        })
      );

      if (cancelled) return;
      setVariantsByProduct(Object.fromEntries(entries));
    })();

    return () => {
      cancelled = true;
    };
  }, [productIdsKey]);

  const changeItemVariant = useCallback(
    (
      item: {
        _id: string;
        name: any;
        price: number;
        image: string;
        quantity: number;
      } & CartVariantMeta,
      nextVariantId: string
    ) => {
      const variants = variantsByProduct[item._id] || [];
      const nextVariant = variants.find((v) => String(v._id) === nextVariantId);
      if (!nextVariant) return;

      const maxQty = getVariantMaxQty(nextVariant);
      if (maxQty <= 0) return;
      const nextQty = Math.max(1, Math.min(item.quantity, maxQty));

      const nextImage =
        Array.isArray(nextVariant.color?.images) &&
        nextVariant.color.images.length > 0
          ? nextVariant.color.images[0]
          : item.image;

      removeFromCart(item._id, item.selectedColor, item.selectedMeasure);
      addToCart(
        {
          ...(item as any),
          image: nextImage,
          price: computeVariantUnitPrice(nextVariant),
          selectedVariantId: nextVariant._id,
          selectedSku: nextVariant.stock?.sku || undefined,
          selectedColor: nextVariant.color?.name || "",
          selectedMeasure: nextVariant.measure || "",
          selectedMeasureUnit: nextVariant.measureUnit || undefined,
          trackQuantity: nextVariant.trackQuantity === true,
        },
        nextQty
      );
    },
    [addToCart, removeFromCart, variantsByProduct]
  );

  const changeItemQuantity = useCallback(
    (
      item: {
        _id: string;
        quantity: number;
      } & CartVariantMeta,
      nextQty: number
    ) => {
      const variants = variantsByProduct[item._id] || [];
      const currentVariant = resolveCartItemVariant(item, variants);
      const maxQty = getVariantMaxQty(currentVariant);
      const clamped = Math.max(1, Math.min(MAX_ORDER_QTY, Math.min(nextQty, maxQty)));
      updateQuantity(
        item._id,
        clamped,
        item.selectedColor,
        item.selectedMeasure
      );
    },
    [updateQuantity, variantsByProduct]
  );

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
            variantId: (item as any).selectedVariantId || undefined,
            sku: (item as any).selectedSku || (item as any).sku || undefined,
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

  const handleCreateOfflineOrder = async (
    method: "cod" | "bank_transfer"
  ) => {
    // خيارات الدفع غير الإلكتروني: تتطلب حساب
    if (!user) {
      setPolicyError(
        method === "bank_transfer"
          ? "الدفع بالحوالة البنكية يتطلب تسجيل الدخول."
          : "الدفع عند التوصيل يتطلب تسجيل الدخول."
      );
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
          paymentMethod: method,
          paymentStatus: "unpaid",
          status: "waiting_confirmation",
          notes,
          items: cart.map((it) => ({
            productId: it._id,
            name: getLocalizedText(it.name, locale),
            quantity: it.quantity,
            variantId: (it as any).selectedVariantId || undefined,
            sku: (it as any).selectedSku || (it as any).sku || undefined,
            color: (it as any).selectedColor || null,
            measure: (it as any).selectedMeasure || null,
          })),
        },
        { headers }
      );

      clearCart();
      navigate(`/checkout/success?method=${method}`);
    } catch (e: any) {
      console.error(e);
      alert(
        e?.response?.data?.message ||
          (method === "bank_transfer"
            ? "تعذر إنشاء طلب الحوالة البنكية"
            : "تعذر إنشاء طلب الدفع عند التوصيل")
      );
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
            variantId: (it as any).selectedVariantId || undefined,
            sku: (it as any).selectedSku || (it as any).sku || undefined,
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
                <th className="py-2 px-4 border">الاختيار</th>
                <th className="py-2 px-4 border">السعر</th>
                <th className="py-2 px-4 border">الكمية</th>
                <th className="py-2 px-4 border">الإجمالي الفرعي</th>
                <th className="py-2 px-4 border">إزالة</th>
              </tr>
            </thead>
            <tbody>
              {cart.map((rawItem) => {
                const item = rawItem as typeof rawItem & CartVariantMeta;
                const displayName = getLocalizedText(item.name, locale) || item._id;
                const variants = variantsByProduct[item._id] || [];
                const currentVariant = resolveCartItemVariant(item, variants);
                const measureOptions = getMeasureOptions(variants);
                const colorOptions = getColorOptions(variants);
                const selectedMeasureKey =
                  variantMeasureKey(currentVariant) ||
                  normalizeText(slugifyText(item.selectedMeasure));
                const selectedColorKey =
                  variantColorKey(currentVariant) ||
                  normalizeText(slugifyText(item.selectedColor));
                const hasMeasureSelector = measureOptions.length > 1;
                const hasColorSelector = colorOptions.length > 1;
                const selectedVariantId =
                  currentVariant?._id || item.selectedVariantId || variants[0]?._id || "";
                const maxQty = getVariantMaxQty(currentVariant);
                const canIncrease = item.quantity < maxQty;
                const isTracked = currentVariant?.trackQuantity === true;
                const available = isTracked
                  ? Math.max(0, Number(currentVariant?.stock?.inStock || 0))
                  : null;

                return (
                  <tr
                    key={`${item._id}-${item.selectedVariantId || item.selectedColor || ""}-${item.selectedMeasure || ""}`}
                  >
                    <td className="py-2 px-4 border align-top">
                      <div className="font-medium">{displayName}</div>
                    </td>
                    <td className="py-2 px-4 border align-top min-w-[320px]">
                      {variants.length > 0 && (hasMeasureSelector || hasColorSelector) ? (
                        <div className="space-y-2">
                          {hasMeasureSelector && (
                            <div className="rounded-md border border-[#E2E6EA] bg-[#F5F7F9] p-2">
                              <label className="mb-1 block text-xs font-medium text-gray-600">
                                المقاس
                              </label>
                              <select
                                className="w-full rounded border border-[#D8DDE3] bg-[#F5F7F9] px-2 py-1.5 text-sm"
                                value={selectedMeasureKey}
                                onChange={(event) => {
                                  const nextVariant = findVariantBySelections(
                                    variants,
                                    currentVariant,
                                    {
                                      measureKey: event.target.value,
                                      colorKey: selectedColorKey,
                                    }
                                  );
                                  if (
                                    nextVariant &&
                                    String(nextVariant._id) !== String(selectedVariantId)
                                  ) {
                                    changeItemVariant(item, nextVariant._id);
                                  }
                                }}
                              >
                                {measureOptions.map((option) => {
                                  const available = variants.some(
                                    (variant) =>
                                      variantMeasureKey(variant) === option.key &&
                                      getVariantMaxQty(variant) > 0
                                  );
                                  return (
                                    <option
                                      key={option.key}
                                      value={option.key}
                                      disabled={!available && option.key !== selectedMeasureKey}
                                    >
                                      {option.label}
                                      {!available ? " - غير متوفر" : ""}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                          )}

                          {hasColorSelector && (
                            <div className="rounded-md border border-[#E2E6EA] bg-[#F5F7F9] p-2">
                              <label className="mb-1 block text-xs font-medium text-gray-600">
                                اللون
                              </label>
                              <select
                                className="w-full rounded border border-[#D8DDE3] bg-[#F5F7F9] px-2 py-1.5 text-sm"
                                value={selectedColorKey}
                                onChange={(event) => {
                                  const nextVariant = findVariantBySelections(
                                    variants,
                                    currentVariant,
                                    {
                                      measureKey: selectedMeasureKey,
                                      colorKey: event.target.value,
                                    }
                                  );
                                  if (
                                    nextVariant &&
                                    String(nextVariant._id) !== String(selectedVariantId)
                                  ) {
                                    changeItemVariant(item, nextVariant._id);
                                  }
                                }}
                              >
                                {colorOptions.map((option) => {
                                  const compatible = variants.filter(
                                    (variant) =>
                                      variantColorKey(variant) === option.key &&
                                      (!selectedMeasureKey ||
                                        variantMeasureKey(variant) === selectedMeasureKey)
                                  );
                                  const available = compatible.some(
                                    (variant) => getVariantMaxQty(variant) > 0
                                  );
                                  return (
                                    <option
                                      key={option.key}
                                      value={option.key}
                                      disabled={
                                        compatible.length === 0 ||
                                        (!available && option.key !== selectedColorKey)
                                      }
                                    >
                                      {option.label}
                                      {compatible.length === 0
                                        ? " - غير متوافق"
                                        : !available
                                        ? " - غير متوفر"
                                        : ""}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-gray-500">
                          {(item.selectedMeasure || "-") +
                            (item.selectedColor ? ` - ${item.selectedColor}` : "")}
                        </span>
                      )}
                      {isTracked && (
                        <p className="mt-1 text-xs text-gray-500">
                          المتاح: {available}
                        </p>
                      )}
                    </td>
                    <td className="py-2 px-4 border align-top">{currency(item.price)}</td>
                    <td className="py-2 px-4 border align-top">
                      <div className="flex items-center gap-2">
                        <button
                          className="px-2 py-1 border rounded"
                          onClick={() => changeItemQuantity(item, item.quantity - 1)}
                          disabled={item.quantity <= 1}
                        >
                          -
                        </button>
                        <QuantityInput
                          quantity={item.quantity}
                          onChange={(newQty) => changeItemQuantity(item, newQty)}
                        />
                        <button
                          className="px-2 py-1 border rounded disabled:opacity-50"
                          onClick={() => changeItemQuantity(item, item.quantity + 1)}
                          disabled={!canIncrease}
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td className="py-2 px-4 border align-top">
                      {currency(item.price * item.quantity)}
                    </td>
                    <td className="py-2 px-4 border align-top">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() =>
                          removeFromCart(
                            item._id,
                            item.selectedColor,
                            item.selectedMeasure
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
                  <td colSpan={6} className="py-4 text-center text-gray-500">
                    السلة فارغة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 📱 للموبايل: كروت العناصر */}
        <div className="grid gap-4 md:hidden">
          {cart.map((rawItem) => {
            const item = rawItem as typeof rawItem & CartVariantMeta;
            const displayName = getLocalizedText(item.name, locale) || item._id;
            const variants = variantsByProduct[item._id] || [];
            const currentVariant = resolveCartItemVariant(item, variants);
            const measureOptions = getMeasureOptions(variants);
            const colorOptions = getColorOptions(variants);
            const selectedMeasureKey =
              variantMeasureKey(currentVariant) ||
              normalizeText(slugifyText(item.selectedMeasure));
            const selectedColorKey =
              variantColorKey(currentVariant) ||
              normalizeText(slugifyText(item.selectedColor));
            const hasMeasureSelector = measureOptions.length > 1;
            const hasColorSelector = colorOptions.length > 1;
            const selectedVariantId =
              currentVariant?._id || item.selectedVariantId || variants[0]?._id || "";
            const maxQty = getVariantMaxQty(currentVariant);
            const isTracked = currentVariant?.trackQuantity === true;
            const available = isTracked
              ? Math.max(0, Number(currentVariant?.stock?.inStock || 0))
              : null;

            return (
              <div
                key={`${item._id}-${item.selectedVariantId || item.selectedColor || ""}-${item.selectedMeasure || ""}`}
                className="border rounded-lg p-4 text-right"
              >
                <h3 className="text-lg font-semibold mb-1">{displayName}</h3>
                <p className="text-gray-600 mb-2">السعر: {currency(item.price)}</p>

                <div className="mb-2 space-y-2">
                  {variants.length > 0 && hasMeasureSelector && (
                    <div className="rounded-md border border-[#E2E6EA] bg-[#F5F7F9] p-2">
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        المقاس
                      </label>
                      <select
                        className="w-full rounded border border-[#D8DDE3] bg-[#F5F7F9] px-2 py-1.5 text-sm"
                        value={selectedMeasureKey}
                        onChange={(event) => {
                          const nextVariant = findVariantBySelections(
                            variants,
                            currentVariant,
                            {
                              measureKey: event.target.value,
                              colorKey: selectedColorKey,
                            }
                          );
                          if (
                            nextVariant &&
                            String(nextVariant._id) !== String(selectedVariantId)
                          ) {
                            changeItemVariant(item, nextVariant._id);
                          }
                        }}
                      >
                        {measureOptions.map((option) => {
                          const available = variants.some(
                            (variant) =>
                              variantMeasureKey(variant) === option.key &&
                              getVariantMaxQty(variant) > 0
                          );
                          return (
                            <option
                              key={option.key}
                              value={option.key}
                              disabled={!available && option.key !== selectedMeasureKey}
                            >
                              {option.label}
                              {!available ? " - غير متوفر" : ""}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}

                  {variants.length > 0 && hasColorSelector && (
                    <div className="rounded-md border border-[#E2E6EA] bg-[#F5F7F9] p-2">
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        اللون
                      </label>
                      <select
                        className="w-full rounded border border-[#D8DDE3] bg-[#F5F7F9] px-2 py-1.5 text-sm"
                        value={selectedColorKey}
                        onChange={(event) => {
                          const nextVariant = findVariantBySelections(
                            variants,
                            currentVariant,
                            {
                              measureKey: selectedMeasureKey,
                              colorKey: event.target.value,
                            }
                          );
                          if (
                            nextVariant &&
                            String(nextVariant._id) !== String(selectedVariantId)
                          ) {
                            changeItemVariant(item, nextVariant._id);
                          }
                        }}
                      >
                        {colorOptions.map((option) => {
                          const compatible = variants.filter(
                            (variant) =>
                              variantColorKey(variant) === option.key &&
                              (!selectedMeasureKey ||
                                variantMeasureKey(variant) === selectedMeasureKey)
                          );
                          const available = compatible.some(
                            (variant) => getVariantMaxQty(variant) > 0
                          );
                          return (
                            <option
                              key={option.key}
                              value={option.key}
                              disabled={
                                compatible.length === 0 ||
                                (!available && option.key !== selectedColorKey)
                              }
                            >
                              {option.label}
                              {compatible.length === 0
                                ? " - غير متوافق"
                                : !available
                                ? " - غير متوفر"
                                : ""}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}

                  {variants.length === 0 || (!hasMeasureSelector && !hasColorSelector) ? (
                    <p className="text-sm text-gray-500">
                      {(item.selectedMeasure || "-") +
                        (item.selectedColor ? ` - ${item.selectedColor}` : "")}
                    </p>
                  ) : (
                    null
                  )}
                  {isTracked && (
                    <p className="mt-1 text-xs text-gray-500">المتاح: {available}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 mb-1">
                  <span className="text-gray-600">الكمية:</span>
                  <QuantityInput
                    quantity={item.quantity}
                    onChange={(newQty) => changeItemQuantity(item, newQty)}
                  />
                  <button
                    className="px-2 py-1 border rounded disabled:opacity-50"
                    onClick={() => changeItemQuantity(item, item.quantity + 1)}
                    disabled={item.quantity >= maxQty}
                  >
                    +
                  </button>
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
                      item.selectedColor,
                      item.selectedMeasure
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

            {/* الحوالة البنكية: يظهر لكنه معطّل للزوار */}
            <label
              className={`flex items-start gap-2 ${
                isGuest ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
              }`}
            >
              <input
                type="radio"
                name="pay"
                disabled={isGuest}
                checked={paymentMethod === "bank_transfer"}
                onChange={() => setPaymentMethod("bank_transfer")}
              />
              <div>
                <div className="font-medium">🏦 حوالة بنكية</div>
                <div className="text-sm text-blue-700">
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
                      سيتم إنشاء الطلب مباشرة، وبعدها سيتواصل معك فريق المتجر
                      لتزويدك بتعليمات الحوالة البنكية.
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
            ) : paymentMethod === "bank_transfer" ? (
              <Button
                onClick={() => handleCreateOfflineOrder("bank_transfer")}
                variant="outline"
                disabled={cart.length === 0 || isGuest}
                title={
                  isGuest ? "سجّل الدخول لتفعيل الحوالة البنكية" : undefined
                }
              >
                إنشاء طلب حوالة بنكية
              </Button>
            ) : (
              <Button
                onClick={() => handleCreateOfflineOrder("cod")}
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
                بالبطاقة. لإتاحة الدفع عند التوصيل أو الحوالة البنكية، يرجى
                تسجيل الدخول أو إنشاء حساب.
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
