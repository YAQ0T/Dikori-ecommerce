const Notification = require("../models/Notification");
const { queuePaymentConfirmedSMS } = require("./orderSms");

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

function formatCurrency(amount, currency) {
  const num = Number(amount);
  const safe = Number.isFinite(num) ? num : 0;
  const formatted = safe.toFixed(2);
  const code = currency ? String(currency).trim().toUpperCase() : "";
  return code ? `${formatted} ${code}` : formatted;
}

function resolveMethodLabel(method) {
  const value = String(method || "").trim().toLowerCase();
  if (value === "bank_transfer") return "حوالة بنكية";
  if (value === "card") return "بطاقة";
  if (value === "cod") return "الدفع عند الاستلام";
  return method ? String(method).trim() : "غير محدد";
}

function buildInAppPaymentMessage({
  orderId,
  totalText,
  methodLabel,
  paymentNote = "",
}) {
  const parts = [
    "شكرا على طلبك، تمت عملية الدفع بنجاح.",
    `رقم الطلب: ${orderId}`,
    `المبلغ المدفوع: ${totalText}`,
    `طريقة الدفع: ${methodLabel}`,
  ];

  const trimmedNote = String(paymentNote || "").trim();
  if (trimmedNote) {
    parts.push(`ملاحظة: ${trimmedNote}`);
  }

  return parts.join(" | ");
}

function queuePaymentConfirmationNotification({
  order,
  paymentNote = "",
} = {}) {
  if (!order || process.env.NODE_ENV === "test") return;
  const safeOrder = toPlainObject(order) || {};
  const orderId = safeOrder?._id ? String(safeOrder._id) : "-";
  const userId = safeOrder?.user?._id ? String(safeOrder.user._id) : "";
  const totalText = formatCurrency(
    safeOrder?.total,
    safeOrder?.paymentCurrency || safeOrder?.currency
  );
  const methodLabel = resolveMethodLabel(safeOrder?.paymentMethod);
  const message = buildInAppPaymentMessage({
    orderId,
    totalText,
    methodLabel,
    paymentNote,
  });

  if (userId) {
    Promise.resolve()
      .then(() =>
        Notification.create({
          title: "تم تأكيد الدفع",
          message,
          target: "user",
          user: userId,
        })
      )
      .catch((err) => {
        console.error("Failed to create payment confirmation notification:", err);
      });
  }

  queuePaymentConfirmedSMS({
    order: safeOrder,
    paymentNote,
  });
}

module.exports = {
  queuePaymentConfirmationNotification,
};
