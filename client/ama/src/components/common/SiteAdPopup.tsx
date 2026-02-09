import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { getLocalizedText } from "@/lib/localized";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type SiteAd = {
  enabled: boolean;
  title: { ar?: string; he?: string };
  text: { ar?: string; he?: string };
  imageUrl: string;
  targetType: "none" | "product" | "url";
  targetValue: string;
  showMode: "once_per_session" | "always";
  dismissKey: string;
};

const DISMISS_STORAGE_KEY = "dikori_site_ad_dismissed_key";

const normalizeSiteAd = (raw: any): SiteAd | null => {
  if (!raw || typeof raw !== "object") return null;
  return {
    enabled: raw.enabled === true,
    title: raw.title || {},
    text: raw.text || {},
    imageUrl: String(raw.imageUrl || "").trim(),
    targetType:
      raw.targetType === "product" || raw.targetType === "url"
        ? raw.targetType
        : "none",
    targetValue: String(raw.targetValue || "").trim(),
    showMode: raw.showMode === "always" ? "always" : "once_per_session",
    dismissKey: String(raw.dismissKey || "site-ad:0"),
  };
};

const SiteAdPopup: React.FC = () => {
  const { user } = useAuth();
  const { locale } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();

  const [ad, setAd] = useState<SiteAd | null>(null);
  const [open, setOpen] = useState(false);
  const [dismissedInView, setDismissedInView] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .get("/site-ad")
      .then((res) => {
        if (!live) return;
        setAd(normalizeSiteAd(res?.data));
      })
      .catch((err) => {
        if (!live) return;
        console.error("Failed to load site ad popup", err);
      });

    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    setDismissedInView(false);
  }, [location.pathname, ad?.dismissKey]);

  const isCustomerView = useMemo(() => {
    if (location.pathname.startsWith("/admin")) return false;
    const role = String(user?.role || "").toLowerCase();
    if (role === "admin" || role === "dealer") return false;
    return true;
  }, [location.pathname, user?.role]);

  useEffect(() => {
    if (!ad || !ad.enabled || !isCustomerView || dismissedInView) {
      setOpen(false);
      return;
    }

    if (ad.showMode === "once_per_session") {
      try {
        const dismissedKey = sessionStorage.getItem(DISMISS_STORAGE_KEY);
        if (dismissedKey && dismissedKey === ad.dismissKey) {
          setOpen(false);
          return;
        }
      } catch {
        // تجاهل أخطاء sessionStorage
      }
    }

    setOpen(true);
  }, [ad, dismissedInView, isCustomerView]);

  const dismiss = () => {
    if (ad?.showMode === "once_per_session" && ad?.dismissKey) {
      try {
        sessionStorage.setItem(DISMISS_STORAGE_KEY, ad.dismissKey);
      } catch {
        // تجاهل أخطاء sessionStorage
      }
    }
    setDismissedInView(true);
    setOpen(false);
  };

  const handleAction = () => {
    if (!ad) return;
    if (ad.targetType === "product" && ad.targetValue) {
      navigate(`/products/${ad.targetValue}`);
      dismiss();
      return;
    }
    if (ad.targetType === "url" && ad.targetValue) {
      window.open(ad.targetValue, "_blank", "noopener,noreferrer");
      dismiss();
      return;
    }
    dismiss();
  };

  if (!ad || !ad.enabled || !isCustomerView) return null;

  const title =
    getLocalizedText(ad.title, locale) ||
    (locale === "he" ? "מודעה חדשה" : "إعلان جديد");
  const text = getLocalizedText(ad.text, locale);
  const hasAction =
    (ad.targetType === "product" || ad.targetType === "url") &&
    !!ad.targetValue;
  const actionLabel =
    ad.targetType === "product"
      ? locale === "he"
        ? "למוצר"
        : "عرض المنتج"
      : locale === "he"
      ? "פתח קישור"
      : "فتح الرابط";
  const skipLabel = locale === "he" ? "דלג" : "تخطي";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()}>
      <DialogContent className="sm:max-w-lg bg-white text-black dark:bg-black dark:text-white rounded-2xl border border-gray-200 dark:border-gray-800 p-0 overflow-hidden">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {ad.imageUrl ? (
          <img
            src={ad.imageUrl}
            alt={title}
            className="w-full max-h-80 object-cover"
          />
        ) : null}
        <div className="p-5 text-right space-y-3">
          <h3 className="text-xl font-bold">{title}</h3>
          {text ? <p className="text-sm text-muted-foreground">{text}</p> : null}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" onClick={dismiss}>
              {skipLabel}
            </Button>
            {hasAction ? <Button onClick={handleAction}>{actionLabel}</Button> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SiteAdPopup;
