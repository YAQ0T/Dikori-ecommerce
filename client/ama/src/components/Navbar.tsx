import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "@/lib/api";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import CartButton from "@/components/CartButton";
import { Button } from "@/components/ui/button";
import { Bell, Menu } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
// import ThemeToggle from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";
import { useTranslation } from "@/i18n";
// import OfferBanner from "./common/OfferBanner";

type NotificationItem = {
  _id: string;
  title: string;
  message: string;
  createdAt: string;
  isRead?: boolean;
};

const MAX_NAV_NOTIFICATIONS = 5;

const Navbar: React.FC = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, logout, token } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  // const [showBanner, setShowBanner] = useState(true);
  // const bannerinfo = useRef(
  //   "خصم اجمالي على كل الفواتير الاعلى من ١٠٠٠ شيقل بقيمه ٥٪"
  // );
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(
    null
  );
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadIds, setUnreadIds] = useState<string[]>([]);
  const unreadIdsRef = useRef<string[]>([]);
  const mobileNotificationsRef = useRef<HTMLDivElement | null>(null);
  const desktopNotificationsRef = useRef<HTMLDivElement | null>(null);

  // const showThemeToggle = !user || user.role !== "admin";
  const baseLinks = useMemo(
    () => [
      { key: "home", path: "/" },
      { key: "products", path: "/products" },
      { key: "favorites", path: "/favorites" },
      { key: "about", path: "/about" },
      { key: "contact", path: "/contact" },
      { key: "account", path: "/account" },
    ],
    []
  );

  const links = useMemo(() => {
    const result = [...baseLinks];
    if (user && user.role === "admin") {
      result.push({ key: "dashboard", path: "/admin" });
    }
    return result.map((link) => ({
      ...link,
      name: t(`navbar.links.${link.key}` as const),
    }));
  }, [baseLinks, t, user]);

  const canShowNotifications = Boolean(user && token);

  const formatNotificationDate = useCallback((value: string) => {
    if (!value) return "";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!canShowNotifications) {
      setNotifications([]);
      setUnreadCount(0);
      setUnreadIds([]);
      setNotificationsError(null);
      setNotificationsLoading(false);
      return [] as string[];
    }

    setNotificationsLoading(true);
    setNotificationsError(null);
    try {
      const response = await api.get("/notifications/my", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const list = Array.isArray(response.data) ? response.data : [];
      const sorted = [...list].sort((a, b) => {
        const aTime = new Date(a?.createdAt ?? 0).getTime();
        const bTime = new Date(b?.createdAt ?? 0).getTime();
        return bTime - aTime;
      });

      const limited = sorted.slice(0, MAX_NAV_NOTIFICATIONS);
      setNotifications(limited);

      const unreadItems = list.filter((item: NotificationItem) => !item.isRead);
      const unreadIdsList = unreadItems.map((item) => item._id);
      setUnreadIds(unreadIdsList);
      setUnreadCount(unreadIdsList.length);
      return unreadIdsList;
    } catch (error) {
      console.error("❌ Failed to load notifications", error);
      setNotificationsError(t("navbar.notifications.error"));
      return [];
    } finally {
      setNotificationsLoading(false);
    }
  }, [canShowNotifications, t, token]);

  useEffect(() => {
    unreadIdsRef.current = unreadIds;
  }, [unreadIds]);

  const markAllAsRead = useCallback(
    async (ids?: string[]) => {
      if (!canShowNotifications) return;
      const targetIds = (ids ?? unreadIdsRef.current).filter(Boolean);
      if (targetIds.length === 0) return;

      setNotifications((prev) =>
        prev.map((notification) =>
          targetIds.includes(notification._id)
            ? { ...notification, isRead: true }
            : notification
        )
      );
      setUnreadIds((prev) =>
        prev.filter((identifier) => !targetIds.includes(identifier))
      );
      setUnreadCount((prev) =>
        prev - targetIds.length > 0 ? prev - targetIds.length : 0
      );

      try {
        await Promise.all(
          targetIds.map((id) =>
            api.patch(
              `/notifications/${id}/read`,
              {},
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              }
            )
          )
        );
      } catch (error) {
        console.error("❌ Failed to mark notifications as read", error);
      }
    },
    [canShowNotifications, token]
  );

  useEffect(() => {
    if (!canShowNotifications) {
      setNotificationsOpen(false);
      return;
    }
    void fetchNotifications();
  }, [canShowNotifications, fetchNotifications]);

  useEffect(() => {
    if (!notificationsOpen) return;
    let cancelled = false;
    (async () => {
      const ids = await fetchNotifications();
      if (cancelled) return;
      if (ids.length > 0) {
        await markAllAsRead(ids);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notificationsOpen, fetchNotifications, markAllAsRead]);

  useEffect(() => {
    if (!notificationsOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        (mobileNotificationsRef.current &&
          mobileNotificationsRef.current.contains(target)) ||
        (desktopNotificationsRef.current &&
          desktopNotificationsRef.current.contains(target))
      ) {
        return;
      }
      setNotificationsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNotificationsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [notificationsOpen]);

  const renderNotificationsMenu = (
    ref: React.RefObject<HTMLDivElement | null>,
    alignment: "left" | "right" = "left"
  ) => (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          if (!canShowNotifications) return;
          setNotificationsOpen((prev) => !prev);
        }}
        className={clsx(
          "relative inline-flex h-10 w-10 items-center justify-center rounded-full border transition",
          canShowNotifications
            ? "bg-white text-gray-700 hover:bg-gray-100 dark:bg-slate-900 dark:text-slate-100"
            : "bg-gray-200 text-gray-400 cursor-not-allowed"
        )}
        aria-haspopup="true"
        aria-expanded={notificationsOpen}
        aria-label={t("navbar.notifications.title")}
        disabled={!canShowNotifications}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[1.25rem] rounded-full bg-red-600 px-1 text-[0.65rem] font-semibold leading-none text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {notificationsOpen && (
        <div
          className={clsx(
            "absolute z-40 mt-2 w-80 max-w-[90vw] rounded-lg border border-gray-100 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950",
            alignment === "right" ? "right-0" : "left-0"
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 text-right dark:border-slate-800">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("navbar.notifications.title")}
            </span>
            <span className="text-xs text-gray-500 dark:text-slate-400">
              {t("navbar.notifications.unread", { count: unreadCount })}
            </span>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notificationsLoading ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                {t("navbar.notifications.loading")}
              </p>
            ) : notificationsError ? (
              <p className="px-4 py-3 text-sm text-destructive">
                {notificationsError}
              </p>
            ) : notifications.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                {t("navbar.notifications.empty")}
              </p>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification._id}
                  className="border-b border-gray-100 px-4 py-3 text-right last:border-0 dark:border-slate-800"
                >
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    {notification.title}
                  </p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">
                    {notification.message}
                  </p>
                  <span className="mt-2 block text-[0.7rem] text-gray-400 dark:text-slate-400">
                    {formatNotificationDate(notification.createdAt)}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-right text-sm dark:border-slate-800 dark:bg-slate-900/60">
            <Link
              to="/account"
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
              onClick={() => setNotificationsOpen(false)}
            >
              {t("navbar.notifications.viewAll")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <header
      className="sticky top-0 inset-x-0 z-50 border-b bg-white/90 dark:bg-slate-950/90 backdrop-blur shadow-sm"
      style={
        // دعم الـ safe area على iOS
        { paddingTop: "env(safe-area-inset-top)" }
      }
    >
      <nav
        className="mx-auto w-full max-w-[100svw] overflow-x-clip px-3 sm:px-4"
      >
        <div className="flex h-14 items-center justify-between gap-2">
          {/* يسار: التبديلات */}
          <div className="flex shrink-0 items-center gap-1.5 w-18">
            {/* قلل العرض الثابت عالجوال وخليه يتمدد فقط على الشاشات الأكبر */}
            <LanguageToggle />
            {/* {showThemeToggle && <ThemeToggle />} */}
          </div>

          {/* وسط: الشعار (يتمدّد ويختصر) */}
          <Link
            to="/"
            className="min-w-0 flex-1 text-center"
          >
            <span className="block truncate text-lg font-semibold tracking-tight md:text-2xl">
              {t("navbar.brand")}
            </span>
          </Link>

          {/* يمين: أزرار الموبايل */}
          <div className="flex shrink-0 items-center gap-2 lg:hidden">
            {renderNotificationsMenu(mobileNotificationsRef)}
            <CartButton />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-label="فتح القائمة"
            >
              <Menu />
            </Button>
          </div>

          {/* روابط الديسكتوب */}
          <div className="hidden lg:flex items-center gap-1.5">
            {links.map((link) => (
              <Button key={link.path} asChild variant="ghost">
                <Link to={link.path}>{link.name}</Link>
              </Button>
            ))}

            {!user ? (
              <>
                <Button asChild variant="ghost">
                  <Link to="/login">{t("navbar.auth.login")}</Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link to="/register">{t("navbar.auth.register")}</Link>
                </Button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {t("navbar.auth.greeting", { name: user.name })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    logout();
                    navigate("/login");
                  }}
                >
                  {t("navbar.auth.logout")}
                </Button>
              </div>
            )}

            {renderNotificationsMenu(desktopNotificationsRef)}
            <CartButton />
          </div>
        </div>
      </nav>

      {/* القائمة الجوالية: مُثبتة ولا توسّع عرض الـnavbar */}
      {menuOpen && (
        <div
          className="lg:hidden fixed inset-x-0 z-40 bg-white/95 dark:bg-slate-950/95 backdrop-blur shadow-lg border-t py-4 px-6 space-y-3 text-right"
          style={{
            // نحسب أعلى القائمة تحت الـnavbar مع safe area
            top: "calc(env(safe-area-inset-top, 0px) + 56px)",
          }}
        >
          {links.map((link) => (
            <div key={link.path}>
              <Link
                to={link.path}
                className="block py-2 text-gray-800 font-medium hover:text-black dark:text-slate-100"
                onClick={() => setMenuOpen(false)}
              >
                {link.name}
              </Link>
            </div>
          ))}

          {!user ? (
            <>
              <Link
                to="/login"
                className="block py-2 text-gray-800 font-medium hover:text-black dark:text-slate-100"
                onClick={() => setMenuOpen(false)}
              >
                {t("navbar.auth.login")}
              </Link>
              <Link
                to="/register"
                className="block py-2 text-gray-800 font-medium hover:text-black dark:text-slate-100"
                onClick={() => setMenuOpen(false)}
              >
                {t("navbar.auth.register")}
              </Link>
            </>
          ) : (
            <>
              <span className="block py-2 text-gray-800 font-medium dark:text-slate-100">
                {t("navbar.auth.greeting", { name: user.name })}
              </span>
              <button
                onClick={() => {
                  logout();
                  setMenuOpen(false);
                  navigate("/login");
                }}
                className="block w-full text-right py-2 text-red-600 font-medium hover:text-red-800"
              >
                {t("navbar.auth.logout")}
              </button>
            </>
          )}

          <LanguageToggle className="w-full" />
        </div>
      )}
    </header>
  );
};

export default Navbar;
