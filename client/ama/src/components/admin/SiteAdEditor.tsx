import React, { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  emptyLocalized,
  ensureLocalizedObject,
  getLocalizedText,
  type LocalizedObject,
} from "@/lib/localized";
import { useLanguage } from "@/context/LanguageContext";

type SiteAdState = {
  enabled: boolean;
  title: LocalizedObject;
  text: LocalizedObject;
  imageUrl: string;
  targetType: "none" | "product" | "url";
  targetValue: string;
  showMode: "once_per_session" | "always";
  updatedAt?: string | null;
};

const initialState: SiteAdState = {
  enabled: false,
  title: { ...emptyLocalized },
  text: { ...emptyLocalized },
  imageUrl: "",
  targetType: "none",
  targetValue: "",
  showMode: "once_per_session",
  updatedAt: null,
};

const normalizeSiteAd = (raw: any): SiteAdState => ({
  enabled: raw?.enabled === true,
  title: ensureLocalizedObject(raw?.title),
  text: ensureLocalizedObject(raw?.text),
  imageUrl: String(raw?.imageUrl || "").trim(),
  targetType:
    raw?.targetType === "product" || raw?.targetType === "url"
      ? raw.targetType
      : "none",
  targetValue: String(raw?.targetValue || "").trim(),
  showMode: raw?.showMode === "always" ? "always" : "once_per_session",
  updatedAt: raw?.updatedAt || null,
});

const SiteAdEditor: React.FC<{ token?: string | null }> = ({ token }) => {
  const { locale } = useLanguage();
  const [form, setForm] = useState<SiteAdState>(initialState);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const headers = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token]
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    api
      .get("/site-ad", { headers })
      .then((res) => {
        if (!live) return;
        setForm(normalizeSiteAd(res?.data || {}));
      })
      .catch((err) => {
        if (!live) return;
        console.error("Failed to load site ad", err);
        setError("تعذّر تحميل إعدادات الإعلان");
      })
      .finally(() => {
        if (!live) return;
        setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [headers]);

  const updateLocalized = (
    field: "title" | "text",
    key: "ar" | "he",
    value: string
  ) => {
    setForm((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        [key]: value,
      },
    }));
  };

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    const payload = {
      enabled: form.enabled,
      title: form.title,
      text: form.text,
      imageUrl: form.imageUrl.trim(),
      targetType: form.targetType,
      targetValue: form.targetType === "none" ? "" : form.targetValue.trim(),
      showMode: form.showMode,
    };

    try {
      const { data } = await api.put("/site-ad", payload, { headers });
      setForm(normalizeSiteAd(data || {}));
      setSuccess("تم حفظ الإعلان بنجاح");
    } catch (err: any) {
      console.error("Failed to save site ad", err);
      setError(err?.response?.data?.message || "تعذّر حفظ الإعلان");
    } finally {
      setSaving(false);
    }
  };

  const previewTitle = getLocalizedText(form.title, locale);
  const previewText = getLocalizedText(form.text, locale);

  if (loading) {
    return (
      <div className="rounded-2xl border p-6 bg-white dark:bg-gray-900 flex items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>جاري تحميل إعلان الموقع...</span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border p-4 md:p-6 bg-white dark:bg-gray-900 space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-semibold">الإعلان المنبثق للعملاء</h3>
          <p className="text-sm text-muted-foreground">
            يظهر للزوار عند دخول الموقع ويمكنهم تخطيه.
          </p>
        </div>
        <Button
          variant={form.enabled ? "default" : "outline"}
          onClick={() =>
            setForm((prev) => ({
              ...prev,
              enabled: !prev.enabled,
            }))
          }
        >
          {form.enabled ? "مفعّل" : "معطّل"}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">عنوان الإعلان (AR)</label>
          <Input
            value={form.title.ar}
            onChange={(e) => updateLocalized("title", "ar", e.target.value)}
            placeholder="مثال: خصم خاص لفترة محدودة"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">عنوان الإعلان (HE)</label>
          <Input
            value={form.title.he}
            onChange={(e) => updateLocalized("title", "he", e.target.value)}
            placeholder="כותרת מודעה"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">نص الإعلان (AR)</label>
          <Textarea
            value={form.text.ar}
            onChange={(e) => updateLocalized("text", "ar", e.target.value)}
            placeholder="أدخل وصفًا قصيرًا وجذابًا"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">نص الإعلان (HE)</label>
          <Textarea
            value={form.text.he}
            onChange={(e) => updateLocalized("text", "he", e.target.value)}
            placeholder="הזן תיאור קצר"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">رابط الصورة</label>
        <Input
          value={form.imageUrl}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, imageUrl: e.target.value }))
          }
          placeholder="https://example.com/ad.jpg"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">إجراء الضغط</label>
          <Select
            value={form.targetType}
            onValueChange={(value: "none" | "product" | "url") =>
              setForm((prev) => ({
                ...prev,
                targetType: value,
                targetValue: value === "none" ? "" : prev.targetValue,
              }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="اختر إجراء" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">بدون إجراء</SelectItem>
              <SelectItem value="product">فتح منتج</SelectItem>
              <SelectItem value="url">فتح رابط</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">
            {form.targetType === "product"
              ? "معرّف المنتج"
              : form.targetType === "url"
              ? "رابط الوجهة"
              : "قيمة الإجراء"}
          </label>
          <Input
            disabled={form.targetType === "none"}
            value={form.targetValue}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, targetValue: e.target.value }))
            }
            placeholder={
              form.targetType === "product"
                ? "ضع Product ID"
                : form.targetType === "url"
                ? "https://example.com/page"
                : "-"
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">طريقة الظهور</label>
        <Select
          value={form.showMode}
          onValueChange={(value: "once_per_session" | "always") =>
            setForm((prev) => ({ ...prev, showMode: value }))
          }
        >
          <SelectTrigger className="max-w-sm">
            <SelectValue placeholder="اختر طريقة العرض" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="once_per_session">مرة واحدة لكل جلسة</SelectItem>
            <SelectItem value="always">في كل زيارة</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border p-4 bg-muted/30">
        <p className="text-sm font-medium mb-3">معاينة سريعة</p>
        {form.imageUrl ? (
          <img
            src={form.imageUrl}
            alt="ad preview"
            className="w-full max-h-56 object-cover rounded-lg border mb-3"
          />
        ) : null}
        <p className="text-base font-semibold">
          {previewTitle || "عنوان الإعلان"}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          {previewText || "نص الإعلان سيظهر هنا"}
        </p>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving || !token}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              جارٍ الحفظ...
            </>
          ) : (
            "حفظ الإعلان"
          )}
        </Button>
      </div>
    </div>
  );
};

export default SiteAdEditor;
