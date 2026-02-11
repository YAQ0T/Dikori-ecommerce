const nodemailer = require("nodemailer");

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

function formatDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function itemDisplayName(item = {}) {
  const name = item?.name;
  if (typeof name === "string" && name.trim()) return name.trim();
  if (name && typeof name === "object") {
    const ar = name.ar ? String(name.ar).trim() : "";
    const he = name.he ? String(name.he).trim() : "";
    if (ar && he) return `${ar} / ${he}`;
    if (ar) return ar;
    if (he) return he;
  }
  return "منتج";
}

function resolveCustomer(order = {}) {
  const user = order.user || {};
  const guest = order.guestInfo || {};
  return {
    name: String(user.name || guest.name || "").trim() || "غير متوفر",
    phone: String(user.phone || guest.phone || "").trim() || "غير متوفر",
    email: String(user.email || guest.email || "").trim() || "غير متوفر",
  };
}

function resolvePaymentMethodLabel(raw) {
  const method = String(raw || "").trim().toLowerCase();
  if (method === "cod") return "الدفع عند الاستلام";
  if (method === "card") return "بطاقة";
  return raw ? String(raw).trim() : "غير محدد";
}

function buildOrderAlertEmail({ order } = {}) {
  const safeOrder = toPlainObject(order) || {};
  const customer = resolveCustomer(safeOrder);
  const currency = safeOrder.paymentCurrency || "";
  const createdAt = formatDate(safeOrder.createdAt || safeOrder.updatedAt);
  const orderId = safeOrder._id ? String(safeOrder._id) : "غير متوفر";
  const paymentMethod = resolvePaymentMethodLabel(safeOrder.paymentMethod);
  const paymentStatus = String(safeOrder.paymentStatus || "unpaid");
  const status = String(safeOrder.status || "waiting_confirmation");
  const shippingAddress = String(safeOrder.address || "").trim() || "غير متوفر";
  const notes = String(safeOrder.notes || "").trim();

  const items = Array.isArray(safeOrder.items) ? safeOrder.items : [];
  const itemLines = items.map((item, index) => {
    const qty = Math.max(1, Number.parseInt(item?.quantity, 10) || 1);
    const unitPrice = Number.isFinite(Number(item?.price)) ? Number(item.price) : 0;
    const lineTotal = qty * unitPrice;
    const sku = item?.sku ? String(item.sku).trim() : "-";
    const measure = item?.measure ? String(item.measure).trim() : "-";
    const color = item?.color ? String(item.color).trim() : "-";
    const title = itemDisplayName(item);

    return {
      idx: index + 1,
      title,
      qty,
      unitPrice: formatCurrency(unitPrice, currency),
      lineTotal: formatCurrency(lineTotal, currency),
      sku,
      measure,
      color,
    };
  });

  const subtotal = formatCurrency(safeOrder.subtotal, currency);
  const discountAmount = Number(safeOrder?.discount?.amount || 0);
  const discount = formatCurrency(discountAmount, currency);
  const total = formatCurrency(safeOrder.total, currency);

  const subject = `طلب جديد #${orderId}`;

  const htmlRows = itemLines
    .map(
      (line) => `
        <tr>
          <td style="padding:8px;border:1px solid #d8dde3;text-align:center;">${line.idx}</td>
          <td style="padding:8px;border:1px solid #d8dde3;">${escapeHtml(line.title)}</td>
          <td style="padding:8px;border:1px solid #d8dde3;text-align:center;">${escapeHtml(
            line.sku
          )}</td>
          <td style="padding:8px;border:1px solid #d8dde3;text-align:center;">${escapeHtml(
            line.measure
          )}</td>
          <td style="padding:8px;border:1px solid #d8dde3;text-align:center;">${escapeHtml(
            line.color
          )}</td>
          <td style="padding:8px;border:1px solid #d8dde3;text-align:center;">${line.qty}</td>
          <td style="padding:8px;border:1px solid #d8dde3;text-align:center;">${line.unitPrice}</td>
          <td style="padding:8px;border:1px solid #d8dde3;text-align:center;">${line.lineTotal}</td>
        </tr>`
    )
    .join("");

  const html = `
    <div style="font-family:Arial,sans-serif;direction:rtl;text-align:right;color:#111;">
      <h2 style="margin:0 0 12px;">طلب جديد من الموقع</h2>
      <p><strong>رقم الطلب:</strong> ${escapeHtml(orderId)}</p>
      <p><strong>تاريخ الطلب:</strong> ${escapeHtml(createdAt || "غير متوفر")}</p>
      <p><strong>حالة الطلب:</strong> ${escapeHtml(status)}</p>
      <p><strong>طريقة الدفع:</strong> ${escapeHtml(paymentMethod)}</p>
      <p><strong>حالة الدفع:</strong> ${escapeHtml(paymentStatus)}</p>
      <p><strong>مرجع الدفع:</strong> ${escapeHtml(safeOrder.reference || "-")}</p>

      <hr style="border:none;border-top:1px solid #e2e6ea;margin:14px 0;" />
      <h3 style="margin:0 0 8px;">بيانات العميل</h3>
      <p><strong>الاسم:</strong> ${escapeHtml(customer.name)}</p>
      <p><strong>الهاتف:</strong> ${escapeHtml(customer.phone)}</p>
      <p><strong>الإيميل:</strong> ${escapeHtml(customer.email)}</p>
      <p><strong>العنوان:</strong> ${escapeHtml(shippingAddress)}</p>

      <hr style="border:none;border-top:1px solid #e2e6ea;margin:14px 0;" />
      <h3 style="margin:0 0 8px;">تفاصيل المنتجات (${itemLines.length})</h3>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#f5f7f9;">
            <th style="padding:8px;border:1px solid #d8dde3;">#</th>
            <th style="padding:8px;border:1px solid #d8dde3;">المنتج</th>
            <th style="padding:8px;border:1px solid #d8dde3;">SKU</th>
            <th style="padding:8px;border:1px solid #d8dde3;">المقاس</th>
            <th style="padding:8px;border:1px solid #d8dde3;">اللون</th>
            <th style="padding:8px;border:1px solid #d8dde3;">الكمية</th>
            <th style="padding:8px;border:1px solid #d8dde3;">سعر الوحدة</th>
            <th style="padding:8px;border:1px solid #d8dde3;">الإجمالي</th>
          </tr>
        </thead>
        <tbody>${htmlRows}</tbody>
      </table>

      <div style="margin-top:14px;">
        <p><strong>المجموع قبل الخصم:</strong> ${subtotal}</p>
        <p><strong>الخصم:</strong> ${discount}</p>
        <p><strong>الإجمالي:</strong> ${total}</p>
      </div>

      ${
        notes
          ? `<div style="margin-top:12px;"><strong>ملاحظات:</strong><br/>${escapeHtml(
              notes
            )}</div>`
          : ""
      }
    </div>
  `;

  const textLines = [
    "طلب جديد من الموقع",
    `رقم الطلب: ${orderId}`,
    createdAt ? `تاريخ الطلب: ${createdAt}` : null,
    `حالة الطلب: ${status}`,
    `طريقة الدفع: ${paymentMethod}`,
    `حالة الدفع: ${paymentStatus}`,
    `مرجع الدفع: ${safeOrder.reference || "-"}`,
    "",
    "بيانات العميل:",
    `الاسم: ${customer.name}`,
    `الهاتف: ${customer.phone}`,
    `الإيميل: ${customer.email}`,
    `العنوان: ${shippingAddress}`,
    "",
    "تفاصيل المنتجات:",
    ...itemLines.map(
      (line) =>
        `${line.idx}. ${line.title} | SKU: ${line.sku} | المقاس: ${line.measure} | اللون: ${line.color} | الكمية: ${line.qty} | سعر الوحدة: ${line.unitPrice} | الإجمالي: ${line.lineTotal}`
    ),
    "",
    `المجموع قبل الخصم: ${subtotal}`,
    `الخصم: ${discount}`,
    `الإجمالي: ${total}`,
    notes ? `ملاحظات: ${notes}` : null,
  ].filter(Boolean);

  return {
    subject,
    html,
    text: textLines.join("\n"),
  };
}

async function sendOrderAlertEmail({ order } = {}) {
  const safeOrder = toPlainObject(order);
  if (!safeOrder) return { ok: false, reason: "missing_order" };

  if (process.env.NODE_ENV === "test" || process.env.ORDER_ALERT_DISABLE === "1") {
    return { ok: false, reason: "disabled" };
  }

  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) {
    return { ok: false, reason: "smtp_not_configured" };
  }

  const toAddress =
    process.env.ORDER_ALERT_TO ||
    process.env.CONTACT_TO ||
    "amacompany92@gmail.com";
  if (!toAddress) {
    return { ok: false, reason: "missing_recipient" };
  }

  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "").trim()
    ? ["1", "true", "yes", "on"].includes(
        String(process.env.SMTP_SECURE).trim().toLowerCase()
      )
    : port === 465;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user: smtpUser, pass: smtpPass },
  });

  const fromAddress = process.env.ORDER_ALERT_FROM || smtpUser;
  const payload = buildOrderAlertEmail({ order: safeOrder });

  await transporter.sendMail({
    from: `"Dikori Orders" <${fromAddress}>`,
    to: toAddress,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
  });

  return { ok: true };
}

function queueOrderAlertEmail(options) {
  if (!options || !options.order) return;

  Promise.resolve()
    .then(() => sendOrderAlertEmail(options))
    .then((result) => {
      if (!result?.ok) {
        const reason = result?.reason || "unknown_reason";
        if (reason === "disabled") {
          return;
        }
        if (reason === "smtp_not_configured" || reason === "missing_recipient") {
          console.warn("Order alert email not sent:", reason);
          return;
        }
        console.warn("Order alert email failed:", reason);
      }
    })
    .catch((err) => {
      console.error("Order alert email error:", err?.message || err);
    });
}

module.exports = {
  buildOrderAlertEmail,
  sendOrderAlertEmail,
  queueOrderAlertEmail,
};
