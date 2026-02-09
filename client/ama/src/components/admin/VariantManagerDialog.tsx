import React, { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";
import { getLocalizedText } from "@/lib/localized";
import { api } from "@/lib/api";

type Price = {
  amount: number;
  compareAt?: number;
  currency?: string;
  discount?: {
    type?: "percent" | "amount";
    value?: number;
    startAt?: string;
    endAt?: string;
  };
};

type Variant = {
  _id?: string;
  product: string;
  measure: string;
  measureUnit?: string;
  color: { name: string; code?: string; images?: string[] };
  price: Price;
  stock: { inStock: number; sku: string };
  trackQuantity?: boolean;
  tags?: string[];
  finalAmount?: number;
  isDiscountActive?: boolean;
  displayCompareAt?: number | null;
};

interface Props {
  product: { _id: string; name: string };
  token: string;
  onClose: () => void;
  onChanged?: () => void;
}

const emptyForm = (productId: string): Variant => ({
  product: productId,
  measure: "",
  measureUnit: "",
  color: { name: "", code: "", images: [] },
  price: { amount: 0, compareAt: undefined, currency: "USD" },
  stock: { inStock: 0, sku: "" },
  trackQuantity: false,
  tags: [],
});

const easternArabicDigits: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

const normalizeDigits = (value: string): string => {
  if (!value) return "";

  let normalized = value.replace(/[٠-٩]/g, (char) => easternArabicDigits[char] || char);
  normalized = normalized.replace(/[٫،]/g, ".");
  normalized = normalized.replace(/[٬\s]/g, "");
  if (normalized.includes(".")) {
    normalized = normalized.replace(/,/g, "");
  } else {
    normalized = normalized.replace(/,/g, ".");
  }
  return normalized.trim();
};

const VariantManagerDialog: React.FC<Props> = ({
  product,
  token,
  onClose,
  onChanged,
}) => {
  const { locale } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [form, setForm] = useState<Variant>(() => emptyForm(product._id));
  const [priceInput, setPriceInput] = useState<string>(() => "0");
  const [compareAtInput, setCompareAtInput] = useState<string>("");
  const [isEditingId, setIsEditingId] = useState<string | null>(null);
  const [newColorImage, setNewColorImage] = useState("");

  const [discountTargetId, setDiscountTargetId] = useState<string | null>(null);
  const [discountType, setDiscountType] = useState<"percent" | "amount">(
    "percent"
  );
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [discountStart, setDiscountStart] = useState<string>("");
  const [discountEnd, setDiscountEnd] = useState<string>("");

  const headers = useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }),
    [token]
  );

  const displayName = useMemo(
    () => getLocalizedText(product?.name, locale) ?? product?._id ?? "",
    [locale, product?._id, product?.name]
  );

  const fetchVariants = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/variants", {
        params: { product: product._id, limit: 500 },
        headers,
      });
      const items = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data)
        ? data
        : [];
      setVariants(items);
    } catch (e) {
      console.error("❌ Failed to fetch variants", e);
      setVariants([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVariants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?._id]);

  const resetForm = () => {
    setForm(emptyForm(product._id));
    setIsEditingId(null);
    setNewColorImage("");
    setPriceInput("0");
    setCompareAtInput("");
  };

  const handleAddColorImage = () => {
    if (!newColorImage.trim()) return;
    setForm({
      ...form,
      color: {
        ...form.color,
        images: [...(form.color.images || []), newColorImage.trim()],
      },
    });
    setNewColorImage("");
  };

  const handleRemoveColorImage = (idx: number) => {
    const imgs = [...(form.color.images || [])];
    imgs.splice(idx, 1);
    setForm({ ...form, color: { ...form.color, images: imgs } });
  };

  const createVariant = async () => {
    try {
      const payload = form;
      const { data } = await api.post("/variants", payload, {
        headers,
      });
      setVariants((prev) => [data, ...prev]);
      resetForm();
      onChanged?.();
    } catch (e: any) {
      alert(e?.response?.data?.message || e?.message || "فشل إنشاء المتغيّر");
    }
  };

  const startEdit = (v: Variant) => {
    setIsEditingId(v._id || null);
    setForm({
      product: v.product,
      measure: v.measure || "",
      measureUnit: v.measureUnit || "",
      color: {
        name: v.color?.name || "",
        code: v.color?.code || "",
        images: v.color?.images || [],
      },
      price: {
        amount: v.price?.amount || 0,
        compareAt:
          typeof v.price?.compareAt === "number"
            ? v.price.compareAt
            : v.price?.amount || 0,
        currency: v.price?.currency || "USD",
        discount: v.price?.discount,
      },
      stock: { inStock: v.stock?.inStock || 0, sku: v.stock?.sku || "" },
      trackQuantity: v.trackQuantity === true,
      tags: v.tags || [],
      _id: v._id,
    });
    const amountValue =
      typeof v.price?.amount === "number" && Number.isFinite(v.price.amount)
        ? v.price.amount
        : 0;
    setPriceInput(String(amountValue));
    const compareAtValue =
      typeof v.price?.compareAt === "number" && Number.isFinite(v.price.compareAt)
        ? v.price.compareAt
        : amountValue;
    setCompareAtInput(
      typeof compareAtValue === "number" && Number.isFinite(compareAtValue)
        ? String(compareAtValue)
        : ""
    );
  };

  const updateVariant = async () => {
    if (!isEditingId) return;
    try {
      const payload = { ...form };
      delete (payload as any)._id;
      const { data } = await api.put(`/variants/${isEditingId}`, payload, {
        headers,
      });
      setVariants((prev) =>
        prev.map((x) => (x._id === isEditingId ? data : x))
      );
      resetForm();
      onChanged?.();
    } catch (e: any) {
      alert(e?.response?.data?.message || e?.message || "فشل تعديل المتغيّر");
    }
  };

  const removeVariant = async (id?: string) => {
    if (!id) return;
    if (!confirm("هل أنت متأكد من حذف هذا المتغيّر؟")) return;
    try {
      await api.delete(`/variants/${id}`, { headers });
      setVariants((prev) => prev.filter((x) => x._id !== id));
      onChanged?.();
    } catch (e: any) {
      alert(e?.response?.data?.message || e?.message || "فشل حذف المتغيّر");
    }
  };

  const toggleTrackQuantity = async (variant: Variant) => {
    if (!variant?._id) return;
    const next = variant.trackQuantity !== true;
    try {
      const { data } = await api.put(
        `/variants/${variant._id}`,
        { trackQuantity: next },
        { headers }
      );
      setVariants((prev) =>
        prev.map((x) => (x._id === variant._id ? data : x))
      );
      if (isEditingId === variant._id) {
        setForm((prev) => ({ ...prev, trackQuantity: next }));
      }
      onChanged?.();
    } catch (e: any) {
      alert(
        e?.response?.data?.message || e?.message || "فشل تحديث حالة الكمية"
      );
    }
  };

  const openDiscount = (v: Variant) => {
    setDiscountTargetId(v._id || null);
    const d = v.price?.discount || { type: "percent", value: 0 };
    setDiscountType(d.type === "amount" ? "amount" : "percent");
    setDiscountValue(typeof d.value === "number" ? d.value : 0);

    const toLocalDT = (iso?: string) => {
      if (!iso) return "";
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, "0");
      const yyyy = d.getFullYear();
      const mm = pad(d.getMonth() + 1);
      const dd = pad(d.getDate());
      const hh = pad(d.getHours());
      const mi = pad(d.getMinutes());
      return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
    };

    setDiscountStart(toLocalDT(v.price?.discount?.startAt as any));
    setDiscountEnd(toLocalDT(v.price?.discount?.endAt as any));
  };

  const applyDiscount = async () => {
    if (!discountTargetId) return;
    try {
      const payload = {
        type: discountType,
        value: Number(discountValue) || 0,
        startAt: discountStart || undefined,
        endAt: discountEnd || undefined,
      };
      const { data } = await api.post(
        `/variants/${discountTargetId}/discount`,
        payload,
        { headers }
      );
      setVariants((prev) =>
        prev.map((x) => (x._id === discountTargetId ? data : x))
      );
      setDiscountTargetId(null);
      onChanged?.();
    } catch (e: any) {
      alert(e?.response?.data?.message || e?.message || "فشل تطبيق الخصم");
    }
  };

  const resetDiscount = async (id?: string) => {
    if (!id) return;
    try {
      const { data } = await api.post(
        `/variants/${id}/discount/reset`,
        { type: "percent", value: 0 },
        { headers }
      );
      setVariants((prev) => prev.map((x) => (x._id === id ? data : x)));
      onChanged?.();
    } catch (e: any) {
      alert(e?.response?.data?.message || e?.message || "فشل إلغاء الخصم");
    }
  };

  return (
    <div className="p-4 min-w-[780px] text-right">
      <h3 className="text-xl font-semibold mb-3">
        إدارة المتغيّرات: {displayName}
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* القائمة */}
        <div className="rounded-xl border p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium">المتغيّرات الحالية</h4>
            <Button variant="outline" size="sm" onClick={fetchVariants}>
              تحديث
            </Button>
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">جارٍ التحميل…</p>
          ) : variants.length ? (
            <ul className="space-y-2 max-h-[55vh] overflow-auto">
              {variants.map((v) => (
                <li
                  key={v._id}
                  className="border rounded-lg p-2 flex items-center gap-3"
                >
                  <div className="flex-1">
                    <div className="font-medium">
                      {v.measure}
                      {v.measureUnit ? ` (${v.measureUnit})` : ""}
                      {" — "}
                      {v.color?.name}
                      {v.color?.code ? ` [${v.color.code}]` : ""}
                    </div>
                    <div className="text-sm text-gray-600">
                      السعر: {v.finalAmount ?? v.price?.amount} ₪{" "}
                      {v.displayCompareAt ? (
                        <span className="line-through ml-1">
                          {v.displayCompareAt} ₪
                        </span>
                      ) : null}
                      {" · "}
                      {v.trackQuantity === true
                        ? `المخزون: ${v.stock?.inStock}`
                        : "الكمية: غير مفعلة (لا نهائي)"}{" "}
                      {" · "}
                      SKU: {v.stock?.sku}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleTrackQuantity(v)}
                    >
                      {v.trackQuantity === true
                        ? "إلغاء تفعيل الكمية"
                        : "تفعيل الكمية"}
                    </Button>
                    <Button size="sm" onClick={() => startEdit(v)}>
                      تعديل
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openDiscount(v)}
                    >
                      خصم
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => removeVariant(v._id)}
                    >
                      حذف
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">لا توجد متغيّرات بعد.</p>
          )}
        </div>

        {/* النموذج */}
        <div className="rounded-xl border p-3">
          <h4 className="font-medium mb-2">
            {isEditingId ? "تعديل متغيّر" : "إضافة متغيّر"}
          </h4>

          <div className="grid gap-2">
            <Input
              placeholder="المقياس (مثال: 500)"
              value={form.measure}
              onChange={(e) => setForm({ ...form, measure: e.target.value })}
            />
            <Input
              placeholder="وحدة القياس (مثال: ml, g, cm)"
              value={form.measureUnit || ""}
              onChange={(e) =>
                setForm({ ...form, measureUnit: e.target.value })
              }
            />

            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="لون (اسم)"
                value={form.color?.name || ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    color: { ...form.color, name: e.target.value },
                  })
                }
              />
              <Input
                placeholder="لون (كود HEX اختياري)"
                value={form.color?.code || ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    color: { ...form.color, code: e.target.value },
                  })
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Input
                type="text"
                inputMode="decimal"
                placeholder="السعر"
                value={priceInput}
                onChange={(e) => {
                  const normalized = normalizeDigits(e.target.value);
                  setPriceInput(normalized);
                  const parsed = parseFloat(normalized);
                  if (normalized === "") return;
                  if (!Number.isFinite(parsed)) return;
                  setForm({
                    ...form,
                    price: {
                      ...form.price,
                      amount: parsed,
                    },
                  });
                }}
              />
              <Input
                type="text"
                inputMode="decimal"
                placeholder="Compare At (اختياري)"
                value={compareAtInput}
                onChange={(e) => {
                  const normalized = normalizeDigits(e.target.value);
                  setCompareAtInput(normalized);
                  if (normalized === "") {
                    setForm({
                      ...form,
                      price: { ...form.price, compareAt: undefined },
                    });
                    return;
                  }
                  const parsed = parseFloat(normalized);
                  if (!Number.isFinite(parsed)) return;
                  setForm({
                    ...form,
                    price: {
                      ...form.price,
                      compareAt: parsed,
                    },
                  });
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                placeholder="المخزون"
                value={form.stock.inStock}
                disabled={form.trackQuantity !== true}
                onChange={(e) =>
                  setForm({
                    ...form,
                    stock: {
                      ...form.stock,
                      inStock: Math.max(0, parseInt(e.target.value || "0", 10)),
                    },
                  })
                }
              />
              <Input
                placeholder="SKU"
                value={form.stock.sku}
                onChange={(e) =>
                  setForm({
                    ...form,
                    stock: { ...form.stock, sku: e.target.value },
                  })
                }
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">تفعيل الكمية</label>
              <Button
                type="button"
                variant={form.trackQuantity === true ? "default" : "outline"}
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    trackQuantity: prev.trackQuantity === true ? false : true,
                  }))
                }
              >
                {form.trackQuantity === true
                  ? "مفعّل: يعتمد على المخزون"
                  : "غير مفعّل: مخزون لا نهائي"}
              </Button>
              <p className="text-xs text-muted-foreground">
                عند تعطيله، يمكن الشراء حتى لو كانت الكمية 0.
              </p>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">
                صور اللون (اختياري):
              </div>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="رابط صورة"
                  value={newColorImage}
                  onChange={(e) => setNewColorImage(e.target.value)}
                />
                <Button variant="outline" onClick={handleAddColorImage}>
                  إضافة
                </Button>
              </div>
              {!!(form.color.images || []).length && (
                <ul className="mt-2 space-y-1">
                  {(form.color.images || []).map((img, idx) => (
                    <li
                      key={idx}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="truncate">{img}</span>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleRemoveColorImage(idx)}
                      >
                        إزالة
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center gap-2 justify-end mt-2">
              {isEditingId ? (
                <>
                  <Button onClick={updateVariant}>حفظ التعديل</Button>
                  <Button variant="outline" onClick={resetForm}>
                    إلغاء
                  </Button>
                </>
              ) : (
                <Button onClick={createVariant}>إضافة المتغيّر</Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* نافذة الخصم البسيطة */}
      {discountTargetId && (
        <div className="mt-4 border rounded-xl p-3">
          <h4 className="font-medium mb-2">تطبيق خصم</h4>
          <div className="grid grid-cols-2 gap-2">
            <select
              className="border rounded px-2 py-1"
              value={discountType}
              onChange={(e) =>
                setDiscountType(
                  e.target.value === "amount" ? "amount" : "percent"
                )
              }
            >
              <option value="percent">نسبة مئوية %</option>
              <option value="amount">قيمة ثابتة</option>
            </select>
            <Input
              type="number"
              placeholder="قيمة الخصم"
              value={discountValue}
              onChange={(e) => setDiscountValue(Number(e.target.value) || 0)}
            />
            <Input
              type="datetime-local"
              value={discountStart}
              onChange={(e) => setDiscountStart(e.target.value)}
            />
            <Input
              type="datetime-local"
              value={discountEnd}
              onChange={(e) => setDiscountEnd(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2 justify-end mt-3">
            <Button onClick={applyDiscount}>تطبيق</Button>
            <Button
              variant="secondary"
              onClick={() => {
                resetDiscount(discountTargetId);
                setDiscountTargetId(null);
              }}
            >
              إلغاء الخصم
            </Button>
            <Button variant="outline" onClick={() => setDiscountTargetId(null)}>
              إغلاق
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 mt-4">
        <Button variant="outline" onClick={onClose}>
          إغلاق
        </Button>
      </div>
    </div>
  );
};

export default VariantManagerDialog;
