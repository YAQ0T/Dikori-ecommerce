// server/utils/orderSms.js
const { sendSMSHTD, normalizePhone } = require("./smsHtd");

function toPlainObject(order) {
  if (!order) return null;
  if (typeof order.toObject === "function") {
    try {
      return order.toObject({ depopulate: true, virtuals: false });
    } catch {
      return order.toObject();
    }
  }
  return order;
}

function resolveCustomerName(order) {
  const userName = order?.user?.name;
  const guestName = order?.guestInfo?.name;
  const name = (userName || guestName || "").toString().trim();
  return name || "عميلنا العزيز";
}

function resolveCustomerPhone(order) {
  const phone = order?.user?.phone || order?.guestInfo?.phone || "";
  const trimmed = phone ? String(phone).trim() : "";
  return trimmed || null;
}

function normalizeCurrency(currency) {
  return currency ? String(currency).trim().toUpperCase() : "";
}

function formatCurrency(amount, currency) {
  const num = Number(amount);
  const safe = Number.isFinite(num) ? num : 0;
  const formatted = safe.toFixed(2);
  const code = normalizeCurrency(currency);
  return code ? `${formatted} ${code}` : formatted;
}

function getItemName(item = {}) {
  if (!item) return "منتج";
  if (typeof item.name === "string" && item.name.trim()) {
    return item.name.trim();
  }
  if (item.name && typeof item.name === "object") {
    const ar = item.name.ar && String(item.name.ar).trim();
    const he = item.name.he && String(item.name.he).trim();
    if (ar) return ar;
    if (he) return he;
  }
  return "منتج";
}

function formatOrderDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function cleanCardType(raw) {
  if (!raw) return "";
  const text = String(raw).trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  if (lower === "cod" || lower === "cash" || lower === "cash_on_delivery") {
    return "";
  }
  if (lower === "bank_transfer") {
    return "حوالة بنكية";
  }
  if (lower === "card") {
    return "بطاقة";
  }
  return text
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function cleanLast4(raw) {
  if (!raw && raw !== 0) return "";
  const text = String(raw).replace(/\D+/g, "");
  if (!text) return "";
  return text.slice(-4).padStart(4, "0");
}

function buildOrderSummaryMessage({
  order,
  cardTypeOverride = "",
  cardLast4Override = "",
} = {}) {
  const safeOrder = toPlainObject(order) || {};
  const name = resolveCustomerName(safeOrder);
  const phone = resolveCustomerPhone(safeOrder) || "";
  const currency = safeOrder.paymentCurrency || safeOrder.currency;
  const createdAt = formatOrderDate(safeOrder.createdAt || safeOrder.updatedAt);
  const cardType =
    cleanCardType(
      cardTypeOverride || safeOrder.paymentCardType || safeOrder.paymentMethod
    ) || (safeOrder.paymentMethod === "cod" ? "الدفع عند الاستلام" : "");
  const cardLast4 =
    cleanLast4(cardLast4Override || safeOrder.paymentCardLast4) || "";

  const lines = [];
  lines.push(`مرحبا ${name}`);
  if (phone) {
    lines.push(`هاتف: ${phone}`);
  }
  if (createdAt) {
    lines.push(`تاريخ الطلب: ${createdAt}`);
  }

  lines.push("تفاصيل الطلب:");
  const items = Array.isArray(safeOrder.items) ? safeOrder.items : [];
  const currencyLabel = normalizeCurrency(currency);
  for (const item of items) {
    const itemName = getItemName(item);
    const qty = Math.max(1, Number.parseInt(item?.quantity, 10) || 1);
    const unitPrice = Number.isFinite(Number(item?.price))
      ? Number(item.price)
      : 0;
    const lineTotal = unitPrice * qty;
    const priceText = formatCurrency(unitPrice, currencyLabel || safeOrder.paymentCurrency);
    const totalText = formatCurrency(lineTotal, currencyLabel || safeOrder.paymentCurrency);
    lines.push(`- ${itemName} x${qty}: ${priceText} للوحدة / ${totalText} الإجمالي`);
  }

  const subtotal = formatCurrency(safeOrder.subtotal, currencyLabel || safeOrder.paymentCurrency);
  const discountValue = Number(safeOrder?.discount?.amount || 0);
  const total = formatCurrency(safeOrder.total, currencyLabel || safeOrder.paymentCurrency);

  lines.push(`المجموع قبل الخصم: ${subtotal}`);
  if (discountValue > 0) {
    lines.push(`الخصم: ${formatCurrency(discountValue, currencyLabel || safeOrder.paymentCurrency)}`);
  }
  lines.push(`الإجمالي المطلوب: ${total}`);

  if (cardType) {
    const parts = [cardType];
    if (cardLast4) {
      parts.push(`****${cardLast4}`);
    }
    lines.push(`طريقة الدفع: ${parts.join(" ")}`);
  }

  if (safeOrder.reference) {
    lines.push(`مرجع الدفع: ${safeOrder.reference}`);
  }

  lines.push("شكرا لتسوقك من ديكوري!");

  return lines.join("\n");
}

async function sendOrderSummarySMS({
  order,
  cardType,
  cardLast4,
} = {}) {
  const safeOrder = toPlainObject(order);
  if (!safeOrder) {
    return { ok: false, reason: "missing_order" };
  }

  const phone = resolveCustomerPhone(safeOrder);
  if (!phone) {
    return { ok: false, reason: "missing_phone" };
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return { ok: false, reason: "invalid_phone" };
  }

  const message = buildOrderSummaryMessage({
    order: safeOrder,
    cardTypeOverride: cardType,
    cardLast4Override: cardLast4,
  });

  try {
    const result = await sendSMSHTD(normalizedPhone, message);
    if (!result?.ok) {
      return { ok: false, reason: result?.reason || "send_failed" };
    }
    return { ok: true, result };
  } catch (err) {
    console.error("Failed to send order summary SMS:", err?.message || err);
    return { ok: false, reason: err?.message || "send_failed" };
  }
}

function queueOrderSummarySMS(options) {
  if (!options || !options.order) return;
  Promise.resolve()
    .then(() => sendOrderSummarySMS(options))
    .then((result) => {
      if (!result?.ok) {
        const reason = result?.reason || "unknown_reason";
        if (reason === "missing_phone" || reason === "invalid_phone") {
          return;
        }
        console.warn("Order summary SMS was not sent:", reason);
      }
    })
    .catch((err) => {
      console.error("Order summary SMS error:", err?.message || err);
    });
}

function buildPaymentConfirmedMessage({
  order,
  paymentNote = "",
} = {}) {
  const safeOrder = toPlainObject(order) || {};
  const name = resolveCustomerName(safeOrder);
  const currency = safeOrder.paymentCurrency || safeOrder.currency;
  const total = formatCurrency(safeOrder.total, currency);
  const orderId = safeOrder?._id ? String(safeOrder._id) : "-";
  const method =
    cleanCardType(safeOrder.paymentMethod) ||
    (safeOrder.paymentMethod === "cod" ? "الدفع عند الاستلام" : "");
  const note = String(paymentNote || "").trim();

  const lines = [];
  lines.push(`مرحبا ${name}`);
  lines.push("شكرا على طلبك من ديكوري.");
  lines.push("تمت عملية الدفع بنجاح.");
  lines.push(`رقم الطلب: ${orderId}`);
  lines.push(`المبلغ المدفوع: ${total}`);
  if (method) {
    lines.push(`طريقة الدفع: ${method}`);
  }
  if (note) {
    lines.push(`ملاحظة: ${note}`);
  }
  lines.push("نسعد بخدمتك دائما.");

  return lines.join("\n");
}

async function sendPaymentConfirmedSMS({
  order,
  paymentNote,
} = {}) {
  const safeOrder = toPlainObject(order);
  if (!safeOrder) {
    return { ok: false, reason: "missing_order" };
  }

  const phone = resolveCustomerPhone(safeOrder);
  if (!phone) {
    return { ok: false, reason: "missing_phone" };
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return { ok: false, reason: "invalid_phone" };
  }

  const message = buildPaymentConfirmedMessage({
    order: safeOrder,
    paymentNote,
  });

  try {
    const result = await sendSMSHTD(normalizedPhone, message);
    if (!result?.ok) {
      return { ok: false, reason: result?.reason || "send_failed" };
    }
    return { ok: true, result };
  } catch (err) {
    console.error("Failed to send payment confirmation SMS:", err?.message || err);
    return { ok: false, reason: err?.message || "send_failed" };
  }
}

function queuePaymentConfirmedSMS(options) {
  if (!options || !options.order) return;
  Promise.resolve()
    .then(() => sendPaymentConfirmedSMS(options))
    .then((result) => {
      if (!result?.ok) {
        const reason = result?.reason || "unknown_reason";
        if (reason === "missing_phone" || reason === "invalid_phone") {
          return;
        }
        console.warn("Payment confirmation SMS was not sent:", reason);
      }
    })
    .catch((err) => {
      console.error("Payment confirmation SMS error:", err?.message || err);
    });
}

module.exports = {
  sendOrderSummarySMS,
  queueOrderSummarySMS,
  buildOrderSummaryMessage,
  sendPaymentConfirmedSMS,
  queuePaymentConfirmedSMS,
  buildPaymentConfirmedMessage,
};
