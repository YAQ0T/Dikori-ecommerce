// src/components/common/CategoryCircles.tsx
import React, { useMemo } from "react";
import { useTranslation } from "@/i18n";

/** مجموعة التصنيفات */
type CategoryGroup = {
  mainCategory: string;
  subCategories: string[];
};

type Props = {
  categories: CategoryGroup[];
  onFilter: (main: string, sub?: string) => void;
  selectedMain: string;
  selectedSub: string;
  loading?: boolean;

  /**
   * صور التصنيفات الفرعية (اختياري)
   * يدعم المفاتيح التالية:
   *  - "MAIN:::SUB" (اسم الرئيسي:::اسم الفرعي)
   *  - "SUB" فقط (بالاسم نصاً)
   * أمثلة:
   *  {
   *    "لوازم نجارين:::مفصلات": "https://example.com/hinge.png",
   *    "مفصلات": "https://example.com/hinge-fallback.png"
   *  }
   */
  subCategoryImages?: Record<string, string>;
  /**
   * صور التصنيفات الرئيسية (اختياري)
   * مفتاح الصورة هو اسم التصنيف الرئيسي
   */
  mainCategoryImages?: Record<string, string>;
  allValue?: string;
  labelMapper?: (value: string, type: "main" | "sub") => string;
};

/* =========================
   أدوات تطبيع النص العربي
   ========================= */
function normalizeArabic(input: string): string {
  if (!input) return "";
  let s = input.trim();

  // إزالة التشكيل والتمطيط
  // التشكيل: 064B-0652 ، همزات الوصل الصغيرة… الخ
  s = s.replace(/[\u064B-\u0652\u0670\u0640]/g, "");

  // توحيد الهمزات والألفات والياء/الألف المقصورة والتاء المربوطة
  s = s.replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");

  // مسافات موحّدة + حروف صغيرة (مع أن العربية ما فيها case بس للاتينية الاختيارية)
  s = s.replace(/\s+/g, " ").toLowerCase();

  return s;
}

function normKey(raw: string): string {
  return normalizeArabic(raw);
}

function normComposite(main: string, sub: string): string {
  return `${normKey(main)}:::${normKey(sub)}`;
}

/* =========================
   صور افتراضية/افتراضي
   ========================= */

// صور للأقسام الرئيسية (اختياري)
const CATEGORY_IMAGES: Record<string, string> = {
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
  "أصناف اضافية": "https://www.svgrepo.com/show/491692/plus-circle.svg", // احتياطي
  "لوازم أبواب": "https://i.imgur.com/UskLo6H.png", // احتياطي
  "كبسات مسامير و براغي": "https://i.imgur.com/CntFVhx.png", // احتياطي
};

// يمكنك (اختياريًا) وضع صور افتراضية لبعض الفروع بالاسم
// إما "MAIN:::SUB" أو "SUB"
const SUBCATEGORY_IMAGES_DEFAULT: Record<string, string> = {
  // أمثلة:
  // "لوازم نجارين:::مفصلات": "https://example.com/hinges-main.png",
  "أرجل طاولات": "https://i.imgur.com/25nxJlt.png",
};

const DEFAULT_MAIN_IMG =
  "https://placehold.co/240x240/png?text=%D8%AA%D8%B5%D9%86%D9%8A%D9%81";
const DEFAULT_SUB_IMG = "https://i.imgur.com/G9rP8ht.png";

/* =========================
   عناصر العرض
   ========================= */

function CircleItem({
  title,
  image,
  active = false,
  size = "lg",
  onClick,
}: {
  title: string;
  image?: string;
  active?: boolean;
  size?: "lg" | "sm";
  onClick?: () => void;
}) {
  // أحجام أصغر على الموبايل، أكبر تدريجيًا على الشاشات الكبيرة
  const dim =
    size === "lg"
      ? "w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 xl:w-28 xl:h-28"
      : "w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16";

  // ✅ تحديد البوردر راديوس حسب النوع
  const radius = size === "lg" ? "rounded-md" : "rounded-full";

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center text-center focus:outline-none p-1"
      aria-pressed={active}
      title={title}
    >
      <span
        className={[
          radius,
          "overflow-hidden bg-white dark:bg-gray-900",
          "transition-all duration-300",
          active
            ? "ring-2 ring-black/20 dark:ring-white/30 scale-[1.03] shadow"
            : "hover:shadow-md",
          dim,
        ].join(" ")}
      >
        <img
          src={image || (size === "lg" ? DEFAULT_MAIN_IMG : DEFAULT_SUB_IMG)}
          alt={title}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </span>
      <span
        className={[
          "mt-2 font-medium leading-tight line-clamp-1",
          size === "lg" ? "text-xs sm:text-sm" : "text-[10px] sm:text-xs",
          active
            ? "text-black dark:text-white"
            : "text-gray-800 dark:text-gray-100",
        ].join(" ")}
      >
        {title}
      </span>
    </button>
  );
}

function SkeletonCircle({ size = "lg" }: { size?: "lg" | "sm" }) {
  const dim =
    size === "lg"
      ? "w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 xl:w-28 xl:h-28"
      : "w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16";

  const radius = size === "lg" ? "rounded-md" : "rounded-full";

  return (
    <div className="flex flex-col items-center text-center animate-pulse">
      <div
        className={[radius, "bg-gray-200 dark:bg-gray-800", dim].join(" ")}
      />
      <div className="mt-2 h-3 w-16 rounded bg-gray-200 dark:bg-gray-800" />
    </div>
  );
}

/* =========================
   المكوّن الرئيسي
   ========================= */

const CategoryCircles: React.FC<Props> = ({
  categories,
  onFilter,
  selectedMain,
  selectedSub,
  loading = false,
  subCategoryImages = {},
  mainCategoryImages = {},
  allValue = "",
  labelMapper,
}) => {
  const { t } = useTranslation();
  const allLabel = t("productsPage.categoryNav.allLabel");
  const headingLabel = t("productsPage.categoryNav.heading");
  const showAllTooltip = t("productsPage.categoryNav.showAllTooltip");
  const removeSubLabel = t("productsPage.categoryNav.removeSubLabel");
  const removeSubTitle = t("productsPage.categoryNav.removeSubTitle");
  const selectSubPrompt = t("productsPage.categoryNav.selectSubPrompt");
  const subAllTitle = t("productsPage.categoryNav.subAllTitle");

  // بناء خرائط مطبّعة لسرعة الوصول
  const { mainImgByExact, mainImgByNorm, subImgByExact, subImgByNorm } =
    useMemo(() => {
      // رئيسي: جهّز خريطتين (نصيّة ومطبّعة)
      const mainExact = new Map<string, string>();
      const mainNorm = new Map<string, string>();
      const mergedMain = { ...CATEGORY_IMAGES, ...mainCategoryImages };
      Object.entries(mergedMain).forEach(([k, v]) => {
        mainExact.set(k, v);
        mainNorm.set(normKey(k), v);
      });

      // فرعي: ادمج الافتراضي مع الممرَّر من الـ props (props تغلب الافتراضي عند التعارض)
      const mergedSubs: Record<string, string> = {
        ...SUBCATEGORY_IMAGES_DEFAULT,
        ...subCategoryImages,
      };

      const subExact = new Map<string, string>();
      const subNorm = new Map<string, string>();
      Object.entries(mergedSubs).forEach(([k, v]) => {
        subExact.set(k, v);
        subNorm.set(normKey(k), v);
      });

      return {
        mainImgByExact: mainExact,
        mainImgByNorm: mainNorm,
        subImgByExact: subExact,
        subImgByNorm: subNorm,
      };
    }, [mainCategoryImages, subCategoryImages]);

  // ترتيب عربي + إزالة التكرار
  const normalized = useMemo(() => {
    const list = [...(categories || [])].map((c) => ({
      mainCategory: c.mainCategory,
      subCategories: Array.from(new Set(c.subCategories || [])),
    }));
    list.sort((a, b) => a.mainCategory.localeCompare(b.mainCategory, "ar"));
    list.forEach((g) =>
      g.subCategories.sort((a, b) => a.localeCompare(b, "ar"))
    );
    return list;
  }, [categories]);

  const isAllSelected = !selectedMain || selectedMain === allValue;

  const activeGroup = !isAllSelected
    ? normalized.find((g) => g.mainCategory === selectedMain)
    : undefined;

  // صورة الرئيسي: جرّب المطابقة النصية ثم المطبّعة
  const getMainImage = (main: string): string => {
    return (
      mainImgByExact.get(main) ||
      mainImgByNorm.get(normKey(main)) ||
      DEFAULT_MAIN_IMG
    );
  };

  /**
   * إحضار صورة الفرعي حسب:
   *  1) "MAIN:::SUB" (دقيق)
   *  2) "SUB" فقط (بالاسم)
   *  3) طُرق مطبّعة لكلا الحالتين
   * يرجّع undefined إذا لم تُوجد أي مطابقة، ليسمح بفallback لاحقاً.
   */
  const getSubImage = (main: string, sub: string): string | undefined => {
    if (!sub) return undefined;

    const compositeRaw = `${main}:::${sub}`;
    const compositeNorm = normComposite(main, sub);
    const subNormOnly = normKey(sub);

    // 1) مطابقة مركّبة نصية ثم مطبّعة
    const byComposite =
      subImgByExact.get(compositeRaw) || subImgByNorm.get(compositeNorm);
    if (byComposite) return byComposite;

    // 2) مطابقة باسم الفرعي فقط (نصي ثم مطبّع)
    const bySubOnly = subImgByExact.get(sub) || subImgByNorm.get(subNormOnly);
    if (bySubOnly) return bySubOnly;

    return undefined;
  };

  const getMainLabel = (value: string): string => {
    if (!value) return value;
    return labelMapper ? labelMapper(value, "main") ?? value : value;
  };

  const getSubLabel = (value: string): string => {
    if (!value) return value;
    return labelMapper ? labelMapper(value, "sub") ?? value : value;
  };

  return (
    <section className="w-full text-right">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base sm:text-lg font-bold">{headingLabel}</h2>
        {(!isAllSelected || selectedSub) && (
          <button
            onClick={() => onFilter(allValue, "")}
            className="px-3 py-1.5 rounded-md text-xs sm:text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"
            title={showAllTooltip}
          >
            {allLabel}
          </button>
        )}
      </div>

      {/* الرئيسية */}
      <div className="relative">
        <div
          className="flex gap-3 sm:gap-4 overflow-x-auto snap-x snap-mandatory pb-1"
          dir="rtl"
        >
          {loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={`sk-main-${i}`} className="snap-start shrink-0">
                  <SkeletonCircle size="lg" />
                </div>
              ))
            : normalized.map((group) => {
                const main = group.mainCategory;
                const active = selectedMain === main;
                const img = getMainImage(main);
                const mainLabel = getMainLabel(main);
                return (
                  <div key={main} className="snap-start shrink-0">
                    <CircleItem
                      title={mainLabel}
                      image={img}
                      active={active}
                      size="lg"
                      onClick={() =>
                        onFilter(main, selectedMain === main ? selectedSub : "")
                      }
                    />
                  </div>
                );
              })}
        </div>
      </div>

      {/* الفرعية */}
      {!isAllSelected && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm sm:text-base font-semibold">
              {getMainLabel(activeGroup?.mainCategory || selectedMain)}
            </h3>
            {selectedSub ? (
              <button
                onClick={() => onFilter(selectedMain, "")}
                className="px-2.5 py-1 rounded-md text-[11px] sm:text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"
                title={removeSubTitle}
              >
                {removeSubLabel}
              </button>
            ) : (
              <span className="text-[11px] sm:text-xs text-gray-500">
                {selectSubPrompt}
              </span>
            )}
          </div>

          <div
            className="flex gap-3 sm:gap-4 overflow-x-auto snap-x snap-mandatory pb-1"
            dir="rtl"
          >
            {loading && !activeGroup
              ? Array.from({ length: 10 }).map((_, i) => (
                  <div key={`sk-sub-${i}`} className="snap-start shrink-0">
                    <SkeletonCircle size="sm" />
                  </div>
                ))
              : (activeGroup?.subCategories || []).map((sub) => {
                  // أولاً حاول نجيب صورة بالاسم/المركّب من الخرائط
                  const mapped = getSubImage(selectedMain, sub);
                  const img = mapped || DEFAULT_SUB_IMG;
                  const subLabel = getSubLabel(sub);

                  return (
                    <div key={sub} className="snap-start shrink-0">
                      <CircleItem
                        title={subLabel}
                        image={img}
                        size="sm"
                        active={selectedSub === sub}
                        onClick={() => onFilter(selectedMain, sub)}
                      />
                    </div>
                  );
                })}

            {activeGroup && (
              <div className="snap-start shrink-0">
                <CircleItem
                  key="__all__"
                  title={subAllTitle}
                  image={DEFAULT_SUB_IMG}
                  size="sm"
                  active={!selectedSub}
                  onClick={() => onFilter(selectedMain, "")}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export default CategoryCircles;
