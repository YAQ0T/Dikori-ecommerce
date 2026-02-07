import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import {
  emptyLocalized,
  ensureLocalizedObject,
  type LocalizedObject,
} from "@/lib/localized";
import { Loader2, Plus, Trash, ArrowUp, ArrowDown } from "lucide-react";
import i18n from "@/i18n";

type Localized = LocalizedObject;

type HeroState = {
  kicker: Localized;
  title: Localized;
  subtitle: Localized;
  imageUrl: string;
  calloutLabel: Localized;
  calloutValue: Localized;
  primaryCtaLabel: Localized;
  secondaryCtaLabel: Localized;
};

type HeroLocalizedField =
  | "kicker"
  | "title"
  | "subtitle"
  | "calloutLabel"
  | "calloutValue"
  | "primaryCtaLabel"
  | "secondaryCtaLabel";

type CategoryItem = {
  value: string;
  label: Localized;
  imageUrl: string;
  order?: number;
  prevValue?: string;
};

type SubCategoryItem = {
  main: string;
  value: string;
  label: Localized;
  imageUrl: string;
  order?: number;
  prevMain?: string;
  prevValue?: string;
};

type SiteSettings = {
  seeded?: boolean;
  hero?: Partial<HeroState>;
  homeCategories?: CategoryItem[];
  categoryMenu?: {
    main?: CategoryItem[];
    sub?: SubCategoryItem[];
  };
};

const createHeroState = (raw?: Partial<HeroState>): HeroState => ({
  kicker: ensureLocalizedObject(raw?.kicker),
  title: ensureLocalizedObject(raw?.title),
  subtitle: ensureLocalizedObject(raw?.subtitle),
  imageUrl: raw?.imageUrl || "",
  calloutLabel: ensureLocalizedObject(raw?.calloutLabel),
  calloutValue: ensureLocalizedObject(raw?.calloutValue),
  primaryCtaLabel: ensureLocalizedObject(raw?.primaryCtaLabel),
  secondaryCtaLabel: ensureLocalizedObject(raw?.secondaryCtaLabel),
});

const normalizeCategory = (raw?: Partial<CategoryItem>): CategoryItem => {
  const value = raw?.value || "";
  const prevValue =
    typeof raw?.prevValue === "string" ? raw?.prevValue : value;
  return {
    value,
    label: ensureLocalizedObject(raw?.label),
    imageUrl: raw?.imageUrl || "",
    order: typeof raw?.order === "number" ? raw?.order : 0,
    prevValue,
  };
};

const normalizeSubCategory = (raw?: Partial<SubCategoryItem>): SubCategoryItem => {
  const main = raw?.main || "";
  const value = raw?.value || "";
  const prevMain =
    typeof raw?.prevMain === "string" ? raw?.prevMain : main;
  const prevValue =
    typeof raw?.prevValue === "string" ? raw?.prevValue : value;
  return {
    main,
    value,
    label: ensureLocalizedObject(raw?.label),
    imageUrl: raw?.imageUrl || "",
    order: typeof raw?.order === "number" ? raw?.order : 0,
    prevMain,
    prevValue,
  };
};

const emptyHero = createHeroState({});

const createEmptyCategory = (): CategoryItem => ({
  value: "",
  label: { ...emptyLocalized },
  imageUrl: "",
  order: 0,
  prevValue: "",
});

const createEmptySubCategory = (): SubCategoryItem => ({
  main: "",
  value: "",
  label: { ...emptyLocalized },
  imageUrl: "",
  order: 0,
  prevMain: "",
  prevValue: "",
});

const slugifyLabel = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "");

const mergeLocalized = (base: Localized, override: Localized) => ({
  ar: override.ar?.trim() ? override.ar : base.ar,
  he: override.he?.trim() ? override.he : base.he,
});

const SiteSettingsEditor: React.FC<{
  token?: string | null;
  categoryMap?: Record<string, Set<string>>;
  subCategoryImageDefaults?: Record<string, string>;
}> = ({ token, categoryMap, subCategoryImageDefaults = {} }) => {
  const MAIN_CATEGORY_IMAGE_DEFAULTS: Record<string, string> = {
    "لوازم نجارين": "https://i.imgur.com/aPYhaQW.png",
    "لوازم منجدين": "https://i.imgur.com/S9rjrsh.png",
    "مقابض ابواب": "https://i.imgur.com/UskLo6H.png",
    "لوازم المنيوم": "https://i.imgur.com/ntKbBKD.png",
    "مقابض خزائن": "https://i.imgur.com/AEyMjHc.png",
    "اكسسوارات مطابخ": "https://i.imgur.com/hlpu1oK.png",
    "اكسسوارات غرف نوم": "https://i.imgur.com/ZMr397G.png",
    "عدة وأدوات": "https://i.imgur.com/Hf5NvqJ.png",
    "مفصلات نجارين والامنيوم": "https://i.imgur.com/XHNtA14.png",
    "جوارير وسكك ومفصلات": "https://i.imgur.com/fE6zgKp.png",
    "أقمشة كنب": "https://i.imgur.com/bf8geWx.jpeg",
    "أصناف اضافية": "https://www.svgrepo.com/show/491692/plus-circle.svg",
    "لوازم أبواب": "https://i.imgur.com/UskLo6H.png",
    "كبسات مسامير و براغي": "https://i.imgur.com/CntFVhx.png",
  };

  const SUBCATEGORY_IMAGE_DEFAULTS: Record<string, string> = {
    "أرجل طاولات": "https://i.imgur.com/25nxJlt.png",
  };

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  const [hero, setHero] = useState<HeroState>(emptyHero);
  const [homeCategories, setHomeCategories] = useState<CategoryItem[]>([]);
  const [menuMain, setMenuMain] = useState<CategoryItem[]>([]);
  const [menuSub, setMenuSub] = useState<SubCategoryItem[]>([]);

  const headers = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token]
  );

  const tAr = useMemo(() => i18n.getFixedT("ar"), []);
  const tHe = useMemo(() => i18n.getFixedT("he"), []);

  const defaultHero = useMemo((): HeroState => {
    return {
      kicker: {
        ar: tAr("home.hero.kicker"),
        he: tHe("home.hero.kicker"),
      },
      title: {
        ar: tAr("home.hero.title"),
        he: tHe("home.hero.title"),
      },
      subtitle: {
        ar: tAr("home.hero.subtitle"),
        he: tHe("home.hero.subtitle"),
      },
      imageUrl: "/hero.jpg",
      calloutLabel: {
        ar: tAr("home.hero.calloutLabel"),
        he: tHe("home.hero.calloutLabel"),
      },
      calloutValue: {
        ar: tAr("home.hero.calloutValue"),
        he: tHe("home.hero.calloutValue"),
      },
      primaryCtaLabel: {
        ar: tAr("home.actions.startShopping"),
        he: tHe("home.actions.startShopping"),
      },
      secondaryCtaLabel: {
        ar: tAr("home.actions.exploreCategories"),
        he: tHe("home.actions.exploreCategories"),
      },
    };
  }, [tAr, tHe]);

  const defaultHomeCategories = useMemo((): CategoryItem[] => {
    const arList = (tAr("home.categories", {
      returnObjects: true,
    }) || []) as Array<{ value?: string; label?: string; img?: string }>;
    const heList = (tHe("home.categories", {
      returnObjects: true,
    }) || []) as Array<{ value?: string; label?: string }>;
    const heMap = new Map<string, string>();
    heList.forEach((item) => {
      if (item.value && item.label) {
        heMap.set(item.value, item.label);
      }
    });

    return arList.map((item, idx) => ({
      value: item.value || item.label || `cat-${idx}`,
      label: {
        ar: item.label || item.value || "",
        he: heMap.get(item.value || "") || "",
      },
      imageUrl: item.img || "",
      order: idx,
    }));
  }, [tAr, tHe]);

  const menuDefaults = useMemo(() => {
    if (!categoryMap) {
      return { main: [] as CategoryItem[], sub: [] as SubCategoryItem[] };
    }
    const main = Object.keys(categoryMap)
      .filter((item) => item)
      .sort((a, b) => a.localeCompare(b, "ar"))
      .map((value, idx) => {
        const slug = slugifyLabel(value);
        return {
          value,
          label: {
            ar: tAr(`productsPage.categoryLabels.main.${slug}`, {
              defaultValue: value,
            }),
            he: tHe(`productsPage.categoryLabels.main.${slug}`, {
              defaultValue: value,
            }),
          },
          imageUrl: MAIN_CATEGORY_IMAGE_DEFAULTS[value] || "",
          order: idx,
        };
      });

    const sub: SubCategoryItem[] = [];
    main.forEach((mainItem) => {
      const subs = categoryMap[mainItem.value] || new Set<string>();
      Array.from(subs)
        .filter((s) => s)
        .sort((a, b) => a.localeCompare(b, "ar"))
        .forEach((value, idx) => {
          const slug = slugifyLabel(value);
          const compositeKey = `${mainItem.value}:::${value}`;
          sub.push({
            main: mainItem.value,
            value,
            label: {
              ar: tAr(`productsPage.categoryLabels.sub.${slug}`, {
                defaultValue: value,
              }),
              he: tHe(`productsPage.categoryLabels.sub.${slug}`, {
                defaultValue: value,
              }),
            },
            imageUrl:
              subCategoryImageDefaults[compositeKey] ||
              subCategoryImageDefaults[value] ||
              SUBCATEGORY_IMAGE_DEFAULTS[compositeKey] ||
              SUBCATEGORY_IMAGE_DEFAULTS[value] ||
              "",
            order: idx,
          });
        });
    });

    return { main, sub };
  }, [
    categoryMap,
    tAr,
    tHe,
    MAIN_CATEGORY_IMAGE_DEFAULTS,
    SUBCATEGORY_IMAGE_DEFAULTS,
    subCategoryImageDefaults,
  ]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .get("/site-settings")
      .then((res) => {
        if (!active) return;
        const data = (res?.data || {}) as SiteSettings;
        const hasSeeded = Boolean(data?.seeded);
        setSeeded(hasSeeded);

        const heroFromData = createHeroState(data.hero);
        if (!hasSeeded) {
          setHero({
            kicker: mergeLocalized(defaultHero.kicker, heroFromData.kicker),
            title: mergeLocalized(defaultHero.title, heroFromData.title),
            subtitle: mergeLocalized(defaultHero.subtitle, heroFromData.subtitle),
            imageUrl: heroFromData.imageUrl || defaultHero.imageUrl,
            calloutLabel: mergeLocalized(
              defaultHero.calloutLabel,
              heroFromData.calloutLabel
            ),
            calloutValue: mergeLocalized(
              defaultHero.calloutValue,
              heroFromData.calloutValue
            ),
            primaryCtaLabel: mergeLocalized(
              defaultHero.primaryCtaLabel,
              heroFromData.primaryCtaLabel
            ),
            secondaryCtaLabel: mergeLocalized(
              defaultHero.secondaryCtaLabel,
              heroFromData.secondaryCtaLabel
            ),
          });
        } else {
          setHero(heroFromData);
        }

        const homeCats = Array.isArray(data.homeCategories)
          ? data.homeCategories.map((item) => normalizeCategory(item))
          : [];
        setHomeCategories(
          !hasSeeded && homeCats.length === 0
            ? defaultHomeCategories.map((item) => normalizeCategory(item))
            : homeCats
        );

        const mainCats = Array.isArray(data.categoryMenu?.main)
          ? data.categoryMenu.main.map((item) => normalizeCategory(item))
          : [];
        setMenuMain(
          !hasSeeded && mainCats.length === 0
            ? menuDefaults.main.map((item) => normalizeCategory(item))
            : mainCats
        );

        const subCats = Array.isArray(data.categoryMenu?.sub)
          ? data.categoryMenu.sub.map((item) => normalizeSubCategory(item))
          : [];
        setMenuSub(
          !hasSeeded && subCats.length === 0
            ? menuDefaults.sub.map((item) => normalizeSubCategory(item))
            : subCats
        );
      })
      .catch((err) => {
        if (!active) return;
        console.error("Failed to load site settings", err);
        setError("تعذّر تحميل إعدادات الموقع");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (seeded) return;
    if (!homeCategories.length && defaultHomeCategories.length) {
      setHomeCategories(
        defaultHomeCategories.map((item) => normalizeCategory(item))
      );
    }
  }, [seeded, homeCategories.length, defaultHomeCategories]);

  useEffect(() => {
    if (seeded) return;
    if (!menuMain.length && menuDefaults.main.length) {
      setMenuMain(menuDefaults.main.map((item) => normalizeCategory(item)));
    }
    if (!menuSub.length && menuDefaults.sub.length) {
      setMenuSub(menuDefaults.sub.map((item) => normalizeSubCategory(item)));
    }
  }, [seeded, menuMain.length, menuSub.length, menuDefaults]);

  const updateHeroText = useCallback(
    (field: HeroLocalizedField, locale: "ar" | "he", value: string) => {
      setHero((prev) => ({
        ...prev,
        [field]: {
          ...(prev[field] as Localized),
          [locale]: value,
        },
      }));
    },
    []
  );

  const updateCategory = useCallback(
    (
      setter: React.Dispatch<React.SetStateAction<CategoryItem[]>>,
      index: number,
      field: keyof CategoryItem,
      value: string | number
    ) => {
      setter((prev) =>
        prev.map((item, idx) =>
          idx === index ? { ...item, [field]: value } : item
        )
      );
    },
    []
  );

  const updateCategoryLabel = useCallback(
    (
      setter: React.Dispatch<React.SetStateAction<CategoryItem[]>>,
      index: number,
      locale: "ar" | "he",
      value: string
    ) => {
      setter((prev) =>
        prev.map((item, idx) =>
          idx === index
            ? { ...item, label: { ...item.label, [locale]: value } }
            : item
        )
      );
    },
    []
  );

  const updateSubCategory = useCallback(
    (
      setter: React.Dispatch<React.SetStateAction<SubCategoryItem[]>>,
      index: number,
      field: keyof SubCategoryItem,
      value: string | number
    ) => {
      setter((prev) =>
        prev.map((item, idx) =>
          idx === index ? { ...item, [field]: value } : item
        )
      );
    },
    []
  );

  const updateSubCategoryLabel = useCallback(
    (
      setter: React.Dispatch<React.SetStateAction<SubCategoryItem[]>>,
      index: number,
      locale: "ar" | "he",
      value: string
    ) => {
      setter((prev) =>
        prev.map((item, idx) =>
          idx === index
            ? { ...item, label: { ...item.label, [locale]: value } }
            : item
        )
      );
    },
    []
  );

  const moveItem = useCallback(
    <T,>(
      setter: React.Dispatch<React.SetStateAction<T[]>>,
      index: number,
      direction: -1 | 1
    ) => {
      setter((prev) => {
        const next = [...prev];
        const target = index + direction;
        if (target < 0 || target >= next.length) return prev;
        const tmp = next[index];
        next[index] = next[target];
        next[target] = tmp;
        return next;
      });
    },
    []
  );

  const saveSettings = useCallback(async () => {
    if (!token) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    const cleanCategories = (items: CategoryItem[]) =>
      items
        .map((item) => ({
          ...item,
          value: item.value.trim(),
          imageUrl: item.imageUrl.trim(),
          prevValue:
            typeof item.prevValue === "string" ? item.prevValue.trim() : "",
        }))
        .filter((item) => item.value);

    const cleanSubCategories = (items: SubCategoryItem[]) =>
      items
        .map((item) => ({
          ...item,
          main: item.main.trim(),
          value: item.value.trim(),
          imageUrl: item.imageUrl.trim(),
          prevMain:
            typeof item.prevMain === "string" ? item.prevMain.trim() : "",
          prevValue:
            typeof item.prevValue === "string" ? item.prevValue.trim() : "",
        }))
        .filter((item) => item.main && item.value);

    const payload: SiteSettings = {
      hero,
      homeCategories: cleanCategories(homeCategories),
      categoryMenu: {
        main: cleanCategories(menuMain),
        sub: cleanSubCategories(menuSub),
      },
    };

    try {
      await api.put("/site-settings", payload, { headers });
      setMenuMain((prev) =>
        prev.map((item) => ({
          ...item,
          value: item.value.trim(),
          imageUrl: item.imageUrl.trim(),
          prevValue: item.value.trim(),
        }))
      );
      setMenuSub((prev) =>
        prev.map((item) => ({
          ...item,
          main: item.main.trim(),
          value: item.value.trim(),
          imageUrl: item.imageUrl.trim(),
          prevMain: item.main.trim(),
          prevValue: item.value.trim(),
        }))
      );
      setSuccess("تم حفظ إعدادات الموقع بنجاح ✅");
    } catch (err) {
      console.error("Failed to save site settings", err);
      setError("تعذّر حفظ إعدادات الموقع. حاول مرة أخرى.");
    } finally {
      setSaving(false);
    }
  }, [hero, homeCategories, menuMain, menuSub, token, headers]);

  const fillDefaultMenuImages = useCallback(() => {
    setMenuMain((prev) =>
      prev.map((item) => ({
        ...item,
        imageUrl:
          item.imageUrl?.trim() ||
          MAIN_CATEGORY_IMAGE_DEFAULTS[item.value] ||
          "",
      }))
    );

    setMenuSub((prev) =>
      prev.map((item) => {
        const composite = `${item.main}:::${item.value}`;
        const fallback =
          subCategoryImageDefaults[composite] ||
          subCategoryImageDefaults[item.value] ||
          SUBCATEGORY_IMAGE_DEFAULTS[composite] ||
          SUBCATEGORY_IMAGE_DEFAULTS[item.value] ||
          "";
        return {
          ...item,
          imageUrl: item.imageUrl?.trim() || fallback,
        };
      })
    );
  }, [
    MAIN_CATEGORY_IMAGE_DEFAULTS,
    SUBCATEGORY_IMAGE_DEFAULTS,
    subCategoryImageDefaults,
  ]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        جارٍ تحميل الإعدادات...
      </div>
    );
  }

  return (
    <section className="space-y-8">
      <header>
        <h2 className="text-xl font-semibold">إعدادات الواجهة</h2>
        <p className="text-sm text-muted-foreground mt-1">
          هنا يمكنك تعديل البطل (Hero) وتصنيفات الصفحة الرئيسية وصور/أسماء قوائم المنتجات.
        </p>
        {!seeded && (
          <p className="text-xs text-muted-foreground mt-2">
            القيم المعروضة مأخوذة من الإعدادات الافتراضية الحالية. اضغط حفظ لتثبيتها كإعدادات مخصصة.
          </p>
        )}
      </header>

      {(error || success) && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            error
              ? "bg-red-50 text-red-700"
              : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {error || success}
        </div>
      )}

      <div className="rounded-2xl border p-4 bg-white dark:bg-gray-900">
        <h3 className="font-semibold mb-4">قسم البطل (Hero)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">العنوان العلوي (AR)</label>
            <Input
              value={hero.kicker.ar}
              onChange={(e) => updateHeroText("kicker", "ar", e.target.value)}
              placeholder="نص قصير أعلى العنوان"
            />
          </div>
          <div>
            <label className="text-sm font-medium">العنوان العلوي (HE)</label>
            <Input
              value={hero.kicker.he}
              onChange={(e) => updateHeroText("kicker", "he", e.target.value)}
              placeholder="טקסט עליון"
            />
          </div>

          <div>
            <label className="text-sm font-medium">العنوان الرئيسي (AR)</label>
            <Input
              value={hero.title.ar}
              onChange={(e) => updateHeroText("title", "ar", e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium">العنوان الرئيسي (HE)</label>
            <Input
              value={hero.title.he}
              onChange={(e) => updateHeroText("title", "he", e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium">الوصف (AR)</label>
            <Textarea
              value={hero.subtitle.ar}
              onChange={(e) => updateHeroText("subtitle", "ar", e.target.value)}
              rows={3}
            />
          </div>
          <div>
            <label className="text-sm font-medium">الوصف (HE)</label>
            <Textarea
              value={hero.subtitle.he}
              onChange={(e) => updateHeroText("subtitle", "he", e.target.value)}
              rows={3}
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-sm font-medium">صورة البطل (URL)</label>
            <Input
              value={hero.imageUrl}
              onChange={(e) =>
                setHero((prev) => ({ ...prev, imageUrl: e.target.value }))
              }
              placeholder="https://example.com/hero.jpg"
            />
            {hero.imageUrl && (
              <img
                src={hero.imageUrl}
                alt="hero preview"
                className="mt-3 h-32 w-full object-cover rounded-xl border"
              />
            )}
          </div>

          <div>
            <label className="text-sm font-medium">تسمية البطاقـة (AR)</label>
            <Input
              value={hero.calloutLabel.ar}
              onChange={(e) =>
                updateHeroText("calloutLabel", "ar", e.target.value)
              }
            />
          </div>
          <div>
            <label className="text-sm font-medium">تسمية البطاقـة (HE)</label>
            <Input
              value={hero.calloutLabel.he}
              onChange={(e) =>
                updateHeroText("calloutLabel", "he", e.target.value)
              }
            />
          </div>

          <div>
            <label className="text-sm font-medium">قيمة البطاقـة (AR)</label>
            <Input
              value={hero.calloutValue.ar}
              onChange={(e) =>
                updateHeroText("calloutValue", "ar", e.target.value)
              }
            />
          </div>
          <div>
            <label className="text-sm font-medium">قيمة البطاقـة (HE)</label>
            <Input
              value={hero.calloutValue.he}
              onChange={(e) =>
                updateHeroText("calloutValue", "he", e.target.value)
              }
            />
          </div>

          <div>
            <label className="text-sm font-medium">زر أساسي (AR)</label>
            <Input
              value={hero.primaryCtaLabel.ar}
              onChange={(e) =>
                updateHeroText("primaryCtaLabel", "ar", e.target.value)
              }
            />
          </div>
          <div>
            <label className="text-sm font-medium">زر أساسي (HE)</label>
            <Input
              value={hero.primaryCtaLabel.he}
              onChange={(e) =>
                updateHeroText("primaryCtaLabel", "he", e.target.value)
              }
            />
          </div>

          <div>
            <label className="text-sm font-medium">زر ثانوي (AR)</label>
            <Input
              value={hero.secondaryCtaLabel.ar}
              onChange={(e) =>
                updateHeroText("secondaryCtaLabel", "ar", e.target.value)
              }
            />
          </div>
          <div>
            <label className="text-sm font-medium">زر ثانوي (HE)</label>
            <Input
              value={hero.secondaryCtaLabel.he}
              onChange={(e) =>
                updateHeroText("secondaryCtaLabel", "he", e.target.value)
              }
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border p-4 bg-white dark:bg-gray-900">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">تصنيفات الصفحة الرئيسية</h3>
            <p className="text-xs text-muted-foreground mt-1">
              القيمة يجب أن تطابق اسم التصنيف الرئيسي في المنتجات.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setHomeCategories((prev) => [...prev, createEmptyCategory()])}
          >
            <Plus className="h-4 w-4 ml-2" />
            إضافة تصنيف
          </Button>
        </div>

        <div className="space-y-4">
          {homeCategories.map((item, idx) => (
            <div
              key={`${item.value}-${idx}`}
              className="grid grid-cols-1 md:grid-cols-12 gap-3 border rounded-xl p-3"
            >
              <div className="md:col-span-3">
                <label className="text-xs text-muted-foreground">القيمة</label>
                <Input
                  value={item.value}
                  onChange={(e) =>
                    updateCategory(setHomeCategories, idx, "value", e.target.value)
                  }
                  placeholder="لوازم نجارين"
                />
              </div>
              <div className="md:col-span-3">
                <label className="text-xs text-muted-foreground">العنوان (AR)</label>
                <Input
                  value={item.label.ar}
                  onChange={(e) =>
                    updateCategoryLabel(setHomeCategories, idx, "ar", e.target.value)
                  }
                />
              </div>
              <div className="md:col-span-3">
                <label className="text-xs text-muted-foreground">العنوان (HE)</label>
                <Input
                  value={item.label.he}
                  onChange={(e) =>
                    updateCategoryLabel(setHomeCategories, idx, "he", e.target.value)
                  }
                />
              </div>
              <div className="md:col-span-3">
                <label className="text-xs text-muted-foreground">رابط الصورة</label>
                <Input
                  value={item.imageUrl}
                  onChange={(e) =>
                    updateCategory(setHomeCategories, idx, "imageUrl", e.target.value)
                  }
                  placeholder="https://..."
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">الترتيب</label>
                <Input
                  type="number"
                  value={item.order ?? 0}
                  onChange={(e) =>
                    updateCategory(
                      setHomeCategories,
                      idx,
                      "order",
                      Number(e.target.value || 0)
                    )
                  }
                />
              </div>

              <div className="md:col-span-10 flex items-center gap-2">
                {item.imageUrl && (
                  <img
                    src={item.imageUrl}
                    alt={item.value}
                    className="h-12 w-12 rounded-md object-cover border"
                  />
                )}
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => moveItem(setHomeCategories, idx, -1)}
                    title="أعلى"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => moveItem(setHomeCategories, idx, 1)}
                    title="أسفل"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={() =>
                      setHomeCategories((prev) => prev.filter((_, i) => i !== idx))
                    }
                    title="حذف"
                  >
                    <Trash className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {!homeCategories.length && (
            <p className="text-sm text-muted-foreground">
              لا توجد تصنيفات مخصّصة. سيتم استخدام الافتراضي من الترجمة.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border p-4 bg-white dark:bg-gray-900">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">قوائم المنتجات - التصنيفات الرئيسية</h3>
            <p className="text-xs text-muted-foreground mt-1">
              إذا أدخلت صورة أو عنوان هنا، سيتم استخدامه في قائمة المنتجات.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={fillDefaultMenuImages}>
              تعبئة الصور الافتراضية
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setMenuMain((prev) => [...prev, createEmptyCategory()])
              }
            >
              <Plus className="h-4 w-4 ml-2" />
              إضافة رئيسي
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          {menuMain.map((item, idx) => (
            <div
              key={`${item.value}-${idx}`}
              className="grid grid-cols-1 md:grid-cols-12 gap-3 border rounded-xl p-3"
            >
              <div className="md:col-span-3">
                <label className="text-xs text-muted-foreground">القيمة</label>
                <Input
                  value={item.value}
                  onChange={(e) =>
                    updateCategory(setMenuMain, idx, "value", e.target.value)
                  }
                />
              </div>
              <div className="md:col-span-3">
                <label className="text-xs text-muted-foreground">العنوان (AR)</label>
                <Input
                  value={item.label.ar}
                  onChange={(e) =>
                    updateCategoryLabel(setMenuMain, idx, "ar", e.target.value)
                  }
                />
              </div>
              <div className="md:col-span-3">
                <label className="text-xs text-muted-foreground">العنوان (HE)</label>
                <Input
                  value={item.label.he}
                  onChange={(e) =>
                    updateCategoryLabel(setMenuMain, idx, "he", e.target.value)
                  }
                />
              </div>
              <div className="md:col-span-3">
                <label className="text-xs text-muted-foreground">رابط الصورة</label>
                <Input
                  value={item.imageUrl}
                  onChange={(e) =>
                    updateCategory(setMenuMain, idx, "imageUrl", e.target.value)
                  }
                  placeholder="https://..."
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">الترتيب</label>
                <Input
                  type="number"
                  value={item.order ?? 0}
                  onChange={(e) =>
                    updateCategory(
                      setMenuMain,
                      idx,
                      "order",
                      Number(e.target.value || 0)
                    )
                  }
                />
              </div>

              <div className="md:col-span-10 flex items-center gap-2">
                {item.imageUrl && (
                  <img
                    src={item.imageUrl}
                    alt={item.value}
                    className="h-12 w-12 rounded-md object-cover border"
                  />
                )}
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => moveItem(setMenuMain, idx, -1)}
                    title="أعلى"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => moveItem(setMenuMain, idx, 1)}
                    title="أسفل"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={() => setMenuMain((prev) => prev.filter((_, i) => i !== idx))}
                    title="حذف"
                  >
                    <Trash className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {!menuMain.length && (
            <p className="text-sm text-muted-foreground">
              لا توجد إعدادات مخصّصة للتصنيفات الرئيسية.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border p-4 bg-white dark:bg-gray-900">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">قوائم المنتجات - التصنيفات الفرعية</h3>
            <p className="text-xs text-muted-foreground mt-1">
              حدّد التصنيف الرئيسي + الفرعي بنفس أسماء المنتجات لتطبيق التغيير.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={fillDefaultMenuImages}>
              تعبئة الصور الافتراضية
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setMenuSub((prev) => [...prev, createEmptySubCategory()])
              }
            >
              <Plus className="h-4 w-4 ml-2" />
              إضافة فرعي
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          {menuSub.map((item, idx) => (
            <div
              key={`${item.main}-${item.value}-${idx}`}
              className="grid grid-cols-1 md:grid-cols-12 gap-3 border rounded-xl p-3"
            >
              <div className="md:col-span-3">
                <label className="text-xs text-muted-foreground">الرئيسي</label>
                <Input
                  value={item.main}
                  onChange={(e) =>
                    updateSubCategory(setMenuSub, idx, "main", e.target.value)
                  }
                />
              </div>
              <div className="md:col-span-3">
                <label className="text-xs text-muted-foreground">الفرعي</label>
                <Input
                  value={item.value}
                  onChange={(e) =>
                    updateSubCategory(setMenuSub, idx, "value", e.target.value)
                  }
                />
              </div>
              <div className="md:col-span-3">
                <label className="text-xs text-muted-foreground">العنوان (AR)</label>
                <Input
                  value={item.label.ar}
                  onChange={(e) =>
                    updateSubCategoryLabel(setMenuSub, idx, "ar", e.target.value)
                  }
                />
              </div>
              <div className="md:col-span-3">
                <label className="text-xs text-muted-foreground">العنوان (HE)</label>
                <Input
                  value={item.label.he}
                  onChange={(e) =>
                    updateSubCategoryLabel(setMenuSub, idx, "he", e.target.value)
                  }
                />
              </div>
              <div className="md:col-span-6">
                <label className="text-xs text-muted-foreground">رابط الصورة</label>
                <Input
                  value={item.imageUrl}
                  onChange={(e) =>
                    updateSubCategory(setMenuSub, idx, "imageUrl", e.target.value)
                  }
                  placeholder="https://..."
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">الترتيب</label>
                <Input
                  type="number"
                  value={item.order ?? 0}
                  onChange={(e) =>
                    updateSubCategory(
                      setMenuSub,
                      idx,
                      "order",
                      Number(e.target.value || 0)
                    )
                  }
                />
              </div>
              <div className="md:col-span-4 flex items-center gap-2">
                {item.imageUrl && (
                  <img
                    src={item.imageUrl}
                    alt={item.value}
                    className="h-12 w-12 rounded-md object-cover border"
                  />
                )}
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => moveItem(setMenuSub, idx, -1)}
                    title="أعلى"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => moveItem(setMenuSub, idx, 1)}
                    title="أسفل"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={() => setMenuSub((prev) => prev.filter((_, i) => i !== idx))}
                    title="حذف"
                  >
                    <Trash className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {!menuSub.length && (
            <p className="text-sm text-muted-foreground">
              لا توجد إعدادات مخصّصة للتصنيفات الفرعية.
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={saveSettings} disabled={saving || !token}>
          {saving ? "جارٍ الحفظ..." : "حفظ إعدادات الموقع"}
        </Button>
      </div>
    </section>
  );
};

export default SiteSettingsEditor;
