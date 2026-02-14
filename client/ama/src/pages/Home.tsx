// src/pages/Home.tsx
import { useMemo, type ElementType, type FC } from "react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import { useTranslation } from "@/i18n";
import { getLocalizedText, type LocalizedText } from "@/lib/localized";
import { useLanguage, type SupportedLocale } from "@/context/LanguageContext";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  Headset,
  RotateCcw,
  ShieldCheck,
  Truck,
} from "lucide-react";
import VisaLogo from "@/assets/Visa_Inc._logo.svg";
import MastercardLogo from "@/assets/Mastercard-logo.svg";
import ProductCardSkeleton from "@/components/common/ProductCardSkeleton";

// ====== أنواع بسيطة للمنتج ======
type Product = {
  _id?: string;
  id?: string | number;
  name?: LocalizedText;
  title?: LocalizedText;
  price?: number;
  images?: string[];
  image?: string;
  mainImage?: string;
  slug?: string;
};

type LocalizedCategory = {
  key: string;
  label: string;
  value: string;
  img: string;
};

type LocalizedBenefit = {
  key: string;
  icon: string;
  title: string;
  description: string;
};

type LocalizedFallbackProduct = {
  key: string;
  id: number | string;
  name: LocalizedText;
  price: number;
  image: string;
};

type SettingsHero = {
  kicker?: LocalizedText;
  title?: LocalizedText;
  subtitle?: LocalizedText;
  imageUrl?: string;
  calloutLabel?: LocalizedText;
  calloutValue?: LocalizedText;
  primaryCtaLabel?: LocalizedText;
  secondaryCtaLabel?: LocalizedText;
};

type SettingsCategory = {
  value: string;
  label?: LocalizedText;
  imageUrl?: string;
  order?: number;
};

type SettingsTestimonial = {
  key?: string;
  name?: LocalizedText;
  role?: LocalizedText;
  quote?: LocalizedText;
  imageUrl?: string;
  rating?: number;
  order?: number;
  isActive?: boolean;
};

type SiteSettings = {
  hero?: SettingsHero;
  homeCategories?: SettingsCategory[];
  testimonialsTitle?: LocalizedText;
  testimonials?: SettingsTestimonial[];
};

const getId = (p: Product, index: number) =>
  p._id ?? p.id ?? p.slug ?? `fallback-${index}`;
const getImage = (p: Product) =>
  p.images?.[0] ||
  p.image ||
  p.mainImage ||
  "https://placehold.co/600x400/png?text=No+Image";
const getName = (p: Product, fallback: string, locale: SupportedLocale) =>
  getLocalizedText(p.name ?? p.title ?? fallback, locale) || fallback;

// ====== بطاقة منتج (مُصغّرة للموبايل) ======
const ProductCard = ({
  product,
  fallbackName,
  locale,
}: {
  product: Product;
  fallbackName: string;
  locale: SupportedLocale;
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const img = getImage(product);
  const name = getName(product, fallbackName, locale);

  const detailId =
    (typeof product._id === "string" && product._id) ||
    (typeof product.id === "string" && product.id) ||
    (typeof product.id === "number" && String(product.id)) ||
    "";

  const goToDetails = () => {
    if (detailId) navigate(`/products/${detailId}`);
    else navigate(`/products`);
  };

  return (
    <div className="group surface-card overflow-hidden">
      <button
        type="button"
        onClick={goToDetails}
        className="aspect-[3/4] w-full overflow-hidden bg-gray-50 dark:bg-gray-800 block"
        aria-label={t("home.fallback.viewAria", { name })}
      >
        <img
          src={img}
          alt={name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          loading="lazy"
          decoding="async"
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          width={600}
          height={800}
        />
      </button>
      <div className="p-3 sm:p-4 text-right">
        <h3 className="font-semibold line-clamp-1 text-sm sm:text-base">
          {name}
        </h3>
        {typeof product.price === "number" ? (
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-1">
            {product.price.toFixed(2)} ₪
          </p>
        ) : (
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-1">
            {t("home.fallback.noPrice")}
          </p>
        )}
        <div className="mt-2 sm:mt-3 flex justify-end">
          <Button
            variant="default"
            className="h-8 px-3 text-xs sm:h-9 sm:px-4 sm:text-sm"
            onClick={goToDetails}
          >
            {t("home.fallback.viewProduct")}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ====== مكوّن شبكة منتجات (ينادي API مع سقوط افتراضي) — موبايل أصغر ======
const ProductsSection = ({
  title,
  endpoint,
  fallbackProducts,
  fallbackName,
  locale,
}: {
  title: string;
  endpoint: string; // مثال: "/api/home-collections/recommended"
  fallbackProducts: Product[];
  fallbackName: string;
  locale: SupportedLocale;
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["home-collection", endpoint],
    queryFn: async () => {
      const payload =
        endpoint.startsWith("http") || endpoint.startsWith("//")
          ? await fetch(endpoint).then((res) => {
              if (!res.ok) throw new Error("bad status");
              return res.json();
            })
          : (await api.get(endpoint)).data;
      const list: Product[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.products)
        ? payload.products
        : Array.isArray(payload?.data)
        ? payload.data
        : [];
      return list.slice(0, 8);
    },
    staleTime: 60_000,
  });

  const items = data && data.length ? data : fallbackProducts;
  const showFallbackNotice = isError || (data && data.length === 0);

  return (
    <section className="mt-10 sm:mt-14">
      <div className="flex items-center justify-between mb-3 sm:mb-4">
        <h2 className="text-xl sm:text-2xl font-semibold text-right">
          {title}
        </h2>
        <Button
          variant="ghost"
          className="h-8 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
          onClick={() => navigate("/products")}
        >
          {t("home.actions.browseAll")}
        </Button>
      </div>
      {showFallbackNotice && (
        <p className="text-xs sm:text-sm text-muted-foreground text-right mb-3">
          {t("home.sections.fallbackNotice")}
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6">
        {isLoading && !data
          ? Array.from({ length: 8 }).map((_, idx) => (
              <ProductCardSkeleton key={`home-skeleton-${idx}`} />
            ))
          : items.map((p, idx) => (
              <ProductCard
                key={getId(p, idx)}
                product={p}
                fallbackName={fallbackName}
                locale={locale}
              />
            ))}
      </div>
    </section>
  );
};

const Home: FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { locale } = useLanguage();

  const settingsQuery = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => {
      const { data } = await api.get("/site-settings");
      return data as SiteSettings;
    },
    staleTime: 5 * 60_000,
  });

  const settings = settingsQuery.data;
  const hero = settings?.hero;

  const localizedCategories = t("home.categories", {
    returnObjects: true,
  }) as LocalizedCategory[];

  const benefits = t("home.benefits", {
    returnObjects: true,
  }) as LocalizedBenefit[];

  const fallbackProducts = useMemo(() => {
    const list = t("home.fallback.products", {
      returnObjects: true,
    }) as LocalizedFallbackProduct[];
    return list.map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      image: item.image,
    }));
  }, [t]);

  const fallbackName = t("home.fallback.noName");

  const heroImage =
    hero?.imageUrl && hero.imageUrl.trim() ? hero.imageUrl.trim() : "/hero.jpg";

  const heroKicker =
    (hero?.kicker && getLocalizedText(hero.kicker, locale)) ||
    t("home.hero.kicker");
  const heroTitle =
    (hero?.title && getLocalizedText(hero.title, locale)) ||
    t("home.hero.title");
  const heroSubtitle =
    (hero?.subtitle && getLocalizedText(hero.subtitle, locale)) ||
    t("home.hero.subtitle");
  const heroCalloutLabel =
    (hero?.calloutLabel && getLocalizedText(hero.calloutLabel, locale)) ||
    t("home.hero.calloutLabel");
  const heroCalloutValue =
    (hero?.calloutValue && getLocalizedText(hero.calloutValue, locale)) ||
    t("home.hero.calloutValue");
  const heroPrimaryCta =
    (hero?.primaryCtaLabel &&
      getLocalizedText(hero.primaryCtaLabel, locale)) ||
    t("home.actions.startShopping");
  const heroSecondaryCta =
    (hero?.secondaryCtaLabel &&
      getLocalizedText(hero.secondaryCtaLabel, locale)) ||
    t("home.actions.exploreCategories");

  const homeCategories = useMemo(() => {
    const settingsCategories = settings?.homeCategories || [];
    if (!settingsCategories.length) return localizedCategories;

    const fallbackByValue = new Map(
      localizedCategories.map((item) => [item.value, item])
    );

    return [...settingsCategories]
      .sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0)
      )
      .map((item, idx) => {
        const fallback = fallbackByValue.get(item.value);
        const label =
          getLocalizedText(item.label ?? "", locale) ||
          fallback?.label ||
          item.value;
        const img =
          item.imageUrl?.trim() || fallback?.img || "https://placehold.co/200x200/png?text=Category";
        return {
          key: item.value || `cat-${idx}`,
          label,
          value: item.value,
          img,
        };
      });
  }, [settings?.homeCategories, localizedCategories, locale]);

  const trustBadges = t("home.trust.badges", {
    returnObjects: true,
  }) as Array<{ key: string; title: string; description: string }>;

  const trustStats = t("home.trust.stats", {
    returnObjects: true,
  }) as Array<{ key: string; value: string; label: string }>;

  const fallbackTestimonials = useMemo(() => {
    const arList = (t("home.testimonials", {
      returnObjects: true,
    }) || []) as Array<{
      key?: string;
      name?: string;
      role?: string;
      quote?: string;
    }>;
    const heList = (t("home.testimonials", {
      returnObjects: true,
      lng: "he",
    }) || []) as Array<{
      key?: string;
      name?: string;
      role?: string;
      quote?: string;
    }>;

    const heMap = new Map<
      string,
      {
        name?: string;
        role?: string;
        quote?: string;
      }
    >();
    heList.forEach((item, index) => {
      heMap.set(item.key || `fallback-${index}`, item);
    });

    return arList.map((item, idx) => {
      const key = item.key || `fallback-${idx}`;
      const heItem = heMap.get(key);
      return {
        key,
        name: {
          ar: item.name || "",
          he: heItem?.name || "",
        },
        role: {
          ar: item.role || "",
          he: heItem?.role || "",
        },
        quote: {
          ar: item.quote || "",
          he: heItem?.quote || "",
        },
        imageUrl: "",
        rating: 5,
        order: idx,
        isActive: true,
      };
    });
  }, [t]);

  const testimonialsTitle =
    getLocalizedText(settings?.testimonialsTitle ?? "", locale) ||
    t("home.testimonialsTitle");

  const testimonials = useMemo(() => {
    const source =
      Array.isArray(settings?.testimonials) && settings.testimonials.length
        ? settings.testimonials
        : fallbackTestimonials;

    return source
      .filter((item) => item?.isActive !== false)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((item, idx) => {
        const quote = getLocalizedText(item.quote ?? "", locale);
        const name = getLocalizedText(item.name ?? "", locale);
        const role = getLocalizedText(item.role ?? "", locale);
        const imageUrl =
          typeof item.imageUrl === "string" ? item.imageUrl.trim() : "";
        const ratingInput = Number(item.rating);
        const rating = Number.isFinite(ratingInput)
          ? Math.max(1, Math.min(5, Math.round(ratingInput)))
          : 5;
        return {
          key:
            (typeof item.key === "string" && item.key) || `testimonial-${idx}`,
          quote,
          name,
          role,
          imageUrl,
          rating,
        };
      })
      .filter((item) => item.quote || item.name);
  }, [settings?.testimonials, fallbackTestimonials, locale]);

  const badgeIconMap: Record<string, ElementType> = {
    delivery: Truck,
    support: Headset,
    secure: ShieldCheck,
    returns: RotateCcw,
    quality: BadgeCheck,
  };

  const goToCategory = (main: string, sub?: string) => {
    const params = new URLSearchParams();
    params.set("category", main);
    if (sub) params.set("sub", sub);
    navigate(`/products?${params.toString()}`);
  };

  return (
    <>
      <Navbar />
      <main className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-28 -left-32 h-72 w-72 rounded-full bg-slate-200/55 blur-3xl" />
        <div className="pointer-events-none absolute top-32 -right-20 h-80 w-80 rounded-full bg-zinc-200/45 blur-3xl" />
        <div className="pointer-events-none absolute bottom-10 left-10 h-64 w-64 rounded-full bg-slate-100/60 blur-3xl" />

        <div className="container mx-auto px-4 py-6 md:py-12">
          {/* البطل */}
          <section className="grid gap-8 lg:grid-cols-[1.1fr,0.9fr] items-center">
            <div className="text-right fade-up">
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground mb-3">
                {heroKicker}
              </p>
              <h1 className="text-3xl md:text-5xl font-bold leading-tight mb-4">
                {heroTitle}
              </h1>
              <p className="text-sm md:text-lg mb-6 text-gray-700 dark:text-gray-200">
                {heroSubtitle}
              </p>
              <div className="flex flex-wrap justify-end gap-3 mb-6">
                <Button
                  className="h-10 px-5 text-sm md:h-11 md:px-6 md:text-base"
                  onClick={() => navigate(`/products`)}
                >
                  {heroPrimaryCta}
                </Button>
                <Button
                  variant="outline"
                  className="h-10 px-5 text-sm md:h-11 md:px-6 md:text-base"
                  onClick={() => {
                    const el = document.getElementById("categories");
                    if (el) {
                      el.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                  }}
                >
                  {heroSecondaryCta}
                </Button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {trustStats.map((stat, idx) => (
                  <div
                    key={stat.key}
                    className="surface-card px-3 py-3 text-right fade-up"
                    style={{ animationDelay: `${0.1 + idx * 0.08}s` }}
                  >
                    <p className="text-lg font-semibold">{stat.value}</p>
                    <p className="text-[11px] sm:text-xs text-muted-foreground">
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="relative fade-up"
              style={{ animationDelay: "0.15s" }}
            >
              <div className="absolute -inset-4 rounded-[2.5rem] bg-gradient-to-br from-zinc-200/45 via-transparent to-slate-200/45 blur-2xl" />
              <img
                src={heroImage}
                alt={t("home.hero.imageAlt")}
                className="relative w-full rounded-[2.2rem] shadow-2xl object-cover aspect-[4/5] lg:aspect-[16/10] xl:aspect-[3/2] lg:max-h-[520px] xl:max-h-[560px]"
                width={900}
                height={1125}
                decoding="async"
                fetchPriority="high"
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
              <div className="absolute -bottom-4 right-6 glass-panel px-4 py-3 text-right float-slow">
                <p className="text-xs text-muted-foreground">
                  {heroCalloutLabel}
                </p>
                <p className="text-sm font-semibold">
                  {heroCalloutValue}
                </p>
              </div>
            </div>
          </section>

          {/* شريط الثقة */}
          <section className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {trustBadges.map((badge, idx) => {
              const Icon = badgeIconMap[badge.key] || BadgeCheck;
              return (
                <div
                  key={badge.key}
                  className="surface-card p-4 text-right flex gap-3 items-start fade-up"
                  style={{ animationDelay: `${0.15 + idx * 0.08}s` }}
                >
                  <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm sm:text-base">
                      {badge.title}
                    </p>
                    <p className="text-[11px] sm:text-sm text-muted-foreground mt-1">
                      {badge.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </section>

        {/* الأقسام الرئيسية () — أحجام أصغر للموبايل */}
        <section id="categories" className="mt-10">
          <h2 className="text-xl md:text-2xl font-semibold mb-4 md:mb-6 text-right">
            {t("home.sections.categories")}
          </h2>
          <div className="grid grid-cols-3 xs:grid-cols-4 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-6">
            {homeCategories.map((c) => (
              <div
                key={c.key}
                onClick={() => goToCategory(c.value as string)}
                className="cursor-pointer flex flex-col items-center text-center fade-up"
              >
                <div
                  className="
                    w-20 h-20
                    sm:w-24 sm:h-24
                    md:w-28 md:h-28
                    lg:w-32 lg:h-32
                    xl:w-36 xl:h-36
                    rounded-md overflow-hidden
                    bg-white dark:bg-gray-900
                    border border-gray-200 dark:border-gray-700
                    shadow-sm hover:shadow-md transition-shadow duration-300
                  "
                >
                  <img
                    src={c.img}
                    alt={c.label}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                    width={160}
                    height={160}
                  />
                </div>
                <span className="mt-2 sm:mt-3 text-[11px] sm:text-sm font-medium">
                  {c.label}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ماذا نقدّم (4 بطاقات فوائد) — مصغّر للموبايل */}
        <section className="mt-10 md:mt-14">
          <h2 className="text-xl md:text-2xl font-semibold mb-4 md:mb-6 text-right">
            {t("home.sections.benefits")}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
            {benefits.map((b) => (
              <div
                key={b.key}
                className="surface-card p-3 sm:p-5 text-right"
              >
                <div className="flex justify-end">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                    <img
                      src={b.icon}
                      alt={b.title}
                      className="w-6 h-6 sm:w-7 sm:h-7"
                      loading="lazy"
                      decoding="async"
                      width={28}
                      height={28}
                    />
                  </div>
                </div>
                <h3 className="mt-3 sm:mt-4 font-semibold text-sm sm:text-base">
                  {b.title}
                </h3>
                <p className="text-[11px] sm:text-sm text-gray-600 dark:text-gray-300 mt-1">
                  {b.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* منتجات مقترحة — من home-collections */}
        <ProductsSection
          title={t("home.sections.recommended")}
          endpoint="/home-collections/recommended"
          fallbackProducts={fallbackProducts}
          fallbackName={fallbackName}
          locale={locale}
        />

        {/* وصل حديثًا — من home-collections */}
        <ProductsSection
          title={t("home.sections.newArrivals")}
          endpoint="/home-collections/new"
          fallbackProducts={fallbackProducts}
          fallbackName={fallbackName}
          locale={locale}
        />

        {/* شهادات العملاء */}
        {testimonials.length > 0 && (
          <section className="mt-12 md:mt-16">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl md:text-2xl font-semibold text-right">
                {testimonialsTitle}
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {testimonials.map((item, idx) => (
                <div
                  key={item.key}
                  className="surface-card p-4 text-right fade-up"
                  style={{ animationDelay: `${0.1 + idx * 0.1}s` }}
                >
                  <div className="mb-2 flex items-center justify-end gap-1 text-amber-500">
                    {Array.from({ length: item.rating }).map((_, starIdx) => (
                      <span key={`${item.key}-star-${starIdx}`}>★</span>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    “{item.quote}”
                  </p>
                  <div className="mt-4 flex items-center justify-end gap-3">
                    <div>
                      <p className="font-semibold">{item.name}</p>
                      {item.role && (
                        <p className="text-xs text-muted-foreground">{item.role}</p>
                      )}
                    </div>
                    {item.imageUrl && (
                      <img
                        src={item.imageUrl}
                        alt={item.name || `testimonial-${idx + 1}`}
                        className="h-12 w-12 rounded-full border object-cover bg-[#F5F7F9]"
                        loading="lazy"
                        decoding="async"
                        width={48}
                        height={48}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* طرق الدفع */}
        <section className="mt-10 md:mt-14">
          <div className="surface-card p-5 md:p-6 text-right flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h3 className="text-lg md:text-xl font-semibold">
                {t("home.payment.title")}
              </h3>
              <p className="text-sm text-muted-foreground mt-2">
                {t("home.payment.subtitle")}
              </p>
            </div>
            <div className="flex items-center justify-end gap-4">
              <img
                src={VisaLogo}
                alt={t("home.payment.visaAlt")}
                className="h-6 sm:h-8 opacity-80"
                loading="lazy"
                decoding="async"
              />
              <img
                src={MastercardLogo}
                alt={t("home.payment.mastercardAlt")}
                className="h-7 sm:h-9 opacity-80"
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
        </section>
        </div>
      </main>
      <Footer />
    </>
  );
};

export default Home;
