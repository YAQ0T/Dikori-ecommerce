// src/pages/CheckoutSuccess.tsx
import React, { useEffect, useMemo, useState } from "react";

import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { api } from "@/lib/api";

type OrderSummary = {
  id?: string;
  reference?: string;
  total?: number;
  status?: string;
  cardType?: string;
  cardLast4?: string;
  orderDate?: string;
};

type CardInfo = {
  cardType?: string;
  cardLast4?: string;
  paidAt?: string;
};

function pickStringField(
  source: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function pickStringOrNumberField(
  source: Record<string, unknown>,
  keys: string[]
): string | number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function pickTimestampField(
  source: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
  }
  return undefined;
}

function normalizeCardTypeText(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower === "cod" || lower === "cash" || lower === "cash_on_delivery") {
    return undefined;
  }
  if (lower === "card") {
    return "بطاقة";
  }
  if (lower === "bank_transfer") {
    return "حوالة بنكية";
  }
  if (/[\p{Script=Arabic}]/u.test(trimmed)) {
    return trimmed;
  }
  return trimmed
    .split(/\s+/)
    .map((part) =>
      part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : ""
    )
    .filter(Boolean)
    .join(" ");
}

function normalizeCardLast4(
  value?: string | number | null
): string | undefined {
  if (value === null || typeof value === "undefined") return undefined;
  const digits = String(value).replace(/\D+/g, "").slice(-4);
  if (!digits) return undefined;
  return digits.padStart(4, "0");
}

function extractCardInfoFromResponse(raw: unknown): CardInfo {
  if (!raw || typeof raw !== "object") return {};
  const visited = new Set<unknown>();
  const stack: unknown[] = [raw];
  const info: CardInfo = {};

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (visited.has(current)) continue;
    visited.add(current);

    const candidate = (current as Record<string, unknown>).authorization;
    if (candidate && typeof candidate === "object") {
      const auth = candidate as Record<string, unknown>;
      if (!info.cardType) {
        const typeCandidate = pickStringField(auth, [
          "card_type",
          "cardType",
          "brand",
          "card_brand",
          "bank",
        ]);
        info.cardType = normalizeCardTypeText(typeCandidate);
      }
      if (!info.cardLast4) {
        const last4Candidate = pickStringOrNumberField(auth, [
          "last4",
          "last_4",
          "lastDigits",
          "last_digits",
          "last",
        ]);
        info.cardLast4 = normalizeCardLast4(last4Candidate);
      }
    }

    if (!info.paidAt) {
      const container = current as Record<string, unknown>;
      const timestamp = pickTimestampField(container, [
        "transaction_date",
        "transactionDate",
        "paid_at",
        "paidAt",
        "created_at",
        "createdAt",
        "updated_at",
        "updatedAt",
      ]);
      if (timestamp) {
        info.paidAt = timestamp;
      }
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }

  return info;
}

function mergeCardInfo(
  sources: Array<CardInfo | null | undefined>
): CardInfo {
  return sources.reduce<CardInfo>((acc, source) => {
    if (!source) return acc;
    if (!acc.cardType && source.cardType) {
      acc.cardType = source.cardType;
    }
    if (!acc.cardLast4 && source.cardLast4) {
      acc.cardLast4 = source.cardLast4;
    }
    if (!acc.paidAt && source.paidAt) {
      acc.paidAt = source.paidAt;
    }
    return acc;
  }, {});
}

function buildCardDisplay(cardType?: string, cardLast4?: string): string {
  const cleanType = normalizeCardTypeText(cardType);
  const cleanLast4 = normalizeCardLast4(cardLast4);
  if (!cleanType && !cleanLast4) return "";
  if (cleanType && cleanLast4) return `${cleanType} ****${cleanLast4}`;
  if (cleanType) return cleanType;
  return cleanLast4 ? `****${cleanLast4}` : "";
}

function formatOrderDate(value?: string | Date | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("ar-EG", {
      dateStyle: "medium",
      timeStyle: "short",
      hour12: false,
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function parseMetadata(raw: unknown): unknown {
  if (!raw) return undefined;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (typeof raw === "object") {
    return raw;
  }
  return undefined;
}

const CheckoutSuccess: React.FC = () => {
  const { clearCart } = useCart();

  const { user, token } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [state, setState] = useState<"checking" | "ok" | "fail">("checking");
  const [message, setMessage] = useState<string>(
    "جارٍ التحقق من حالة الطلب الخاصة بك."
  );

  const [orderSummary, setOrderSummary] = useState<OrderSummary | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<
    "cod" | "card" | "bank_transfer" | "unknown"
  >("unknown");
  const [reference, setReference] = useState<string>("");

  // استخراج reference من الـ query string
  function getReference() {
    const params = new URLSearchParams(location.search);
    return params.get("reference") || params.get("ref") || "";
  }
  function getPaymentMethod() {
    const params = new URLSearchParams(location.search);
    return (params.get("method") || "").toLowerCase();
  }

  useEffect(() => {
    const run = async () => {
      try {
        const method = getPaymentMethod();

        const normalizedMethod =
          method === "cod"
            ? "cod"
            : method === "bank_transfer" || method === "bank"
              ? "bank_transfer"
              : method
                ? "card"
                : "unknown";
        setPaymentMethod(normalizedMethod);
        const ref = getReference();
        setReference(ref);

        if (normalizedMethod === "cod") {
          setState("ok");
          setMessage(
            "تم استقبال طلبك بنجاح وسنتواصل معك لتأكيد التوصيل والدفع عند الاستلام."
          );
          clearCart();
          return;
        }

        if (normalizedMethod === "bank_transfer") {
          setState("ok");
          setMessage(
            "تم استقبال طلب الحوالة البنكية بنجاح. سيتواصل معك فريق المتجر قريبًا لإرسال تعليمات التحويل."
          );
          clearCart();
          return;
        }

        if (!ref) {
          setState("fail");
          setMessage("لا يوجد مرجع معاملة للبطاقة في الرابط.");
          return;
        }

        // 1) تحقق من السيرفر
        const verifyResp = await api.get(`/payments/status/${ref}`);
        const verifyJson = (verifyResp as any)?.data || {};
        if (!verifyJson) {
          setState("fail");
          setMessage("تعذر التحقق من الدفع من السيرفر.");
          return;
        }

        const verifyData = (verifyJson as any)?.data || verifyJson || {};
        const metadata = parseMetadata((verifyData as any)?.metadata);
        const status = String((verifyData as any)?.status || "").toLowerCase();

        if (status !== "success") {
          setState("fail");
          setMessage("فشل تأكيد الدفع من السيرفر.");
          return;
        }

        const confirmResp = await api.post(`/payments/status/${ref}/confirm`, {});
        const confirmJson = (confirmResp as any)?.data || {};
        if (!confirmJson) {
          setState("fail");
          setMessage("تعذر تثبيت حالة الدفع على الطلب.");
          return;
        }

        const confirmData = (confirmJson as any)?.data || confirmJson || {};
        const confirmInnerData =
          confirmData && typeof confirmData === "object" && "data" in confirmData
            ? (confirmData as Record<string, unknown>).data
            : confirmData;
        const confirmStatus = String(
          confirmJson?.status || confirmData?.status || ""
        ).toLowerCase();
        if (
          confirmStatus !== "success" ||
          confirmJson?.mismatch ||
          confirmData?.mismatch
        ) {
          setState("fail");
          setMessage("حدث خلل أثناء تثبيت الدفع على الطلب.");
          return;
        }

        let summary: OrderSummary | null = null;
        let orderData: any = null;

        // محاولة جلب بيانات الطلب من الخادم بالمرجع لضمان عرض معلومات دقيقة
        if (user && token) {
          try {
            const orderResp = await api.get(
              `/orders/by-reference/${ref}`,
              {
                headers: { Authorization: `Bearer ${token}` },
              }
            );
            if (orderResp?.data) {
              orderData = orderResp.data;
              summary = {
                id: orderData?._id,
                reference: orderData?.reference || ref,
                total:
                  typeof orderData?.total === "number"
                    ? orderData.total
                    : undefined,
                status: orderData?.status,
                cardType:
                  orderData?.paymentCardType || orderData?.paymentMethod,
                cardLast4: orderData?.paymentCardLast4,
                orderDate: orderData?.createdAt || orderData?.updatedAt,
              };
            } else if (confirmJson?.orderId || confirmData?.orderId) {
              summary = {
                id: confirmJson.orderId || confirmData?.orderId,
                reference: ref,
              };
            }
          } catch (err) {
            console.error("failed to fetch order by reference", err);
          }
        }
        // fallback على معلومات metadata القادمة من لحظة إن وُجدت
        if (!summary) {
          if (metadata && typeof metadata === "object") {
            const metaObj = metadata as Record<string, any>;
            const amountMinor =
              metaObj.expectedAmountMinor ??
              metaObj.amountMinor ??
              metaObj.amount_minor;
            summary = {
              id:
                metaObj.orderId ||
                metaObj.order_id ||
                confirmJson?.orderId ||
                confirmData?.orderId ||
                undefined,
              reference: ref,
              total:
                typeof amountMinor !== "undefined"
                  ? Number(amountMinor) / 100
                  : typeof metaObj.total === "number"
                  ? metaObj.total
                  : undefined,
              status: metaObj.status,
              cardType:
                metaObj.cardType ||
                metaObj.card_type ||
                metaObj.brand ||
                metaObj.paymentMethod,
              cardLast4:
                metaObj.cardLast4 ||
                metaObj.card_last4 ||
                metaObj.last4 ||
                metaObj.last_4 ||
                metaObj.lastDigits ||
                metaObj.last_digits,
              orderDate:
                metaObj.transaction_date ||
                metaObj.transactionDate ||
                metaObj.paid_at ||
                metaObj.paidAt ||
                metaObj.created_at ||
                metaObj.createdAt,
            };
          } else {
            summary = { reference: ref };
          }
        }

        if (!summary && (confirmJson?.orderId || confirmData?.orderId)) {
          summary = { reference: ref, id: confirmJson.orderId || confirmData?.orderId };
        }

        const mergedCardInfo = mergeCardInfo([
          extractCardInfoFromResponse(verifyJson),
          extractCardInfoFromResponse(verifyData),
          extractCardInfoFromResponse(confirmJson),
          extractCardInfoFromResponse(confirmData),
          extractCardInfoFromResponse(confirmInnerData),
          metadata && typeof metadata === "object"
            ? extractCardInfoFromResponse(metadata)
            : null,
          orderData
            ? {
                cardType: normalizeCardTypeText(
                  orderData.paymentCardType || orderData.paymentMethod
                ),
                cardLast4: normalizeCardLast4(orderData.paymentCardLast4),
                paidAt: orderData.createdAt || orderData.updatedAt,
              }
            : null,
        ]);

        if (summary) {
          const sanitizedType =
            normalizeCardTypeText(summary.cardType) || mergedCardInfo.cardType;
          const sanitizedLast4 =
            normalizeCardLast4(summary.cardLast4) || mergedCardInfo.cardLast4;
          const resolvedDate =
            summary.orderDate ||
            mergedCardInfo.paidAt ||
            orderData?.createdAt ||
            orderData?.updatedAt;

          let normalizedDate: string | undefined;
          if (typeof resolvedDate === "string") {
            normalizedDate = resolvedDate;
          } else if (resolvedDate instanceof Date) {
            normalizedDate = resolvedDate.toISOString();
          } else if (resolvedDate) {
            const parsed = new Date(resolvedDate as any);
            if (!Number.isNaN(parsed.getTime())) {
              normalizedDate = parsed.toISOString();
            }
          }

          summary = {
            ...summary,
            cardType: sanitizedType,
            cardLast4: sanitizedLast4,
            orderDate: normalizedDate,
          };
        }

        clearCart();
        setOrderSummary(summary);
        setState("ok");

        if (summary?.id) {
          setMessage(
            `تم تأكيد الدفع لطلبك رقم ${summary.id}. المرجع: ${
              summary.reference || ref
            }.`
          );
        } else {
          setMessage(
            `تم تأكيد الدفع لطلبك. المرجع: ${summary?.reference || ref}.`
          );
        }
      } catch (e: any) {
        console.error(e);
        setState("fail");
        setMessage("حدث خطأ أثناء معالجة نتيجة الدفع.");
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const statusHeadline = useMemo(() => {
    if (state === "checking") {
      return "جارٍ التحقق من عملية الدفع";
    }
    if (state === "ok") {
      return paymentMethod === "cod"
        ? "تم تأكيد طلب الدفع عند الاستلام"
        : paymentMethod === "bank_transfer"
          ? "تم إنشاء طلب الحوالة البنكية"
        : "تم تأكيد الدفع بنجاح";
    }
    return "تعذر تأكيد الدفع";
  }, [paymentMethod, state]);

  const metadataEntries = useMemo(() => {
    const entries: { label: string; value: string }[] = [];

    if (orderSummary?.id) {
      entries.push({ label: "رقم الطلب", value: orderSummary.id });
    }

    const referenceValue = orderSummary?.reference || reference;
    if (referenceValue) {
      entries.push({ label: "مرجع المعاملة", value: referenceValue });
    }

    if (typeof orderSummary?.total === "number") {
      entries.push({
        label: "الإجمالي المدفوع",
        value: `${orderSummary.total.toFixed(2)} شيقل`,
      });
    }

    const cardDisplay = buildCardDisplay(
      orderSummary?.cardType,
      orderSummary?.cardLast4
    );
    if (cardDisplay) {
      entries.push({ label: "البطاقة المستخدمة", value: cardDisplay });
    }

    const orderDateDisplay = formatOrderDate(orderSummary?.orderDate);
    if (orderDateDisplay) {
      entries.push({ label: "تاريخ الطلب", value: orderDateDisplay });
    }

    if (orderSummary?.status) {
      entries.push({ label: "حالة الطلب", value: orderSummary.status });
    }

    return entries;
  }, [orderSummary, reference]);

  const statusIcon = useMemo(() => {
    if (state === "checking") {
      return (
        <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Loader2 className="size-7 animate-spin" />
        </span>
      );
    }
    if (state === "ok") {
      return (
        <span className="flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
          <CheckCircle2 className="size-8" />
        </span>
      );
    }
    return (
      <span className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <XCircle className="size-8" />
      </span>
    );
  }, [state]);

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10 text-right sm:py-16">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">نتيجة الدفع</h1>
          <p className="text-muted-foreground">
            تابع حالة طلبك وتفاصيله بعد إكمال عملية الدفع.
          </p>
        </div>

        <section className="rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-col gap-6 p-6 sm:p-8">
            <div className="flex flex-col-reverse items-start gap-4 sm:flex-row-reverse sm:items-center sm:justify-between sm:gap-6">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold sm:text-2xl">
                  {statusHeadline}
                </h2>
                <p className="text-sm leading-7 text-muted-foreground sm:text-base">
                  {message}
                </p>
              </div>
              {statusIcon}
            </div>

            {metadataEntries.length > 0 && (
              <dl className="grid gap-3 rounded-xl bg-muted/40 p-4 text-sm sm:grid-cols-2 sm:text-base">
                {metadataEntries.map((item) => (
                  <div
                    key={`${item.label}-${item.value}`}
                    className="rounded-lg border border-border/50 bg-background p-3 shadow-xs"
                  >
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {item.label}
                    </dt>
                    <dd className="mt-1 font-semibold">{item.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {state !== "checking" && (
              <div className="flex flex-col gap-2 border-t border-border/60 pt-4 sm:flex-row-reverse sm:items-center sm:justify-start sm:gap-3">
                {state === "ok" ? (
                  <>
                    {orderSummary?.id ? (
                      <Button asChild className="w-full sm:w-auto">
                        <Link to={`/my-orders/${orderSummary.id}`}>
                          عرض تفاصيل الطلب
                        </Link>
                      </Button>
                    ) : (
                      <Button asChild className="w-full sm:w-auto">
                        <Link to="/account">عرض طلباتي</Link>
                      </Button>
                    )}
                    <Button
                      asChild
                      variant="outline"
                      className="w-full sm:w-auto"
                    >
                      <Link to="/products">متابعة التسوق</Link>
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      className="w-full sm:w-auto"
                      onClick={() => navigate("/cart")}
                    >
                      إعادة المحاولة
                    </Button>
                    <Button
                      asChild
                      variant="outline"
                      className="w-full sm:w-auto"
                    >
                      <Link to="/contact">التواصل مع الدعم</Link>
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {state === "fail" && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm leading-7 text-destructive">
            <p className="font-semibold">بحاجة إلى مساعدة إضافية؟</p>
            <p>
              يرجى التواصل مع فريق الدعم على الرقم
              <span className="px-1 font-bold">0599-XXXXXX</span>
              أو عبر البريد الإلكتروني
              <a
                href="mailto:support@dekori.store"
                className="font-semibold underline decoration-destructive/60 underline-offset-4"
              >
                support@dekori.store
              </a>
              ، مع ذكر مرجع المعاملة لتسريع تقديم المساعدة.
            </p>
          </div>
        )}
      </div>
    </main>
  );
};

export default CheckoutSuccess;
