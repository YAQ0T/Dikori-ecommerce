import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  type ChangeEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import clsx from "clsx";
import { useCart } from "@/context/CartContext";
import { useFavorites, type FavoriteProduct } from "@/context/FavoritesContext";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { getLocalizedText, type LocalizedText } from "@/lib/localized";
import { useLanguage } from "@/context/LanguageContext";
import { useTranslation } from "@/i18n";
import {
  Loader2,
  Check,
  ShoppingBag,
  X,
  ChevronUp,
  ChevronDown,
  Heart,
} from "lucide-react";
import { dispatchCartHighlight } from "@/lib/cartHighlight";

interface Props {
  product: {
    _id: string;
    name: LocalizedText;
    description: LocalizedText;
    price: number;
    images?: string[];
    subCategory?: string;
  };
}

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
  tags?: string[];
  // قد تكون موجودة من السيرفر، لكن لن نعتمد عليها:
  finalAmount?: number;
  displayCompareAt?: number | null;
  isDiscountActive?: boolean;
};

const clamp = (n: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, n));

const fallbackImg = "https://i.imgur.com/PU1aG4t.jpeg";
const MAX_ORDER_QTY = 999999;

/** ✅ يُرجع دائمًا مصفوفة المتغيّرات سواء كانت الاستجابة {items:[]} أو [] مباشرة */
function normalizeVariantsResponse(data: any): Variant[] {
  if (data && Array.isArray(data.items)) return data.items as Variant[];
  if (Array.isArray(data)) return data as Variant[];
  return [];
}

/** ✅ تسعير موحّد محليًا من amount/compareAt/discount (+ نافذة الزمن) */
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

  const base =
    typeof v.price?.amount === "number" ? v.price.amount : undefined;
  const compareRaw =
    typeof v.price?.compareAt === "number" ? v.price.compareAt : undefined;

  const d = v.price?.discount;
  const startMs = d?.startAt ? new Date(d.startAt).getTime() : undefined;
  const endMs = d?.endAt ? new Date(d.endAt).getTime() : undefined;

  // نافذة الخصم فعّالة؟
  const inWindow =
    (!!startMs ? nowTs >= startMs : true) &&
    (!!endMs ? nowTs < endMs : true);

  // طبّق الخصم على السعر الأساسي عند توافره وكون النافذة فعّالة
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

  // قرّر قيمة الـ compare للعرض:
  // - لو compareAt من السيرفر أكبر من النهائي => استخدمه
  // - وإلا لو عندك خصم فعّال، استخدم base كـ compare إذا كان أعلى
  let compare: number | undefined = undefined;
  if (typeof compareRaw === "number" && typeof discounted === "number") {
    compare = compareRaw > discounted ? compareRaw : undefined;
  }
  if (!compare && anyDiscountApplied && typeof base === "number" && typeof discounted === "number") {
    compare = base > discounted ? base : undefined;
  }

  // نسبة الخصم
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

const ProductCard: React.FC<Props> = ({ product }) => {
  const { addToCart } = useCart();
  const navigate = useNavigate();
  const { locale } = useLanguage();
  const { t } = useTranslation();

  const productName = useMemo(
    () => getLocalizedText(product.name, locale) || product._id,
    [product.name, locale, product._id]
  );
  const productDescription = useMemo(
    () => getLocalizedText(product.description, locale) || "",
    [product.description, locale]
  );

  const { isFavorite, toggleFavorite } = useFavorites();
  const favoritePayload = useMemo<FavoriteProduct>(
    () => ({
      ...product,
      price: product.price ?? 0,
    }),
    [product]
  );
  const isFavoriteProduct = isFavorite(product._id);
  const handleToggleFavorite = useCallback(() => {
    toggleFavorite(favoritePayload);
  }, [favoritePayload, toggleFavorite]);

  // حالات مشتركة
  const [currentImage, setCurrentImage] = useState(0);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [vLoading, setVLoading] = useState(true);

  const [selectedMeasure, setSelectedMeasure] = useState("");
  const [selectedColor, setSelectedColor] = useState("");

  // خصم/مؤقت
  const [timeLeftMs, setTimeLeftMs] = useState<number | null>(null);
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const [showDiscountTimer, setShowDiscountTimer] = useState(false);

  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isMobileDetailsOpen, setIsMobileDetailsOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [quantityInput, setQuantityInput] = useState("1");

  const [isAdding, setIsAdding] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const resetJustAddedTimeout = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetJustAddedTimeout.current !== null) {
        window.clearTimeout(resetJustAddedTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    setIsDetailsOpen(false);
    setIsMobileDetailsOpen(false);
  }, [product._id]);

  // جلب المتغيّرات
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        setVLoading(true);
        const { data } = await api.get("/variants", {
          params: { product: product._id, limit: 500 },
        });
        if (ignore) return;

        const vs: Variant[] = normalizeVariantsResponse(data);
        setVariants(vs);

        if (vs.length > 0) {
          setSelectedMeasure(vs[0].measureSlug || "");
          setSelectedColor(vs[0].colorSlug || "");
        }
      } catch {
        setVariants([]);
      } finally {
        if (!ignore) setVLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [product._id]);

  // اشتقاقات
  const colorsByMeasure = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const v of variants) {
      if (!v.measureSlug || !v.colorSlug) continue;
      if (!m.has(v.measureSlug)) m.set(v.measureSlug, new Set());
      m.get(v.measureSlug)!.add(v.colorSlug);
    }
    return m;
  }, [variants]);

  const currentVariant = useMemo(() => {
    if (!variants.length || !selectedMeasure || !selectedColor) return null;
    return (
      variants.find(
        (v) =>
          v.measureSlug === selectedMeasure && v.colorSlug === selectedColor
      ) || null
    );
  }, [variants, selectedMeasure, selectedColor]);
  const trackedStock =
    currentVariant?.trackQuantity === true
      ? Math.max(0, Number(currentVariant?.stock?.inStock || 0))
      : null;
  const maxSelectableQuantity =
    trackedStock === null
      ? MAX_ORDER_QTY
      : Math.min(MAX_ORDER_QTY, trackedStock);
  const isTrackedOutOfStock =
    currentVariant?.trackQuantity === true && maxSelectableQuantity <= 0;

  const currentVariantId = currentVariant?._id ?? "no-variant";

  const displayedImages = useMemo(() => {
    const variantColorImages =
      currentVariant?.color?.images?.filter(Boolean) ?? [];
    if (variantColorImages.length > 0) return variantColorImages;
    const productImages = product.images?.filter(Boolean) ?? [];
    if (productImages.length > 0) return productImages;
    return [fallbackImg];
  }, [currentVariant?.color?.images, product.images]);

  // مزامنة اللون مع المقاس
  useEffect(() => {
    if (variants.length === 0) return;
    if (!selectedMeasure) return;

    const allowed = colorsByMeasure.get(selectedMeasure);
    if (!allowed || allowed.size === 0) {
      setSelectedColor("");
      return;
    }
    if (!selectedColor || !allowed.has(selectedColor)) {
      const first = Array.from(allowed)[0];
      setSelectedColor(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMeasure, colorsByMeasure, variants.length]);

  // إعادة المؤشر للصورة الأولى عند تغيّر المصدر
  useEffect(() => {
    setCurrentImage(0);
  }, [displayedImages]);

  useEffect(() => {
    setQuantity(1);
    setQuantityInput("1");
  }, [currentVariantId]);

  useEffect(() => {
    if (maxSelectableQuantity <= 0) return;
    if (quantity > maxSelectableQuantity) {
      setQuantity(maxSelectableQuantity);
      setQuantityInput(String(maxSelectableQuantity));
    }
  }, [maxSelectableQuantity, quantity]);

  // --- السعر/الخصم (المصدر الموحّد) ---
  const { final, compare, discountActive, discountPercent, window: discountWindow } =
    useMemo(() => computeVariantPricing(currentVariant || undefined), [currentVariant]);

  const displayPrice = typeof final === "number" ? final : (product.price ?? 0);
  const variantCompare = typeof compare === "number" ? compare : null;

  // مؤقّت الخصم (يعتمد فقط على وجود نافذة endAt + وجود خصم فعلي)
  useEffect(() => {
    const end = discountWindow.end;
    const start = discountWindow.start ?? Date.now();

    const hasRealDiscount =
      typeof variantCompare === "number" &&
      typeof displayPrice === "number" &&
      variantCompare > 0 &&
      displayPrice < variantCompare;

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
    };

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [discountWindow.end, discountWindow.start, variantCompare, displayPrice]);

  // تنقّل الصور
  const nextImage = () =>
    setCurrentImage((prev) => (prev + 1) % displayedImages.length);
  const prevImage = () =>
    setCurrentImage(
      (prev) => (prev - 1 + displayedImages.length) % displayedImages.length
    );

  const arrowBase =
    "absolute top-1/2 -translate-y-1/2 z-20 rounded-full border border-white/40 shadow-lg transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-white/50 opacity-80 bg-black/20 backdrop-blur-sm active:scale-95 md:opacity-0 md:bg-white/60 md:text-black md:group-hover:opacity-100";
  const arrowSize = "w-9 h-9 flex items-center justify-center";
  const arrowIcon = "pointer-events-none select-none";

  // كمية وإضافة للسلة
  const handleQuantityChange = useCallback((newQty: number) => {
    const ceiling = maxSelectableQuantity > 0 ? maxSelectableQuantity : 1;
    const safeQty = Math.max(
      1,
      Math.min(Number.isFinite(newQty) ? newQty : 1, ceiling)
    );
    setQuantity(safeQty);
    setQuantityInput(String(safeQty));
  }, [maxSelectableQuantity]);

  const canIncreaseQuantity = useMemo(() => {
    if (maxSelectableQuantity <= 0) return false;
    return quantity < maxSelectableQuantity;
  }, [maxSelectableQuantity, quantity]);

  const canDecreaseQuantity = quantity > 1;

  const incrementQuantity = useCallback(() => {
    if (!canIncreaseQuantity) return;
    handleQuantityChange(quantity + 1);
  }, [canIncreaseQuantity, handleQuantityChange, quantity]);

  const decrementQuantity = useCallback(() => {
    if (!canDecreaseQuantity) return;
    handleQuantityChange(quantity - 1);
  }, [canDecreaseQuantity, handleQuantityChange, quantity]);

  const handleQuantityInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target;
      const sanitized = value.replace(/[^0-9]/g, "");
      setQuantityInput(sanitized);
      if (sanitized === "") return;
      const parsed = Number.parseInt(sanitized, 10);
      if (Number.isNaN(parsed)) return;
      handleQuantityChange(parsed);
    },
    [handleQuantityChange]
  );

  const handleQuantityBlur = useCallback(() => {
    if (quantityInput.trim() === "") {
      handleQuantityChange(1);
      return;
    }
    const parsed = Number.parseInt(quantityInput, 10);
    if (Number.isNaN(parsed)) {
      handleQuantityChange(1);
      return;
    }
    handleQuantityChange(parsed);
  }, [handleQuantityChange, quantityInput]);

  const addItemToCart = useCallback(async () => {
    if (isAdding) return false;

    setIsAdding(true);

    try {
      const effectiveQuantity = Math.max(1, quantity);
      let added = false;

      if (variants.length > 0) {
        if (!currentVariant || isTrackedOutOfStock) return false;

        const computed = computeVariantPricing(currentVariant);
        const priceForCart =
          typeof computed.final === "number"
            ? computed.final
            : (currentVariant.price?.amount ?? product.price ?? 0);

        const itemForCart = {
          ...product,
          image: displayedImages?.[0] || fallbackImg,
          selectedVariantId: currentVariant._id,
          selectedSku: currentVariant.stock?.sku,
          selectedMeasure: currentVariant.measure,
          selectedMeasureUnit: currentVariant.measureUnit || undefined,
          selectedColor: currentVariant.color?.name,
          price: priceForCart,
        };
        addToCart(itemForCart, effectiveQuantity);
        added = true;
      } else {
        const productForCart = {
          ...product,
          image: displayedImages?.[0] || fallbackImg,
          selectedMeasure,
          selectedColor,
          price: product.price ?? 0,
        };
        addToCart(productForCart, effectiveQuantity);
        added = true;
      }

      if (added) {
        setJustAdded(true);
        dispatchCartHighlight();
        if (resetJustAddedTimeout.current !== null) {
          window.clearTimeout(resetJustAddedTimeout.current);
        }
        resetJustAddedTimeout.current = window.setTimeout(() => {
          setJustAdded(false);
        }, 1000);
      }

      return added;
    } finally {
      setIsAdding(false);
    }
  }, [
    isAdding,
    quantity,
    variants.length,
    currentVariant,
    isTrackedOutOfStock,
    addToCart,
    product,
    displayedImages,
    selectedMeasure,
    selectedColor,
  ]);

  const isVariantUnavailable =
    variants.length > 0 && (!currentVariant || isTrackedOutOfStock);

  // سكيليتون
  if (vLoading) {
    return (
      <div className="group surface-card p-2 text-right relative h-full animate-pulse">
        <div className="w-full aspect-[4/5] mb-2 rounded bg-gray-200" />
        <div className="h-5 w-2/3 bg-gray-200 rounded mb-2" />
        <div className="h-4 w-1/3 bg-gray-200 rounded mb-2" />
        <div className="h-10 w-full bg-gray-200 rounded" />
      </div>
    );
  }

  const renderExpandedPanel = (className?: string) => (
    <div
      className={clsx(
        "absolute inset-x-0 bottom-0 z-30 flex flex-col gap-4 rounded-lg bg-white p-4 shadow-xl transition-[transform,opacity] duration-300 will-change-transform",
        isDetailsOpen
          ? "translate-y-0 opacity-100 pointer-events-auto ease-out"
          : "translate-y-full opacity-0 pointer-events-none ease-in",
        className
      )}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex flex-row-reverse items-start justify-between gap-3">
        <div className="flex-1 text-right">
          <h4 className="text-base font-semibold text-gray-900">{productName}</h4>
          {productDescription && (
            <p className="mt-1 text-sm text-gray-600 line-clamp-4">
              {productDescription}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={clsx(
              "inline-flex h-9 w-9 items-center justify-center rounded-full border transition",
              isFavoriteProduct
                ? "bg-red-600 text-white border-red-500 hover:bg-red-500"
                : "bg-white text-gray-700 border-gray-200 hover:bg-gray-100"
            )}
            onClick={(event) => {
              event.stopPropagation();
              handleToggleFavorite();
            }}
            aria-label={
              isFavoriteProduct
                ? t("productCard.removeFavorite")
                : t("productCard.addFavorite")
            }
          >
            <Heart
              className="h-4 w-4"
              fill={isFavoriteProduct ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-100 text-gray-700 transition hover:bg-gray-200"
            onClick={() => setIsDetailsOpen(false)}
            aria-label={t("productCard.cancel")}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-gray-700">
          {t("productCard.quantityLabel")}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={decrementQuantity}
            disabled={!canDecreaseQuantity}
            className={clsx(
              "inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition",
              !canDecreaseQuantity
                ? "cursor-not-allowed opacity-40"
                : "hover:bg-gray-100"
            )}
            aria-label={t("productCard.decreaseQuantity", {
              defaultValue: "Decrease quantity",
            })}
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={quantityInput}
            onChange={handleQuantityInputChange}
            onBlur={handleQuantityBlur}
            className="h-9 w-20 rounded-md border border-gray-200 bg-white text-center text-base font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300"
            aria-label={t("productCard.quantityInput", {
              defaultValue: "Quantity",
            })}
          />
          <button
            type="button"
            onClick={incrementQuantity}
            disabled={!canIncreaseQuantity}
            className={clsx(
              "inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition",
              !canIncreaseQuantity
                ? "cursor-not-allowed opacity-40"
                : "hover:bg-gray-100"
            )}
            aria-label={t("productCard.increaseQuantity", {
              defaultValue: "Increase quantity",
            })}
          >
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      {currentVariant?.trackQuantity === true && (
        <p className="text-xs text-right text-gray-500">
          {maxSelectableQuantity > 0
            ? locale === "he"
              ? `זמין: ${maxSelectableQuantity}`
              : `المتاح: ${maxSelectableQuantity}`
            : t("productCard.outOfStock")}
        </p>
      )}

      <Button
        onClick={() => {
          void addItemToCart();
        }}
        disabled={isAdding || isVariantUnavailable}
        className={clsx(
          "w-full transition-transform duration-200",
          justAdded &&
            "scale-[1.02] ring-2 ring-green-400 ring-offset-2 ring-offset-white bg-green-600 text-white",
          isAdding && "opacity-80 cursor-not-allowed",
          !isAdding && !justAdded && "hover:scale-[1.01]"
        )}
      >
        {justAdded ? (
          <span className="flex items-center justify-center gap-1.5">
            <Check className="h-4 w-4" />
            {t("productCard.addedToCart")}
          </span>
        ) : isVariantUnavailable ? (
          t("productCard.outOfStock")
        ) : isAdding ? (
          <span className="flex items-center justify-center gap-1.5">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("productCard.addingToCart")}
          </span>
        ) : (
          t("productCard.addToCart")
        )}
      </Button>
    </div>
  );

  const renderMobileSheetContent = () => (
    <div
      className="flex h-full flex-col"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="flex items-start justify-between gap-3 pr-10">
          <div className="flex-1 text-right">
            <h4 className="text-base font-semibold text-gray-900">{productName}</h4>
            {productDescription && (
              <p className="mt-1 line-clamp-3 text-[13px] leading-6 text-gray-600">
                {productDescription}
              </p>
            )}
          </div>
          <button
            type="button"
            className={clsx(
              "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition",
              isFavoriteProduct
                ? "border-red-500 bg-red-600 text-white hover:bg-red-500"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-100"
            )}
            onClick={(event) => {
              event.stopPropagation();
              handleToggleFavorite();
            }}
            aria-label={
              isFavoriteProduct
                ? t("productCard.removeFavorite")
                : t("productCard.addFavorite")
            }
          >
            <Heart
              className="h-4 w-4"
              fill={isFavoriteProduct ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <span className="text-sm font-medium text-gray-700">
            {t("productCard.quantityLabel")}
          </span>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={decrementQuantity}
              disabled={!canDecreaseQuantity}
              className={clsx(
                "inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition",
                !canDecreaseQuantity
                  ? "cursor-not-allowed opacity-40"
                  : "hover:bg-gray-100"
              )}
              aria-label={t("productCard.decreaseQuantity", {
                defaultValue: "Decrease quantity",
              })}
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </button>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={quantityInput}
              onChange={handleQuantityInputChange}
              onBlur={handleQuantityBlur}
              className="h-10 w-16 rounded-md border border-gray-200 bg-white text-center text-base font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300"
              aria-label={t("productCard.quantityInput", {
                defaultValue: "Quantity",
              })}
            />
            <button
              type="button"
              onClick={incrementQuantity}
              disabled={!canIncreaseQuantity}
              className={clsx(
                "inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition",
                !canIncreaseQuantity
                  ? "cursor-not-allowed opacity-40"
                  : "hover:bg-gray-100"
              )}
              aria-label={t("productCard.increaseQuantity", {
                defaultValue: "Increase quantity",
              })}
            >
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {currentVariant?.trackQuantity === true && (
          <p className="mt-2 text-right text-xs text-gray-500">
            {maxSelectableQuantity > 0
              ? locale === "he"
                ? `זמין: ${maxSelectableQuantity}`
                : `المتاح: ${maxSelectableQuantity}`
              : t("productCard.outOfStock")}
          </p>
        )}
      </div>

      <div className="border-t border-gray-100 bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Button
          onClick={() => {
            void addItemToCart();
          }}
          disabled={isAdding || isVariantUnavailable}
          className={clsx(
            "h-11 w-full transition-transform duration-200",
            justAdded &&
              "scale-[1.02] ring-2 ring-green-400 ring-offset-2 ring-offset-white bg-green-600 text-white",
            isAdding && "cursor-not-allowed opacity-80"
          )}
        >
          {justAdded ? (
            <span className="flex items-center justify-center gap-1.5">
              <Check className="h-4 w-4" />
              {t("productCard.addedToCart")}
            </span>
          ) : isVariantUnavailable ? (
            t("productCard.outOfStock")
          ) : isAdding ? (
            <span className="flex items-center justify-center gap-1.5">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("productCard.addingToCart")}
            </span>
          ) : (
            t("productCard.addToCart")
          )}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {/* ============ موبايل ============ */}
      <Sheet open={isMobileDetailsOpen} onOpenChange={setIsMobileDetailsOpen}>
        <div
          className={clsx(
            "relative surface-card p-0 overflow-hidden text-right flex flex-col md:hidden cursor-pointer transition-all duration-300",
            isMobileDetailsOpen && "ring-2 ring-black/10"
          )}
          onClick={() => {
            if (isMobileDetailsOpen) return;
            navigate(`/products/${product._id}`);
          }}
        >
          {/* محتوى البطاقة */}
          <div className="flex flex-col transform transition-all duration-300 ease-out">
            <div className="relative w-full aspect-square overflow-hidden bg-white">
              {displayedImages.map((src, index) => (
                <img
                  key={`${src}-${index}`}
                  src={src}
                  alt={productName}
                  className={clsx(
                    "absolute inset-0 w-full h-full object-cover transition-all duration-500",
                    {
                      "opacity-100 translate-x-0 z-10": index === currentImage,
                      "opacity-0 translate-x-full z-0": index > currentImage,
                      "opacity-0 -translate-x-full z-0": index < currentImage,
                    }
                  )}
                  loading="lazy"
                  decoding="async"
                  sizes="(max-width: 768px) 50vw, 33vw"
                  width={640}
                  height={800}
                  draggable={false}
                />
              ))}

              {displayedImages.length > 1 && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      prevImage();
                    }}
                    aria-label={t("productCard.previousImage")}
                    className={clsx(arrowBase, arrowSize, "left-2 text-white")}
                  >
                    <svg
                      className={arrowIcon}
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      width="18"
                      height="18"
                      fill="currentColor"
                    >
                      <path d="M12.707 15.707a1 1 0 0 1-1.414 0l-5-5a1 1 0 0 1 0-1.414l5-5a1 1 0 1 1 1.414 1.414L8.414 10l4.293 4.293a1 1 0 0 1 0 1.414z" />
                    </svg>
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      nextImage();
                    }}
                    aria-label={t("productCard.nextImage")}
                    className={clsx(arrowBase, arrowSize, "right-2 text-white")}
                  >
                    <svg
                      className={arrowIcon}
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      width="18"
                      height="18"
                      fill="currentColor"
                    >
                      <path d="M7.293 4.293a1 1 0 0 1 1.414 0l5 5a1 1 0 0 1 0 1.414l-5 5A1 1 0 1 1 7.293 14.293L11.586 10 7.293 5.707a1 1 0 0 1 0-1.414z" />
                    </svg>
                  </button>
                </>
              )}

              <button
                type="button"
                className={clsx(
                  "absolute top-2 left-2 z-30 inline-flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition",
                  isFavoriteProduct
                    ? "bg-red-600 text-white border-red-500 hover:bg-red-500"
                    : "bg-white text-gray-700 border-gray-200 hover:bg-gray-100"
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  handleToggleFavorite();
                }}
                aria-label={
                  isFavoriteProduct
                    ? t("productCard.removeFavorite")
                    : t("productCard.addFavorite")
                }
              >
                <Heart
                  className="h-4 w-4"
                  fill={isFavoriteProduct ? "currentColor" : "none"}
                  aria-hidden="true"
                />
              </button>

              {discountActive && discountPercent !== null && (
                <span className="absolute top-2 right-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded z-20">
                  -{discountPercent}%
                </span>
              )}
            </div>

            <div className="px-3 pb-3 pt-2">
              <div className="flex items-start justify-between gap-1.5">
                <span className="block text-sm font-medium mb-1 line-clamp-2">
                  {productName}
                </span>

                <button
                  type="button"
                  className={clsx(
                    "shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-900 shadow-sm transition",
                    "hover:bg-gray-100 active:scale-95",
                    isMobileDetailsOpen &&
                      "bg-black text-white hover:bg-black border-black shadow-md"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsMobileDetailsOpen(true);
                  }}
                  aria-label={t("productCard.addToCart")}
                  aria-pressed={isMobileDetailsOpen}
                  title={t("productCard.addToCart")}
                >
                  <ShoppingBag
                    className={clsx(
                      "h-4 w-4 transition-transform duration-300",
                      isMobileDetailsOpen && "scale-110"
                    )}
                    aria-hidden="true"
                  />
                </button>
              </div>

              <div className="mt-1">
                <div className="flex items-baseline gap-1.5">
                  {typeof variantCompare === "number" &&
                  variantCompare > displayPrice ? (
                    <>
                      <span className="text-gray-500 line-through">
                        ₪{variantCompare}
                      </span>
                      <span className="font-semibold text-base">₪{displayPrice}</span>
                    </>
                  ) : (
                    <span className="font-semibold text-base">₪{displayPrice}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <SheetContent
          side="bottom"
          className="md:hidden h-auto max-h-[85svh] rounded-t-3xl border-t border-gray-200 bg-white p-0 pt-6 [&>button]:top-5 [&>button]:right-4"
        >
          <SheetTitle className="sr-only">{productName}</SheetTitle>
          <SheetDescription className="sr-only">
            {productDescription ?? t("productCard.addToCart")}
          </SheetDescription>
          {renderMobileSheetContent()}
        </SheetContent>
      </Sheet>

      {/* ============ ديسكتوب ============ */}
      <div
        className={clsx(
          "hidden md:flex group surface-card p-0 overflow-hidden text-right relative flex-col transition-all duration-300",
          isDetailsOpen && "ring-2 ring-black/10"
        )}
        onClick={() => {
          if (isDetailsOpen) return;
          navigate(`/products/${product._id}`);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (isDetailsOpen) return;
            navigate(`/products/${product._id}`);
          }
        }}
      >
        <div
          className={clsx(
            "flex flex-col transform transition-all duration-300 ease-out",
            isDetailsOpen
              ? "blur-sm scale-[0.97] pointer-events-none"
              : "scale-100"
          )}
        >
          <div
            className="relative w-full aspect-square overflow-hidden bg-white cursor-pointer"
          >
            {displayedImages.map((src, index) => (
              <img
                key={`${src}-${index}`}
                src={src}
                alt={productName}
                className={clsx(
                  "absolute inset-0 w-full h-full object-cover transition-all duration-500 ",
                  {
                    "opacity-100 translate-x-0 z-10": index === currentImage,
                    "opacity-0 translate-x-full z-0": index > currentImage,
                    "opacity-0 -translate-x-full z-0": index < currentImage,
                  }
                )}
                loading="lazy"
                decoding="async"
                sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                width={640}
                height={800}
                draggable={false}
              />
            ))}

            {displayedImages.length > 1 && (
              <>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    prevImage();
                  }}
                  aria-label={t("productCard.previousImage")}
                  className={clsx(
                    arrowBase,
                    arrowSize,
                    "left-2 text-white md:text-black"
                  )}
                >
                  <svg
                    className={arrowIcon}
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    width="20"
                    height="20"
                    fill="currentColor"
                  >
                    <path d="M12.707 15.707a1 1 0 0 1-1.414 0l-5-5a1 1 0 0 1 0-1.414l5-5a1 1 0 1 1 1.414 1.414L8.414 10l4.293 4.293a1 1 0 0 1 0 1.414z" />
                  </svg>
                </button>

                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    nextImage();
                  }}
                  aria-label={t("productCard.nextImage")}
                  className={clsx(
                    arrowBase,
                    arrowSize,
                    "right-2 text-white md:text-black"
                  )}
                >
                  <svg
                    className={arrowIcon}
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    width="20"
                    height="20"
                    fill="currentColor"
                  >
                    <path d="M7.293 4.293a1 1 0 0 1 1.414 0l5 5a1 1 0 0 1 0 1.414l-5 5A1 1 0 1 1 7.293 14.293L11.586 10 7.293 5.707a1 1 0 0 1 0-1.414z" />
                  </svg>
                </button>
              </>
            )}

            <button
              type="button"
              className={clsx(
                "absolute top-2 left-2 z-30 inline-flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition",
                isFavoriteProduct
                  ? "bg-red-600 text-white border-red-500 hover:bg-red-500"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-100"
              )}
              onClick={(event) => {
                event.stopPropagation();
                handleToggleFavorite();
              }}
              aria-label={
                isFavoriteProduct
                  ? t("productCard.removeFavorite")
                  : t("productCard.addFavorite")
              }
            >
              <Heart
                className="h-4 w-4"
                fill={isFavoriteProduct ? "currentColor" : "none"}
                aria-hidden="true"
              />
            </button>

            {discountActive && discountPercent !== null && (
              <span className="absolute top-2 right-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded z-20">
                -{discountPercent}%
              </span>
            )}
          </div>

          <div className="px-3 pb-3 pt-2 flex flex-col">
            <h3 className="text-base font-medium mb-1">{productName}</h3>

            {product.subCategory && (
              <p className="text-xs text-gray-500 mb-1.5">{product.subCategory}</p>
            )}

            {/* السعر */}
            <div className="mb-1.5 flex items-center justify-between gap-2">
              {typeof variantCompare === "number" &&
              variantCompare > displayPrice ? (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-gray-500 line-through">
                    ₪{variantCompare}
                  </span>
                  <span className="font-semibold text-base">₪{displayPrice}</span>
                </div>
              ) : (
                <p className="font-semibold text-base mb-0">₪{displayPrice}</p>
              )}
              <button
                type="button"
                className={clsx(
                  "inline-flex h-9 w-11 items-center justify-center rounded-md border border-black bg-black text-white shadow-sm transition-all duration-300 cursor-pointer",
                  "opacity-0 -translate-x-3 pointer-events-none",
                  "group-hover:opacity-100 group-hover:translate-x-0 group-hover:pointer-events-auto",
                  "hover:bg-black/90 hover:shadow-md active:scale-[0.98]",
                  isDetailsOpen && "opacity-100 translate-x-0 pointer-events-auto"
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  setIsDetailsOpen(true);
                }}
                aria-label={t("productCard.addToCart")}
                aria-pressed={isDetailsOpen}
                title={t("productCard.addToCart")}
              >
                <ShoppingBag
                  className={clsx(
                    "h-4 w-4 transition-transform duration-300",
                    isDetailsOpen && "scale-110"
                  )}
                  aria-hidden="true"
                />
              </button>
            </div>

            {/* تايمر خصم */}
            {showDiscountTimer && progressPct !== null && timeLeftMs !== null && (
              <div className="mb-2.5">
                <div
                  className="w-full h-2 rounded-full bg-gray-200 overflow-hidden"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progressPct)}
                  title={t("productCard.discountTimerTitle")}
                >
                  <div
                    className="h-full bg-red-600 transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className="mt-1 text-xs text-red-700 font-semibold text-right">
                  {t("productCard.discountTimer")}
                </div>
              </div>
            )}

            <div className="mt-2" />
          </div>
        </div>

        {renderExpandedPanel("hidden md:flex")}
      </div>
    </>
  );
};

export default ProductCard;
