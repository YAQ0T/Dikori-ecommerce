import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";
import {
  ensureLocalizedObject,
  getLocalizedText,
  type LocalizedObject,
} from "@/lib/localized";

type ProductLite = {
  _id: string;
  name: LocalizedObject;
  images?: string[];
  mainImage?: string;
  price?: number;
};

const getImage = (p: ProductLite) =>
  p.images?.[0] ||
  p.mainImage ||
  "https://placehold.co/300x200/png?text=No+Image";

export default function AdminHomeCollections() {
  const { token, user } = useAuth();
  const { locale } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [recommended, setRecommended] = useState<ProductLite[]>([]);
  const [newArrivals, setNewArrivals] = useState<ProductLite[]>([]);

  // بحث وإضافة
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductLite[]>([]);
  const [tab, setTab] = useState<"recommended" | "new">("recommended");

  // هيدرز موحّدة
  const headers = useMemo(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [token]);

  useEffect(() => {
    // صلاحيات بسيطة (اختياري)
    if (user && !(user.role === "admin" || user.role === "dealer")) {
      // ليس أدمن/تاجر — حسب رغبتك، ممكن تمنعي الوصول أو تعرضي رسالة
      // alert("ليس لديك صلاحية الوصول");
    }
  }, [user]);

  // تحميل القوائم الحالية
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        setLoading(true);
        const { data } = await api.get("/home-collections", { headers });

        if (!live) return;

        const rec = Array.isArray(data?.recommended) ? data.recommended : [];
        const nea = Array.isArray(data?.newArrivals) ? data.newArrivals : [];

        const toLite = (arr: any[]): ProductLite[] =>
          arr.map((p: any) => ({
            _id: p._id,
            name: ensureLocalizedObject(p.name),
            images: p.images,
            mainImage: p.mainImage,
            price: p.minPrice ?? p.price,
          }));

        setRecommended(toLite(rec));
        setNewArrivals(toLite(nea));
      } catch (e) {
        console.error("فشل تحميل home-collections:", e);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [headers]);

  // بحث سريع عن المنتجات لإضافتها
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      try {
        const params = new URLSearchParams();
        params.set("page", "1");
        params.set("limit", "12");
        params.set("q", query.trim());
        const url = `/products/with-stats?${params.toString()}`;
        const { data } = await api.get(url, { headers });
        if (!live) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        const mapped: ProductLite[] = items.map((p: any) => ({
          _id: p._id,
          name: ensureLocalizedObject(p.name),
          images: p.images,
          mainImage: p.mainImage,
          price: p.minPrice ?? p.price,
        }));
        setResults(mapped);
      } catch (e) {
        if (!live) return;
        console.error("فشل البحث عن المنتجات:", e);
        setResults([]);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      live = false;
    };
  }, [query, headers]);

  const addToList = (p: ProductLite) => {
    const existsInRec = recommended.some((x) => x._id === p._id);
    const existsInNew = newArrivals.some((x) => x._id === p._id);
    if (tab === "recommended" && !existsInRec) {
      setRecommended((prev) => [...prev, p]);
    }
    if (tab === "new" && !existsInNew) {
      setNewArrivals((prev) => [...prev, p]);
    }
  };

  const removeFromList = (list: "recommended" | "new", id: string) => {
    if (list === "recommended") {
      setRecommended((prev) => prev.filter((x) => x._id !== id));
    } else {
      setNewArrivals((prev) => prev.filter((x) => x._id !== id));
    }
  };

  const move = (list: "recommended" | "new", index: number, dir: -1 | 1) => {
    const arr = list === "recommended" ? [...recommended] : [...newArrivals];
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= arr.length) return;
    const tmp = arr[index];
    arr[index] = arr[newIndex];
    arr[newIndex] = tmp;
    if (list === "recommended") setRecommended(arr);
    else setNewArrivals(arr);
  };

  const save = async () => {
    try {
      setSaving(true);

      // ✅ مفاتيح متوافقة مع السيرفر
      const payload = {
        recommended: recommended.map((p) => p._id),
        newArrivals: newArrivals.map((p) => p._id),
      };

      const { data } = await api.put("/home-collections", payload, { headers });

      // إن رجّع السيرفر بيانات محدثة بعد الحفظ، نحدّث الحالة
      if (data?.recommended || data?.newArrivals) {
        const toLite = (arr: any[]): ProductLite[] =>
          (arr || []).map((p: any) => ({
            _id: p._id,
            name: ensureLocalizedObject(p.name),
            images: p.images,
            mainImage: p.mainImage,
            price: p.minPrice ?? p.price,
          }));
        if (Array.isArray(data?.recommended))
          setRecommended(toLite(data.recommended));
        if (Array.isArray(data?.newArrivals))
          setNewArrivals(toLite(data.newArrivals));
      }

      alert("تم الحفظ بنجاح ✅");
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        "فشل الحفظ، حاول مجددًا.";
      console.error("فشل حفظ home-collections:", err);
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Navbar />
      <main className="container mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6 text-right">
          إدارة منتجات الصفحة الرئيسية
        </h1>

        {loading ? (
          <p className="text-center">جاري التحميل…</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* القوائم المختارة */}
            <section className="lg:col-span-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* قائمة المقترحة */}
                <div className="rounded-2xl border p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold text-xl">منتجات مُقترحة لك</h2>
                    <span className="text-sm text-gray-500">
                      {recommended.length} منتج
                    </span>
                  </div>
                  <ul className="space-y-3">
                    {recommended.map((p, idx) => {
                      const displayName =
                        getLocalizedText(p.name, locale) || p._id;
                      return (
                        <li
                          key={p._id}
                          className="flex gap-3 items-center border rounded-lg p-2"
                        >
                          <img
                            src={getImage(p)}
                            alt={displayName}
                            className="w-16 h-16 object-cover rounded-md"
                          />
                          <div className="flex-1 text-right">
                            <div className="font-medium line-clamp-1">
                              {displayName}
                            </div>
                            {typeof p.price === "number" && (
                              <div className="text-sm text-gray-500 mt-0.5">
                                {p.price} ₪
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => move("recommended", idx, -1)}
                              title="أعلى"
                            >
                              ▲
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => move("recommended", idx, +1)}
                              title="أسفل"
                            >
                              ▼
                            </Button>
                            <Button
                              variant="destructive"
                              onClick={() => removeFromList("recommended", p._id)}
                            >
                              إزالة
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {/* قائمة وصل حديثًا */}
                <div className="rounded-2xl border p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold text-xl">وصل حديثًا</h2>
                    <span className="text-sm text-gray-500">
                      {newArrivals.length} منتج
                    </span>
                  </div>
                  <ul className="space-y-3">
                    {newArrivals.map((p, idx) => {
                      const displayName =
                        getLocalizedText(p.name, locale) || p._id;
                      return (
                        <li
                          key={p._id}
                          className="flex gap-3 items-center border rounded-lg p-2"
                        >
                          <img
                            src={getImage(p)}
                            alt={displayName}
                            className="w-16 h-16 object-cover rounded-md"
                          />
                          <div className="flex-1 text-right">
                            <div className="font-medium line-clamp-1">
                              {displayName}
                            </div>
                            {typeof p.price === "number" && (
                              <div className="text-sm text-gray-500 mt-0.5">
                                {p.price} ₪
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => move("new", idx, -1)}
                              title="أعلى"
                            >
                              ▲
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => move("new", idx, +1)}
                              title="أسفل"
                            >
                              ▼
                            </Button>
                            <Button
                              variant="destructive"
                              onClick={() => removeFromList("new", p._id)}
                            >
                              إزالة
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <Button onClick={save} disabled={saving}>
                  {saving ? "جارٍ الحفظ…" : "حفظ التغييرات"}
                </Button>
              </div>
            </section>

            {/* البحث والإضافة */}
            <aside className="rounded-2xl border p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="font-semibold">البحث عن المنتجات</h2>
                <div className="flex items-center gap-2">
                  <button
                    className={`px-3 py-1 rounded ${
                      tab === "recommended"
                        ? "bg-black text-white"
                        : "bg-gray-100"
                    }`}
                    onClick={() => setTab("recommended")}
                  >
                    أضف إلى المقترحة
                  </button>
                  <button
                    className={`px-3 py-1 rounded ${
                      tab === "new" ? "bg-black text-white" : "bg-gray-100"
                    }`}
                    onClick={() => setTab("new")}
                  >
                    أضف إلى وصل حديثًا
                  </button>
                </div>
              </div>
              <Input
                type="text"
                placeholder="اكتب اسم المنتج…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="mt-4 space-y-3 max-h-[60vh] overflow-auto">
                {results.map((p) => {
                  const displayName =
                    getLocalizedText(p.name, locale) || p._id;
                  return (
                    <div
                      key={p._id}
                      className="flex gap-3 items-center border rounded-lg p-2"
                    >
                      <img
                        src={getImage(p)}
                        alt={displayName}
                        className="w-14 h-14 object-cover rounded-md"
                      />
                      <div className="flex-1 text-right">
                        <div className="font-medium line-clamp-1">{displayName}</div>
                        {typeof p.price === "number" && (
                          <div className="text-sm text-gray-500 mt-0.5">
                            {p.price} ₪
                          </div>
                        )}
                      </div>
                      <Button onClick={() => addToList(p)}>
                        {tab === "recommended"
                          ? "إضافة للمقترحة"
                          : "إضافة لوصل حديثًا"}
                      </Button>
                    </div>
                  );
                })}
                {!results.length && query.trim() && (
                  <p className="text-sm text-gray-500 text-center">
                    لا توجد نتائج مطابقة…
                  </p>
                )}
              </div>
            </aside>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
