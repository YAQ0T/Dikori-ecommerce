// src/pages/Products.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Input } from "@/components/ui/input";
import ProductCard from "@/components/ProductCard";
import ProductCardSkeleton from "@/components/common/ProductCardSkeleton";
import CategoryCircles from "@/components/CategoryCircles";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  getLocalizedText,
  ensureLocalizedObject,
  type LocalizedText,
} from "@/lib/localized";
import { useLanguage } from "@/context/LanguageContext";
import { useTranslation } from "@/i18n";
import { useQuery } from "@tanstack/react-query";

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ProductItem = {
  _id: string;
  name: LocalizedText;
  description: LocalizedText;
  images: string[];
  mainCategory?: string;
  subCategory?: string;
  minPrice?: number;
  totalStock?: number;
  price: number;
  quantity: number;
};

type CategoryGroup = { mainCategory: string; subCategories: string[] };

type SettingsCategory = {
  value: string;
  label?: LocalizedText;
  imageUrl?: string;
  order?: number;
};

type SettingsSubCategory = {
  main: string;
  value: string;
  label?: LocalizedText;
  imageUrl?: string;
  order?: number;
};

type SiteSettings = {
  categoryMenu?: {
    main?: SettingsCategory[];
    sub?: SettingsSubCategory[];
  };
};

const PAGE_WINDOW = 5;
const SORT_DEFAULT = "default";
const ALLOWED_SORTS = new Set([
  SORT_DEFAULT,
  "priceAsc",
  "priceDesc",
  "nameAsc",
  "nameDesc",
]);

/** ✅ دالة مساعدة: ما بتضيف ? إلا إذا فيه باراميترات */
function withQuery(base: string, params: URLSearchParams) {
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function buildPageWindow(
  current: number,
  total: number,
  windowSize: number = PAGE_WINDOW
): (number | "ellipsis")[] {
  if (total <= windowSize) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | "ellipsis")[] = [];
  const first = 1;
  const last = total;
  const half = Math.floor(windowSize / 2);
  let start = Math.max(first, current - half);
  let end = Math.min(last, start + windowSize - 1);
  if (end - start + 1 < windowSize)
    start = Math.max(first, end - windowSize + 1);
  if (start > first) {
    pages.push(first);
    if (start > first + 1) pages.push("ellipsis");
  }
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < last) {
    if (end < last - 1) pages.push("ellipsis");
    pages.push(last);
  }
  return pages;
}

function slugifyLabel(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "");
}

const Products: React.FC = () => {
  const { token } = useAuth();
  const { locale } = useLanguage();

  const { t } = useTranslation();

  const location = useLocation();

  const initialSearch = new URLSearchParams(location.search).get("q") ?? "";
  const initialSortParam =
    new URLSearchParams(location.search).get("sort") ?? "";
  const initialSort = ALLOWED_SORTS.has(initialSortParam)
    ? initialSortParam
    : SORT_DEFAULT;

  const settingsQuery = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => {
      const { data } = await api.get("/site-settings");
      return data as SiteSettings;
    },
    staleTime: 5 * 60_000,
  });

  const settings = settingsQuery.data;
  const categoryMenuMain = settings?.categoryMenu?.main || [];
  const categoryMenuSub = settings?.categoryMenu?.sub || [];

  const [selectedMainCategory, setSelectedMainCategory] = useState<string>(
    () => {
      return new URLSearchParams(location.search).get("category") ?? "";
    }
  );
  const [selectedSubCategory, setSelectedSubCategory] = useState(() => {
    return new URLSearchParams(location.search).get("sub") ?? "";
  });

  const [rawSearch, setRawSearch] = useState(initialSearch);
  const [searchTerm, setSearchTerm] = useState(initialSearch);

  const [sortOption, setSortOption] = useState(initialSort);

  const navigate = useNavigate();
  const [currentPage, setCurrentPage] = useState(1);

  const [recentDays, setRecentDays] = useState<number | null>(null);

  const [categoryMenu, setCategoryMenu] = useState<CategoryGroup[]>([]);
  const [loadingCategories, setLoadingCategories] = useState<boolean>(false);

  // 👇 جديد: خريطة صور الفروع من البيانات (تلقائيًا)
  const [subCategoryImagesFromData, setSubCategoryImagesFromData] = useState<
    Record<string, string>
  >({});

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState<number>(-1);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [suggestionsQuery, setSuggestionsQuery] = useState("");

  const translateCategoryLabel = useCallback(
    (value: string, type: "main" | "sub") => {
      if (!value) return value;
      const slug = slugifyLabel(value);
      if (!slug) return value;
      return t(`productsPage.categoryLabels.${type}.${slug}`, {
        defaultValue: value,
      });
    },
    [t]
  );

  const categoryLabelMapper = useCallback(
    (value: string, type: "main" | "sub") => {
      if (!value) return value;
      if (type === "main") {
        const found = categoryMenuMain.find((item) => item.value === value);
        if (found?.label) {
          const localized = getLocalizedText(found.label, locale);
          if (localized) return localized;
        }
      } else {
        const found = categoryMenuSub.find(
          (item) =>
            item.value === value &&
            (!selectedMainCategory || item.main === selectedMainCategory)
        );
        if (found?.label) {
          const localized = getLocalizedText(found.label, locale);
          if (localized) return localized;
        }
      }
      return translateCategoryLabel(value, type);
    },
    [
      categoryMenuMain,
      categoryMenuSub,
      locale,
      selectedMainCategory,
      translateCategoryLabel,
    ]
  );

  const mainCategoryImages = useMemo(() => {
    const map: Record<string, string> = {};
    categoryMenuMain.forEach((item) => {
      if (item.value && item.imageUrl) {
        map[item.value] = item.imageUrl;
      }
    });
    return map;
  }, [categoryMenuMain]);

  const subCategoryImages = useMemo(() => {
    const map: Record<string, string> = { ...subCategoryImagesFromData };
    categoryMenuSub.forEach((item) => {
      if (!item.value || !item.imageUrl) return;
      if (item.main) {
        map[`${item.main}:::${item.value}`] = item.imageUrl;
      } else {
        map[item.value] = item.imageUrl;
      }
    });
    return map;
  }, [categoryMenuSub, subCategoryImagesFromData]);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const searchBoxWrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const category = params.get("category") ?? "";
    const sub = params.get("sub") ?? "";
    const q = params.get("q") ?? "";
    const sortParam = params.get("sort") ?? "";
    const sort = ALLOWED_SORTS.has(sortParam) ? sortParam : SORT_DEFAULT;

    setSelectedMainCategory((prev) => (prev === category ? prev : category));
    setSelectedSubCategory((prev) => (prev === sub ? prev : sub));
    setSearchTerm((prev) => (prev === q ? prev : q));
    setRawSearch((prev) => (prev === q ? prev : q));
    setSortOption((prev) => (prev === sort ? prev : sort));
  }, [location.search]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (selectedMainCategory) {
      params.set("category", selectedMainCategory);
    } else {
      params.delete("category");
    }
    if (selectedSubCategory) {
      params.set("sub", selectedSubCategory);
    } else {
      params.delete("sub");
    }
    if (searchTerm) {
      params.set("q", searchTerm);
    } else {
      params.delete("q");
    }
    if (sortOption && sortOption !== SORT_DEFAULT) {
      params.set("sort", sortOption);
    } else {
      params.delete("sort");
    }
    const next = `?${params.toString()}`;
    if (next !== location.search) {
      navigate({ search: next }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMainCategory, selectedSubCategory, searchTerm, sortOption]);

  // ✅ Scroll لأعلى عند تغيير الصفحة
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [currentPage]);

  // (تمت إزالة فلاتر المقاسات والألوان حسب طلبك)

  const productsQuery = useQuery({
    queryKey: [
      "products",
      currentPage,
      selectedMainCategory,
      selectedSubCategory,
      searchTerm,
      sortOption,
      locale,
      recentDays,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(currentPage));
      params.set("limit", "9");
      if (selectedMainCategory) {
        params.set("mainCategory", selectedMainCategory);
      }
      if (selectedSubCategory) params.set("subCategory", selectedSubCategory);
      if (searchTerm) params.set("q", searchTerm);
      if (sortOption && sortOption !== SORT_DEFAULT)
        params.set("sort", sortOption);
      if (locale) params.set("locale", locale);
      if (recentDays && recentDays > 0) {
        params.set("days", String(recentDays));
      }

      const endpoint =
        recentDays && recentDays > 0
          ? "/products/recent-updates"
          : "/products/with-stats";
      const url = withQuery(endpoint, params);
      const res = await api.get(url);
      const {
        items,
        totalPages: tp,
        total,
      } = res.data || {
        items: [],
        totalPages: 1,
        total: 0,
      };

      const mapped: ProductItem[] = (items || []).map((p: any) => ({
        _id: p._id,
        name: ensureLocalizedObject(p.name),
        description: ensureLocalizedObject(p.description),
        images: Array.isArray(p.images) ? p.images : [],
        mainCategory: p.mainCategory,
        subCategory: p.subCategory,
        minPrice: p.minPrice,
        totalStock: p.totalStock,
        price: typeof p.minPrice === "number" ? p.minPrice : 0,
        quantity: typeof p.totalStock === "number" ? p.totalStock : 0,
      }));

      return {
        items: mapped,
        totalPages: tp || 1,
        total: typeof total === "number" ? total : mapped.length,
      };
    },
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const products = productsQuery.data?.items ?? [];
  const totalPages = productsQuery.data?.totalPages ?? 1;
  const recentTotal =
    recentDays && productsQuery.data ? productsQuery.data.total : null;
  const error = productsQuery.isError ? t("productsPage.error") : null;

  useEffect(() => {
    if (!products.length) return;
    setSubCategoryImagesFromData((prev) => {
      const next = { ...prev };
      for (const p of products) {
        if (!p?.mainCategory || !p?.subCategory) continue;
        const key = `${p.mainCategory}:::${p.subCategory}`;
        if (!next[key]) {
          const img =
            Array.isArray(p.images) && p.images[0] ? p.images[0] : "";
          if (img) next[key] = img;
        }
      }
      return next;
    });
  }, [products]);

  // جلب شجرة التصنيفات + بناء صور فرعية تمثيلية من أول منتج يظهر لكل فرع
  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoadingCategories(true);
      try {
        const headers = token
          ? { Authorization: `Bearer ${token}` }
          : undefined;
        const PER_PAGE = 100;
        const firstParams = new URLSearchParams();
        firstParams.set("page", "1");
        firstParams.set("limit", String(PER_PAGE));

        const firstUrl = `/products/with-stats?${firstParams.toString()}`;
        const firstRes = await api.get(firstUrl, { headers });
        if (ignore) return;

        const firstData = firstRes.data || { items: [], totalPages: 1 };
        const totalPagesAll = Math.max(1, Number(firstData.totalPages) || 1);

        const map = new Map<string, Set<string>>();
        // 👇 خريطة صور الفروع من كامل البيانات (أول صورة لأول منتج يصادفنا)
        const subImg = new Map<string, string>();

        const consume = (items: any[]) => {
          for (const p of items || []) {
            const main = p?.mainCategory;
            const sub = p?.subCategory;
            if (!main) continue;

            // بناء شجرة التصنيفات
            if (!map.has(main)) map.set(main, new Set<string>());
            if (sub) map.get(main)!.add(sub);

            // بناء صورة الفرع
            if (sub) {
              const key = `${main}:::${sub}`;
              if (!subImg.has(key)) {
                const img =
                  Array.isArray(p?.images) && p.images[0] ? p.images[0] : "";
                if (img) subImg.set(key, img);
              }
            }
          }
        };

        consume(firstData.items || []);

        const MAX_PAGES = 20;
        const pagesToFetch = Math.min(totalPagesAll, MAX_PAGES);

        const requests: Promise<any>[] = [];
        for (let page = 2; page <= pagesToFetch; page++) {
          const params = new URLSearchParams();
          params.set("page", String(page));
          params.set("limit", String(PER_PAGE));
          const url = `/products/with-stats?${params.toString()}`;
          requests.push(
            api
              .get(url, { headers })
              .then((res) => res.data)
              .catch(() => null)
          );
        }

        const pages = await Promise.all(requests);
        if (ignore) return;

        for (const pageData of pages) {
          if (!pageData?.items) continue;
          consume(pageData.items);
        }

        const groups: CategoryGroup[] = Array.from(map.entries()).map(
          ([main, subs]) => ({
            mainCategory: main,
            subCategories: Array.from(subs.values()),
          })
        );

        groups.sort((a, b) =>
          a.mainCategory.localeCompare(b.mainCategory, "ar")
        );
        groups.forEach((g) =>
          g.subCategories.sort((a, b) => a.localeCompare(b, "ar"))
        );

        setCategoryMenu(groups);

        // حفظ صور الفروع المُستخلَصة
        setSubCategoryImagesFromData((prev) => {
          const merged = { ...prev };
          for (const [k, v] of subImg.entries()) {
            if (!merged[k]) merged[k] = v;
          }
          return merged;
        });
      } catch {
        // تجاهل الخطأ للحفاظ على القائمة الحالية
      } finally {
        setLoadingCategories(false);
      }
    })();

    return () => {
      ignore = true;
    };
  }, [token]);

  const fetchSuggestions = useCallback(async () => {
    const term = rawSearch.trim();
    if (!term || term.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      setSuggestionsError(null);
      setSuggestionsQuery("");
      return;
    }

    setSuggestionsLoading(true);
    setSuggestionsError(null);
    setSuggestionsQuery(term);
    setShowSuggestions(true);

    try {
      const params: Record<string, string> = { q: term, limit: "8" };
      const res = await api.get("/products/suggest", { params });
      const items = Array.isArray(res.data?.items) ? res.data.items : [];
      const names = Array.from(
        new Set(
          items
            .map((p: any) => getLocalizedText(p?.name, locale))
            .filter(
              (n: string | undefined) => typeof n === "string" && n.trim()
            )
        )
      ) as string[];
      setSuggestions(names);
      setShowSuggestions(true);
      setHighlightIndex(-1);
    } catch (err) {
      console.error("failed to fetch suggestions", err);
      setSuggestions([]);
      setSuggestionsError(t("productsPage.filters.suggestionsError"));
      setShowSuggestions(true);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [rawSearch, locale, t]);

  useEffect(() => {
    let active = true;
    const term = rawSearch.trim();
    if (!term) {
      setSuggestions([]);
      setShowSuggestions(false);
      setSuggestionsError(null);
      setSuggestionsQuery("");
      setSuggestionsLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      if (!active) return;
      fetchSuggestions();
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [rawSearch, fetchSuggestions]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!searchBoxWrapperRef.current) return;
      if (!searchBoxWrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
        setHighlightIndex(-1);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const handleCategorySelect = (main: string, sub: string = "") => {
    if (main === selectedMainCategory && sub === selectedSubCategory) return;
    setSelectedMainCategory(main);
    setSelectedSubCategory(sub);
    setCurrentPage(1);
  };

  const categoryGroups = useMemo(() => {
    return products.reduce((acc, product) => {
      const { mainCategory, subCategory, images } = product;
      if (!mainCategory) return acc;

      const existing = acc.find(
        (cat: { mainCategory: string; subCategories: string[] }) =>
          cat.mainCategory === mainCategory
      );
      if (existing) {
        if (subCategory && !existing.subCategories.includes(subCategory)) {
          existing.subCategories.push(subCategory);
        }
      } else {
        acc.push({
          mainCategory,
          subCategories: subCategory ? [subCategory] : [],
        });
      }

      // 👇 تعزيز صور الفروع أيضًا من المنتجات الحالية
      if (mainCategory && subCategory) {
        const key = `${mainCategory}:::${subCategory}`;
        if (!subCategoryImagesFromData[key]) {
          const img = Array.isArray(images) && images[0] ? images[0] : "";
          if (img) {
            setSubCategoryImagesFromData((prev) => ({
              ...prev,
              [key]: img,
            }));
          }
        }
      }

      return acc;
    }, [] as { mainCategory: string; subCategories: string[] }[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  const triggerSearch = (value?: string) => {
    const next = (value ?? rawSearch).trim();
    setRawSearch(next);
    setSearchTerm(next);
    setShowSuggestions(false);
    setHighlightIndex(-1);
  };

  const clearSearch = () => {
    setRawSearch("");
    setSearchTerm("");
    setSuggestions([]);
    setShowSuggestions(false);
    setHighlightIndex(-1);
    setSuggestionsError(null);
    setSuggestionsQuery("");
  };

  const renderHighlighted = (text: string) => {
    if (!suggestionsQuery) return text;
    const source = text.toLowerCase();
    const target = suggestionsQuery.toLowerCase();
    const idx = source.indexOf(target);
    if (idx < 0) return text;
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + target.length);
    const after = text.slice(idx + target.length);
    return (
      <>
        {before}
        <mark className="bg-amber-200/70 text-black rounded px-0.5">
          {match}
        </mark>
        {after}
      </>
    );
  };

  const handleSearchKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (
    e
  ) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!showSuggestions) setShowSuggestions(true);
      setHighlightIndex((prev) =>
        Math.min((prev < 0 ? -1 : prev) + 1, suggestions.length - 1)
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (showSuggestions && highlightIndex >= 0) {
        const chosen = suggestions[highlightIndex];
        if (chosen) {
          triggerSearch(chosen);
          return;
        }
      }
      triggerSearch();
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setHighlightIndex(-1);
    }
  };

  const isInitialLoading = productsQuery.isLoading && products.length === 0;

  const pageItems = buildPageWindow(currentPage, totalPages, PAGE_WINDOW);

  return (
    <>
      <Navbar />
      <main className="container mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl md:text-3xl font-bold text-right">
            {t("productsPage.title")}
          </h1>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setRecentDays((prev) => {
                  const next = prev ? null : 7;
                  setCurrentPage(1);
                  return next;
                });
              }}
              className={`hidden relative px-3 py-2 rounded transition-colors duration-200 ${
                recentDays
                  ? "bg-black text-white"
                  : "bg-gray-100 text-black hover:bg-gray-300"
              }`}
              title={t("productsPage.recentUpdates.tooltip")}
            >
              {recentDays
                ? t("productsPage.recentUpdates.showAll")
                : t("productsPage.recentUpdates.showRecent")}
              {recentDays && typeof recentTotal === "number" && (
                <span className="absolute -top-2 -right-2 text-xs rounded-full bg-red-600 text-white px-2 py-0.5">
                  {recentTotal}
                </span>
              )}
            </button>

            {recentDays && (
              <select
                className="border rounded px-2 py-2"
                value={recentDays}
                onChange={(e) => {
                  const v = parseInt(e.target.value || "7", 10);
                  setRecentDays(Number.isFinite(v) && v > 0 ? v : 7);
                  setCurrentPage(1);
                }}
                title={t("productsPage.recentUpdates.daysTitle")}
              >
                <option value={7}>
                  {t("productsPage.recentUpdates.daysOptions.7")}
                </option>
                <option value={14}>
                  {t("productsPage.recentUpdates.daysOptions.14")}
                </option>
                <option value={30}>
                  {t("productsPage.recentUpdates.daysOptions.30")}
                </option>
              </select>
            )}
          </div>
        </div>

        {/* ✅ الدوائر بالأعلى + تمرير صور الفروع التلقائية */}
        <CategoryCircles
          categories={categoryMenu.length ? categoryMenu : categoryGroups}
          onFilter={handleCategorySelect}
          selectedMain={selectedMainCategory}
          selectedSub={selectedSubCategory}
          loading={loadingCategories}
          subCategoryImages={subCategoryImages}
          mainCategoryImages={mainCategoryImages}
          labelMapper={categoryLabelMapper}
        />

        {/* فلاتر */}
        <section className="mt-4">
          <div className="surface-card p-4">
          <div className="grid grid-cols-1 lg:grid-cols-[1.6fr,0.6fr] gap-3 mb-4 items-center">
            <div className="relative w-full" ref={searchBoxWrapperRef}>
              <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-2 shadow-sm transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-primary/20">
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  className="text-muted-foreground"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <Input
                  ref={searchRef}
                  type="text"
                  placeholder={t("productsPage.filters.searchPlaceholder")}
                  value={rawSearch}
                  autoComplete="off"
                  onChange={(e) => {
                    setRawSearch(e.target.value);
                    setShowSuggestions(true);
                    setHighlightIndex(-1);
                  }}
                  onKeyDown={handleSearchKeyDown}
                  className="h-10 border-0 bg-transparent px-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                {(rawSearch || searchTerm) && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="text-gray-400 transition-colors hover:text-gray-700"
                    title={t("productsPage.filters.clearSearch")}
                    aria-label={t("productsPage.filters.clearSearch")}
                  >
                    ✕
                  </button>
                )}
                <button
                  type="button"
                  className="h-9 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  onClick={() => triggerSearch()}
                  title={t("productsPage.filters.searchButtonTitle")}
                >
                  {t("productsPage.filters.searchButtonTitle")}
                </button>
              </div>

              {showSuggestions && (
                <ul
                  className="absolute top-full mt-2 w-full z-20 bg-card border border-border rounded-2xl shadow-lg max-h-64 overflow-auto text-right"
                  role="listbox"
                >
                  {suggestionsLoading ? (
                    <li className="px-3 py-2 text-sm text-muted-foreground">
                      {t("productsPage.filters.suggestionsLoading")}
                    </li>
                  ) : suggestionsError ? (
                    <li className="px-3 py-2 text-sm text-red-600">
                      {suggestionsError}
                    </li>
                  ) : suggestions.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-muted-foreground">
                      {t("productsPage.filters.suggestionsEmpty")}
                    </li>
                  ) : (
                    suggestions.map((s, idx) => (
                      <li
                        key={`${s}-${idx}`}
                        role="option"
                        aria-selected={idx === highlightIndex}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          triggerSearch(s);
                        }}
                        className={`px-3 py-2 cursor-pointer transition-colors ${
                          idx === highlightIndex
                            ? "bg-amber-100"
                            : "hover:bg-amber-50"
                        }`}
                      >
                        {renderHighlighted(s)}
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
            <Select
              value={sortOption}
              onValueChange={(value) => {
                setSortOption(value);
                setCurrentPage(1);
              }}
            >
              <SelectTrigger
                className="h-11 rounded-2xl border border-border bg-card px-4 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20 text-right"
                title={t("productsPage.filters.sortLabel")}
              >
                <SelectValue
                  placeholder={t("productsPage.filters.sortLabel")}
                />
              </SelectTrigger>
              <SelectContent className="w-[var(--radix-select-trigger-width)]">
                <SelectItem value="default">
                  {t("productsPage.filters.sortOptions.default")}
                </SelectItem>
                <SelectItem value="priceAsc">
                  {t("productsPage.filters.sortOptions.priceAsc")}
                </SelectItem>
                <SelectItem value="priceDesc">
                  {t("productsPage.filters.sortOptions.priceDesc")}
                </SelectItem>
                <SelectItem value="nameAsc">
                  {t("productsPage.filters.sortOptions.nameAsc")}
                </SelectItem>
                <SelectItem value="nameDesc">
                  {t("productsPage.filters.sortOptions.nameDesc")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* تمت إزالة فلاتر الألوان والمقاسات حسب الطلب */}
          </div>
        </section>

        {error && (
          <div className="surface-card p-4 text-right mb-4">
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        )}

        {isInitialLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 md:gap-6 items-start">
            {Array.from({ length: 8 }).map((_, idx) => (
              <ProductCardSkeleton key={`products-skeleton-${idx}`} />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="surface-card p-6 text-right">
            <p className="text-sm text-muted-foreground">
              {t("productsPage.emptyState")}
            </p>
          </div>
        ) : (
          <>
            {/* ✅ عمودين على الموبايل، 3 أعمدة من md وفوق */}
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 md:gap-6 items-start">
              {products.map((product) => (
                <ProductCard key={product._id} product={product} />
              ))}
            </div>

            <div className="mt-6 flex flex-col items-center gap-4">
              <div className="sm:hidden w-full">
                <div className="w-full overflow-x-auto">
                  <Pagination>
                    <PaginationContent className="justify-center">
                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          aria-disabled={currentPage === totalPages}
                          className={
                            currentPage === totalPages
                              ? "pointer-events-none opacity-50"
                              : ""
                          }
                          onClick={(e) => {
                            e.preventDefault();
                            if (currentPage < totalPages)
                              setCurrentPage((p) =>
                                Math.min(totalPages, p + 1)
                              );
                          }}
                        />
                      </PaginationItem>

                      <PaginationItem>
                        <PaginationLink
                          href="#"
                          isActive
                          onClick={(e) => e.preventDefault()}
                          className="text-xs px-2"
                        >
                          {currentPage} / {totalPages}
                        </PaginationLink>
                      </PaginationItem>

                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          aria-disabled={currentPage === 1}
                          className={
                            currentPage === 1
                              ? "pointer-events-none opacity-50"
                              : ""
                          }
                          onClick={(e) => {
                            e.preventDefault();
                            if (currentPage > 1)
                              setCurrentPage((p) => Math.max(1, p - 1));
                          }}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>

                <div className="mt-3 flex items-center justify-center gap-2">
                  <span className="text-sm text-gray-700">
                    {t("productsPage.pagination.goTo")}
                  </span>
                  <Select
                    value={String(currentPage)}
                    onValueChange={(v) => setCurrentPage(Number(v))}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue
                        placeholder={t(
                          "productsPage.pagination.selectPlaceholder"
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                        (p) => (
                          <SelectItem key={p} value={String(p)}>
                            {p}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="hidden sm:flex flex-col items-center gap-3 w-full">
                <div className="w-full overflow-x-auto">
                  <Pagination>
                    <PaginationContent className="rtl:flex-row-reverse justify-center">
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          aria-disabled={currentPage === 1}
                          className={
                            currentPage === 1
                              ? "pointer-events-none opacity-50"
                              : ""
                          }
                          onClick={(e) => {
                            e.preventDefault();
                            if (currentPage > 1)
                              setCurrentPage((p) => Math.max(1, p - 1));
                          }}
                        />
                      </PaginationItem>

                      {pageItems.map((item, idx) =>
                        item === "ellipsis" ? (
                          <PaginationItem key={`ellipsis-${idx}`}>
                            <PaginationEllipsis />
                          </PaginationItem>
                        ) : (
                          <PaginationItem key={item}>
                            <PaginationLink
                              href="#"
                              isActive={currentPage === item}
                              onClick={(e) => {
                                e.preventDefault();
                                setCurrentPage(item);
                              }}
                            >
                              {item}
                            </PaginationLink>
                          </PaginationItem>
                        )
                      )}

                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          aria-disabled={currentPage === totalPages}
                          className={
                            currentPage === totalPages
                              ? "pointer-events-none opacity-50"
                              : ""
                          }
                          onClick={(e) => {
                            e.preventDefault();
                            if (currentPage < totalPages)
                              setCurrentPage((p) =>
                                Math.min(totalPages, p + 1)
                              );
                          }}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700">
                    {t("productsPage.pagination.goToPage")}
                  </span>
                  <Select
                    value={String(currentPage)}
                    onValueChange={(v) => setCurrentPage(Number(v))}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue
                        placeholder={t(
                          "productsPage.pagination.selectPlaceholder"
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent className="max-h-40 overflow-y-auto">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                        (p) => (
                          <SelectItem key={p} value={String(p)}>
                            {p}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-gray-500">
                    {t("productsPage.pagination.total", { count: totalPages })}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
      <Footer />
    </>
  );
};

export default Products;
