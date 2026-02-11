import { useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import QuantityInput from "@/components/common/QuantityInput";
import { useCart } from "@/context/CartContext";
import { useFavorites, type FavoriteProduct } from "@/context/FavoritesContext";
import { getLocalizedText, type LocalizedObject } from "@/lib/localized";
import { getColorLabel } from "@/lib/colors";
import { dispatchCartHighlight } from "@/lib/cartHighlight";
import { useLanguage } from "@/context/LanguageContext";
import { useTranslation } from "@/i18n";
import clsx from "clsx";
import {
  Heart,
  ChevronLeft,
  ChevronRight,
  ShoppingBag,
  Loader2,
  Check,
} from "lucide-react";
import { parseProductDescription } from "@/lib/productDescription";

/* ========== الأنواع ========== */
type Variant = {
  _id: string;
  product: string;
  measure: string;
  measureUnit?: string;
  measureSlug: string;
  color: { name: string; code?: string; images?: string[] };
  colorSlug: string;
  price: {
    amount: number;
    compareAt?: number;
    discount?: {
      type?: "percent" | "amount";
      value?: number;
      startAt?: string;
      endAt?: string;
    };
  };
  stock: { inStock: number; sku: string };
  trackQuantity?: boolean;
  tags: string[];
  // قد تأتي من السيرفر لكن لن نعتمد عليها:
  finalAmount?: number;
  isDiscountActive?: boolean;
  displayCompareAt?: number | null;
};
const MAX_ORDER_QTY = 999999;

type TimeUnit = "days" | "hours" | "minutes" | "seconds";

/* ========== مساعدات عامة ========== */
const clamp = (n: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, n));

const normalize = (s?: string) =>
  (s || "").trim().replace(/\s+/g, "").toLowerCase();
const isUnified = (s?: string) => normalize(s) === normalize("موحد");

/** يُرجع دائمًا مصفوفة المتغيّرات سواء كانت الاستجابة {items:[]} أو [] مباشرة */
function normalizeVariantsResponse(data: any): Variant[] {
  if (data && Array.isArray(data.items)) return data.items as Variant[];
  if (Array.isArray(data)) return data as Variant[];
  return [];
}

/** تنسيق الوقت المتبقي للمؤقّت */
const formatTimeLeft = (
  ms: number
): { expired: boolean; parts: { unit: TimeUnit; value: number }[] } => {
  if (ms <= 0) return { expired: true, parts: [] };

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return {
      expired: false,
      parts: [
        { unit: "days", value: days },
        { unit: "hours", value: hours },
        { unit: "minutes", value: minutes },
      ],
    };
  }

  if (hours > 0) {
    return {
      expired: false,
      parts: [
        { unit: "hours", value: hours },
        { unit: "minutes", value: minutes },
        { unit: "seconds", value: seconds },
      ],
    };
  }

  return {
    expired: false,
    parts: [
      { unit: "minutes", value: minutes },
      { unit: "seconds", value: seconds },
    ],
  };
};

/* ========== تسعير موحّد محليًا (نفس منطق البطاقة) ========== */
function computeVariantPricing(v?: Variant, nowTs = Date.now()) {
  if (!v) {
    return {
      final: undefined as number | undefined,
      compare: undefined as number | undefined,
      discountActive: false,
      discountPercent: null as number | null,
      window: { start: undefined as number | undefined, end: undefined as number | undefined },
    };
  }

  const base = typeof v.price?.amount === "number" ? v.price.amount : undefined;
  const compareRaw =
    typeof v.price?.compareAt === "number" ? v.price.compareAt : undefined;

  const d = v.price?.discount;
  const startMs = d?.startAt ? new Date(d.startAt).getTime() : undefined;
  const endMs = d?.endAt ? new Date(d.endAt).getTime() : undefined;

  const inWindow =
    (!!startMs ? nowTs >= startMs : true) &&
    (!!endMs ? nowTs < endMs : true);

  let discounted = base;
  let anyDiscountApplied = false;
  if (inWindow && typeof base === "number" && d?.value) {
    if (d.type === "percent") {
      discounted = Math.max(0, base - (base * d.value) / 100);
      anyDiscountApplied = d.value > 0;
    } else if (d.type === "amount") {
      discounted = Math.max(0, base - d.value);
      anyDiscountApplied = d.value > 0;
    }
  }

  let compare: number | undefined = undefined;
  if (typeof compareRaw === "number" && typeof discounted === "number") {
    compare = compareRaw > discounted ? compareRaw : undefined;
  }
  if (!compare && anyDiscountApplied && typeof base === "number" && typeof discounted === "number") {
    compare = base > discounted ? base : undefined;
  }

  let discountPercent: number | null = null;
  if (
    typeof compare === "number" &&
    typeof discounted === "number" &&
    compare > 0 &&
    discounted < compare
  ) {
    discountPercent = Math.round(((compare - discounted) / compare) * 100);
  }

  const final =
    typeof discounted === "number" ? Number(discounted.toFixed(2)) : undefined;

  return {
    final,
    compare: typeof compare === "number" ? Number(compare.toFixed(2)) : undefined,
    discountActive: !!(discountPercent && discountPercent > 0),
    discountPercent,
    window: { start: startMs, end: endMs },
  };
}

/* ========== المكوّن الرئيسي ========== */
const ProductDetails: React.FC = () => {
  const { addToCart } = useCart();
  const { id } = useParams();
  const { locale } = useLanguage();
  const { t } = useTranslation();

  const productQuery = useQuery({
    queryKey: ["product", id],
    queryFn: async () => (await api.get(`/products/${id}`)).data,
    enabled: Boolean(id),
    staleTime: 60_000,
  });
  const variantsQuery = useQuery({
    queryKey: ["variants", id],
    queryFn: async () => {
      const { data } = await api.get("/variants", {
        params: { product: id, limit: 500 },
      });
      return normalizeVariantsResponse(data);
    },
    enabled: Boolean(id),
    staleTime: 60_000,
  });

  const product = productQuery.data ?? null;
  const variants = variantsQuery.data ?? [];

  const { isFavorite, toggleFavorite } = useFavorites();
  const favoritePayload = useMemo<FavoriteProduct | null>(
    () =>
      product
        ? {
            _id: product._id,
            name: product.name,
            description: product.description,
            price: product.price ?? 0,
            images: product.images,
            subCategory: product.subCategory,
          }
        : null,
    [product]
  );
  const isFavoriteProduct = product?._id ? isFavorite(product._id) : false;
  const handleToggleFavorite = useCallback(() => {
    if (!favoritePayload) return;
    toggleFavorite(favoritePayload);
  }, [favoritePayload, toggleFavorite]);

  const [currentImage, setCurrentImage] = useState(0);

  const [measure, setMeasure] = useState<string>("");
  const [color, setColor] = useState<string>("");

  const [timeLeftMs, setTimeLeftMs] = useState<number | null>(null);
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const [showDiscountTimer, setShowDiscountTimer] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [addToCartState, setAddToCartState] = useState<"idle" | "success" | "error">(
    "idle"
  );
  const addToCartStateResetRef = useRef<number | null>(null);

  const productName = useMemo(
    () => getLocalizedText(product?.name, locale) || "",
    [product?.name, locale]
  );

  const productDescription = useMemo(
    () => getLocalizedText(product?.description, locale) || "",
    [product?.description, locale]
  );
  const descriptionBlocks = useMemo(
    () => parseProductDescription(productDescription),
    [productDescription]
  );

  const timeLeft = useMemo(() => {
    if (timeLeftMs === null) return null;
    return formatTimeLeft(timeLeftMs);
  }, [timeLeftMs]);

  const timeLeftText = useMemo(() => {
    if (!timeLeft) return "";
    if (timeLeft.expired) {
      return t("productDetails.discount.ended");
    }
    return timeLeft.parts
      .map((part) =>
        t(`productDetails.discount.parts.${part.unit}`, {
          value: part.value,
        })
      )
      .join(" ");
  }, [timeLeft, t]);

  useEffect(() => {
    return () => {
      if (addToCartStateResetRef.current !== null) {
        window.clearTimeout(addToCartStateResetRef.current);
      }
    };
  }, []);

  const scheduleAddToCartStateReset = useCallback(() => {
    if (addToCartStateResetRef.current !== null) {
      window.clearTimeout(addToCartStateResetRef.current);
    }
    addToCartStateResetRef.current = window.setTimeout(() => {
      setAddToCartState("idle");
    }, 1600);
  }, []);

  useEffect(() => {
    if (variants.length > 0) {
      setMeasure(variants[0].measureSlug || "");
      setColor(variants[0].colorSlug || "");
    } else {
      setMeasure("");
      setColor("");
    }
  }, [variants]);

  /* خرائط عرضية للأسماء + الوحدة */
  const measureInfoBySlug = useMemo(() => {
    const map = new Map<string, { label: string; unit?: string }>();
    for (const v of variants) {
      if (v.measureSlug && v.measure) {
        const existing = map.get(v.measureSlug);
        map.set(v.measureSlug, {
          label: v.measure,
          unit: existing?.unit ?? (v.measureUnit || undefined),
        });
      }
    }
    return map;
  }, [variants]);

  const colorLabelBySlug = useMemo(() => {
    const map = new Map<string, LocalizedObject>();
    for (const v of variants) {
      if (!v.colorSlug) continue;
      const source = v.color?.name || v.colorSlug;
      map.set(v.colorSlug, getColorLabel(source));
    }
    return map;
  }, [variants]);

  /* المقاسات/الألوان مع استبعاد "موحّد" */
  const measures = useMemo(() => {
    return Array.from(measureInfoBySlug.entries())
      .map(([slug, info]) => ({ slug, ...info }))
      .filter((m) => !isUnified(m.label));
  }, [measureInfoBySlug]);

  const allColors = useMemo(() => {
    return Array.from(colorLabelBySlug.entries())
      .map(([slug, label]) => {
        const localized = getLocalizedText(label, locale) || slug;
        const baseName = label.ar?.trim() || label.he?.trim() || localized;
        return { slug, name: localized, baseName };
      })
      .filter((c) => !isUnified(c.baseName))
      .map(({ slug, name }) => ({ slug, name }));
  }, [colorLabelBySlug, locale]);

  const colorsByMeasure = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const v of variants) {
      if (!v.measureSlug || !v.colorSlug) continue;
      if (!m.has(v.measureSlug)) m.set(v.measureSlug, new Set());
      m.get(v.measureSlug)!.add(v.colorSlug);
    }
    return m;
  }, [variants]);

  const availableColorsForMeasure = useMemo(() => {
    if (!measure) return new Set<string>();
    return colorsByMeasure.get(measure) || new Set<string>();
  }, [colorsByMeasure, measure]);

  const currentVariant = useMemo(() => {
    if (!variants.length || !measure || !color) return null;
    return (
      variants.find(
        (v) => v.measureSlug === measure && v.colorSlug === color
      ) || null
    );
  }, [variants, measure, color]);

  /* عدد / صور */
  useEffect(() => {
    setQuantity(1);
  }, [currentVariant?._id]);

  useEffect(() => {
    if (!measure) {
      setColor("");
      return;
    }
    const allowed = colorsByMeasure.get(measure);
    if (!allowed || allowed.size === 0) {
      setColor("");
      return;
    }
    if (!color || !allowed.has(color)) {
      setColor(Array.from(allowed)[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, colorsByMeasure]);

  const images = useMemo(() => {
    if (currentVariant?.color?.images && currentVariant.color.images.length > 0) {
      return currentVariant.color.images;
    }
    if (product?.images?.length) return product.images;
    return ["https://i.imgur.com/PU1aG4t.jpeg"];
  }, [currentVariant?.color?.images, product?.images]);

  const nextImage = () => setCurrentImage((p) => (p + 1) % images.length);
  const prevImage = () =>
    setCurrentImage((p) => (p - 1 + images.length) % images.length);

  useEffect(() => {
    if (!images.length) return;
    if (currentImage > images.length - 1) {
      setCurrentImage(0);
    }
  }, [images, currentImage]);

  /* --- السعر/الخصم (المصدر الموحّد) --- */
  const {
    final: finalPrice,
    compare: comparePrice,
    discountActive,
    discountPercent,
    window: discountWindow,
  } = useMemo(
    () => computeVariantPricing(currentVariant || undefined),
    [currentVariant]
  );

  /* مؤقّت الخصم — يعتمد على وجود endAt + كون الخصم فعليًا */
  useEffect(() => {
    const end = discountWindow.end;
    const start = discountWindow.start ?? Date.now();

    const hasRealDiscount =
      typeof comparePrice === "number" &&
      typeof finalPrice === "number" &&
      comparePrice > 0 &&
      finalPrice < comparePrice;

    if (!end || !hasRealDiscount) {
      setShowDiscountTimer(false);
      setTimeLeftMs(null);
      setProgressPct(null);
      return;
    }

    setShowDiscountTimer(true);

    const update = () => {
      const t = Date.now();
      const left = end - t;
      setTimeLeftMs(left > 0 ? left : 0);

      const duration = Math.max(1, end - start);
      const progress = ((t - start) / duration) * 100;
      setProgressPct(clamp(progress));

      if (t >= end) setShowDiscountTimer(false);
    };

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [discountWindow.end, discountWindow.start, comparePrice, finalPrice]);

  const handleQuantityChange = (newQty: number) => {
    setQuantity((prev) => {
      const desired = Number.isFinite(newQty) ? newQty : prev;
      const trackedStock =
        currentVariant?.trackQuantity === true
          ? Math.max(0, Number(currentVariant?.stock?.inStock || 0))
          : null;
      const maxQty =
        trackedStock === null
          ? MAX_ORDER_QTY
          : Math.min(MAX_ORDER_QTY, trackedStock);
      const ceiling = maxQty > 0 ? maxQty : 1;
      return Math.max(1, Math.min(desired, ceiling));
    });
  };

  const trackedStock =
    currentVariant?.trackQuantity === true
      ? Math.max(0, Number(currentVariant?.stock?.inStock || 0))
      : null;
  const maxSelectableQuantity =
    trackedStock === null
      ? MAX_ORDER_QTY
      : Math.min(MAX_ORDER_QTY, trackedStock);
  const isOutOfStock =
    currentVariant?.trackQuantity === true && maxSelectableQuantity <= 0;
  const isQuantityValid =
    !!currentVariant &&
    quantity >= 1 &&
    (trackedStock === null || quantity <= trackedStock);
  const isCtaDisabled = !currentVariant || !isQuantityValid || isOutOfStock;

  useEffect(() => {
    if (!currentVariant) return;
    if (maxSelectableQuantity <= 0) return;
    if (quantity > maxSelectableQuantity) {
      setQuantity(maxSelectableQuantity);
    }
  }, [currentVariant, maxSelectableQuantity, quantity]);

  /* التحميل */
  if (productQuery.isLoading) {
    return <p className="text-center mt-10">{t("productDetails.loading")}</p>;
  }

  if (productQuery.isError || !product) {
    return (
      <p className="text-center mt-10 text-muted-foreground">
        {t("productDetails.error")}
      </p>
    );
  }

  /* إخفاء UI المقاس/اللون لو ما في إلا "موحّد" */
  const showMeasureUI = measures.length > 0;
  const showColorsUI = allColors.length > 0;

  return (
    <>
      <Navbar />
      <main className="container mx-auto px-4 py-6 md:py-10 text-right">
        <div className="grid items-start gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="surface-card p-4 md:p-5">
            <div className="relative w-full overflow-hidden rounded-xl bg-[#F5F7F9] aspect-[4/5] group">
              {images.map((src: string, index: number) => (
                <img
                  key={`${src}-${index}`}
                  src={src}
                  alt={productName}
                  className={clsx(
                    "absolute inset-0 h-full w-full object-cover transition-all duration-500 ease-out",
                    index === currentImage
                      ? "opacity-100 scale-100 z-10"
                      : "opacity-0 scale-[1.02] z-0"
                  )}
                  loading={index === 0 ? "eager" : "lazy"}
                  decoding="async"
                  sizes="(max-width: 1024px) 100vw, 55vw"
                  width={900}
                  height={1125}
                />
              ))}

              {discountActive && discountPercent !== null && (
                <span className="absolute top-3 right-3 z-20 rounded-md bg-red-600 px-2 py-1 text-xs font-bold text-white">
                  -{discountPercent}%
                </span>
              )}

              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={prevImage}
                    className="absolute top-1/2 right-3 z-20 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[#D8DDE3] bg-white/90 text-black shadow-sm transition hover:scale-105 hover:bg-white"
                    aria-label={t("productCard.previousImage", {
                      defaultValue: "Previous image",
                    })}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={nextImage}
                    className="absolute top-1/2 left-3 z-20 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[#D8DDE3] bg-white/90 text-black shadow-sm transition hover:scale-105 hover:bg-white"
                    aria-label={t("productCard.nextImage", {
                      defaultValue: "Next image",
                    })}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>

            {images.length > 1 && (
              <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-6">
                {images.map((src: string, index: number) => (
                  <button
                    key={`thumb-${src}-${index}`}
                    type="button"
                    onClick={() => setCurrentImage(index)}
                    className={clsx(
                      "overflow-hidden rounded-md border bg-white transition-all duration-300",
                      index === currentImage
                        ? "border-black ring-1 ring-black/20"
                        : "border-[#D8DDE3] opacity-80 hover:opacity-100 hover:border-black/50"
                    )}
                    aria-label={t("productDetails.imageThumbnailAria", {
                      defaultValue: `Image ${index + 1}`,
                    })}
                  >
                    <img
                      src={src}
                      alt={`${productName} ${index + 1}`}
                      className="h-14 w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-5">
            <div className="surface-card p-5 md:p-6 space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h1 className="text-2xl md:text-3xl font-bold leading-tight">
                    {productName}
                  </h1>
                  {currentVariant?.stock?.sku && (
                    <p className="text-sm text-muted-foreground">
                      {currentVariant.stock.sku}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!favoritePayload}
                  onClick={handleToggleFavorite}
                  className={clsx(
                    "inline-flex h-10 w-10 items-center justify-center rounded-full border shadow-sm transition",
                    !favoritePayload && "cursor-not-allowed opacity-60",
                    favoritePayload &&
                      (isFavoriteProduct
                        ? "bg-red-600 text-white border-red-500 hover:bg-red-500"
                        : "bg-white text-gray-700 border-gray-200 hover:bg-gray-100")
                  )}
                  aria-label={
                    isFavoriteProduct
                      ? t("productDetails.removeFavorite")
                      : t("productDetails.addToFavorites")
                  }
                >
                  <Heart
                    className="h-5 w-5"
                    fill={isFavoriteProduct ? "currentColor" : "none"}
                    aria-hidden="true"
                  />
                </button>
              </div>

              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-foreground">
                  {t("productDetails.descriptionTitle", {
                    defaultValue:
                      locale === "he" ? "תיאור המוצר" : "وصف المنتج",
                  })}
                </h2>
                {descriptionBlocks.length > 0 ? (
                  <div className="space-y-3 text-sm leading-7 text-muted-foreground">
                    {descriptionBlocks.map((block, index) =>
                      block.type === "paragraph" ? (
                        <p key={`desc-paragraph-${index}`}>{block.text}</p>
                      ) : (
                        <ul
                          key={`desc-list-${index}`}
                          className="list-disc pr-5 space-y-1 marker:text-black"
                        >
                          {block.items.map((item, itemIndex) => (
                            <li key={`desc-item-${index}-${itemIndex}`}>{item}</li>
                          ))}
                        </ul>
                      )
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("productDetails.descriptionFallback", {
                      defaultValue:
                        locale === "he"
                          ? "אין תיאור זמין למוצר."
                          : "لا يوجد وصف متاح لهذا المنتج.",
                    })}
                  </p>
                )}
              </div>

              {showMeasureUI && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {t("productDetails.measureLabel")}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {measures.map((m) => {
                      const text = m.unit ? `${m.label} ${m.unit}` : m.label;
                      const active = measure === m.slug;
                      return (
                        <button
                          key={m.slug}
                          type="button"
                          onClick={() => setMeasure(m.slug)}
                          className={clsx(
                            "rounded-lg border px-3 py-2 text-sm transition",
                            active
                              ? "border-black bg-black text-white"
                              : "border-[#D8DDE3] bg-[#F5F7F9] text-gray-800 hover:border-black/60"
                          )}
                        >
                          {text}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {showColorsUI && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {t("productDetails.colorLabel")}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {allColors.map((c) => {
                      const available = !measure || availableColorsForMeasure.has(c.slug);
                      const active = color === c.slug;
                      return (
                        <button
                          key={c.slug}
                          type="button"
                          onClick={() => {
                            if (!available) return;
                            setColor(c.slug);
                          }}
                          disabled={!available}
                          className={clsx(
                            "rounded-lg border px-3 py-2 text-sm transition",
                            active && available
                              ? "border-black bg-black text-white"
                              : "border-[#D8DDE3] bg-[#F5F7F9] text-gray-800",
                            available
                              ? "hover:border-black/60"
                              : "cursor-not-allowed opacity-40"
                          )}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="surface-card p-5 md:p-6 space-y-4 bg-[#F5F7F9]/65">
              <div className="flex items-end justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {t("productDetails.priceLabel", {
                    defaultValue: locale === "he" ? "מחיר" : "السعر",
                  })}
                </p>
                {typeof comparePrice === "number" &&
                typeof finalPrice === "number" &&
                comparePrice > finalPrice ? (
                  <div className="flex items-baseline gap-2">
                    <span className="text-gray-500 line-through">₪{comparePrice}</span>
                    <span className="text-2xl font-semibold">₪{finalPrice}</span>
                  </div>
                ) : (
                  <p className="text-2xl font-semibold">
                    {typeof finalPrice === "number" ? (
                      <>₪{finalPrice}</>
                    ) : (
                      t("productDetails.price.selectOptions")
                    )}
                  </p>
                )}
              </div>

              {showDiscountTimer &&
                progressPct !== null &&
                timeLeftMs !== null && (
                  <div>
                    <div
                      className="h-2 w-full overflow-hidden rounded-full bg-gray-200"
                      aria-label={t("productDetails.discount.progressAria")}
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(progressPct)}
                      title={t("productDetails.discount.progressTitle")}
                    >
                      <div
                        className="h-full bg-red-600 transition-all duration-500"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs font-semibold text-red-700 text-right">
                      {t("productDetails.discount.endsIn")} {timeLeftText}
                    </p>
                  </div>
                )}

              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex flex-col gap-2 text-right">
                  <label className="text-sm font-medium">
                    {t("productDetails.quantityLabel")}
                  </label>
                  {currentVariant?.trackQuantity === true && (
                    <p className="text-xs text-muted-foreground">
                      {maxSelectableQuantity > 0
                        ? locale === "he"
                          ? `זמין: ${maxSelectableQuantity}`
                          : `المتاح: ${maxSelectableQuantity}`
                        : t("productCard.outOfStock")}
                    </p>
                  )}
                  <QuantityInput
                    quantity={quantity}
                    onChange={handleQuantityChange}
                  />
                </div>

                <div className="flex min-w-[220px] flex-col items-stretch gap-1">
                  <Button
                    className={clsx(
                      "h-11 min-w-[220px] gap-2 transition-all duration-200 active:scale-[0.985]",
                      addToCartState === "success" && "bg-emerald-600 hover:bg-emerald-600"
                    )}
                    disabled={isCtaDisabled || isAddingToCart}
                    onClick={() => {
                      if (!currentVariant || isCtaDisabled || isAddingToCart) return;

                      setIsAddingToCart(true);
                      setAddToCartState("idle");

                      try {
                        const computed = computeVariantPricing(currentVariant);
                        const priceForCart =
                          typeof computed.final === "number"
                            ? computed.final
                            : (currentVariant.price?.amount ?? product.price ?? 0);

                        addToCart(
                          {
                            ...product,
                            selectedVariantId: currentVariant._id,
                            selectedSku: currentVariant.stock.sku,
                            selectedMeasure: currentVariant.measure,
                            selectedMeasureUnit: currentVariant.measureUnit || undefined,
                            selectedColor: currentVariant.color?.name,
                            price: priceForCart,
                          },
                          quantity
                        );

                        dispatchCartHighlight();
                        setAddToCartState("success");
                        scheduleAddToCartStateReset();
                      } catch {
                        setAddToCartState("error");
                        scheduleAddToCartStateReset();
                      } finally {
                        setIsAddingToCart(false);
                      }
                    }}
                  >
                    {isAddingToCart ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {locale === "he" ? "מוסיף לעגלה..." : "جارٍ الإضافة..."}
                      </>
                    ) : addToCartState === "success" ? (
                      <>
                        <Check className="h-4 w-4" />
                        {locale === "he" ? "נוסף לעגלה" : "تمت الإضافة"}
                      </>
                    ) : (
                      <>
                        <ShoppingBag className="h-4 w-4" />
                        {t("productDetails.cta.addToCart")}
                      </>
                    )}
                  </Button>

                  {addToCartState === "error" && (
                    <p className="text-xs text-red-600 text-right">
                      {locale === "he"
                        ? "אירעה שגיאה בהוספה לעגלה"
                        : "حدث خطأ أثناء الإضافة للسلة"}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
};

export default ProductDetails;
