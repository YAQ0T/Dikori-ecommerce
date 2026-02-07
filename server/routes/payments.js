// server/routes/payments.js
const express = require("express");
const axios = require("axios");
const { verifyTokenOptional } = require("../middleware/authMiddleware");
const Order = require("../models/Order");
const {
  prepareLahzaPaymentUpdate,
  verifyLahzaTransaction,
  extractCardDetails,
} = require("../utils/lahza");
const { queueOrderSummarySMS } = require("../utils/orderSms");
const {
  extractPaymentTokenFromRequest,
  verifyPaymentToken,
} = require("../utils/paymentTokens");
const { validateBody, validateParams, z } = require("../utils/validate");

const router = express.Router();

const LAHZA_SECRET_KEY = process.env.LAHZA_SECRET_KEY || "";
const DEFAULT_CURRENCY = process.env.PAY_CURRENCY || "ILS";

const paymentCreateSchema = z.object({
  orderId: z.string().min(1),
  currency: z.string().optional(),
  email: z.string().email().optional(),
  name: z.string().optional(),
  mobile: z.string().optional(),
  callback_url: z.string().min(1),
  metadata: z.record(z.any()).optional(),
});

const referenceParamSchema = z.object({ reference: z.string().min(1) });

function splitName(fullName = "") {
  const s = String(fullName || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!s) return { first_name: "", last_name: "" };
  const parts = s.split(" ");
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  return {
    first_name: parts.slice(0, -1).join(" "),
    last_name: parts.slice(-1)[0],
  };
}

function isOrderOwner(order, req) {
  const orderUserId = order?.user?._id;
  const requesterId = req?.user?.id;
  if (orderUserId && requesterId) {
    return String(orderUserId) === String(requesterId);
  }
  return false;
}

function hasPaymentToken(order, req) {
  const token = extractPaymentTokenFromRequest(req);
  if (!token) return false;
  const decoded = verifyPaymentToken(token);
  if (!decoded || !decoded.orderId) return false;
  return String(decoded.orderId) === String(order?._id);
}

function canAccessOrderPayments(order, req) {
  if (!order) return false;
  if (req?.user?.role === "admin") return true;
  if (isOrderOwner(order, req)) return true;
  return hasPaymentToken(order, req);
}

function sanitizeVerification(verification = {}) {
  const card = extractCardDetails({ verification });
  const amountMinor = Number.isFinite(verification.amountMinor)
    ? verification.amountMinor
    : null;
  return {
    status: verification.status || "unknown",
    amountMinor,
    amount:
      amountMinor !== null ? Number((amountMinor / 100).toFixed(2)) : null,
    currency: verification.currency || null,
    transactionId: verification.transactionId || null,
    card: card.cardType || card.last4 ? card : undefined,
  };
}

router.post(
  "/create",
  verifyTokenOptional,
  validateBody(paymentCreateSchema),
  async (req, res) => {
  try {
    if (!LAHZA_SECRET_KEY) {
      return res.status(500).json({ error: "LAHZA secret key is missing" });
    }

    const {
      orderId,
      currency = DEFAULT_CURRENCY,
      email,
      name,
      mobile,
      callback_url,
      metadata = {},
    } = req.body || {};

    if (!orderId || !callback_url) {
      return res.status(400).json({ error: "orderId و callback_url مطلوبان" });
    }

    const order = await Order.findById(orderId).lean();
    if (!order) return res.status(404).json({ error: "الطلب غير موجود" });

    if (!canAccessOrderPayments(order, req)) {
      return res.status(403).json({ error: "غير مصرح للوصول إلى هذا الطلب" });
    }

    if (order.paymentStatus === "paid") {
      return res.status(409).json({ error: "الطلب مدفوع بالفعل" });
    }

    if (order.paymentMethod && order.paymentMethod !== "card") {
      return res.status(400).json({ error: "الطلب غير مهيأ للدفع بالبطاقة" });
    }

    const total = Number(order.total || 0);
    if (!Number.isFinite(total) || total <= 0) {
      return res
        .status(400)
        .json({ error: "إجمالي الطلب غير صالح لإنشاء معاملة دفع" });
    }

    const amountMinor = Math.round(total * 100);
    const { first_name, last_name } = splitName(name);

    const payload = {
      amount: amountMinor,
      currency,
      email,
      mobile,
      first_name,
      last_name,
      callback_url,
      metadata: JSON.stringify({
        ...(metadata && typeof metadata === "object" ? metadata : {}),
        orderId: String(order._id),
        expectedAmountMinor: amountMinor,
        expectedCurrency: currency,
      }),
    };

    const resp = await axios.post(
      "https://api.lahza.io/transaction/initialize",
      payload,
      {
        headers: {
          Authorization: `Bearer ${LAHZA_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      }
    );

    const data = resp?.data?.data || {};
    const authorization_url = data?.authorization_url;
    const reference = data?.reference || data?.ref;

    if (!authorization_url || !reference) {
      return res
        .status(502)
        .json({ error: "Missing authorization_url/reference from Lahza" });
    }

    await Order.findByIdAndUpdate(
      order._id,
      {
        $set: {
          reference,
          paymentMethod: "card",
          paymentCurrency: currency,
        },
      },
      { new: true }
    ).lean();

    return res.json({ authorization_url, reference, orderId: order._id });
  } catch (err) {
    console.error("payments/create error:", err?.message || err);
    return res
      .status(502)
      .json({ error: "Could not create transaction with provider" });
  }
  }
);

router.get(
  "/status/:reference",
  verifyTokenOptional,
  validateParams(referenceParamSchema),
  async (req, res) => {
  try {
    if (!LAHZA_SECRET_KEY) {
      return res.status(500).json({ error: "LAHZA secret key is missing" });
    }

    const reference = req.params.reference;

    const order = await Order.findOne({ reference }).lean();
    if (!order) {
      return res.status(404).json({ error: "الطلب غير موجود لهذا المرجع" });
    }

    if (!canAccessOrderPayments(order, req)) {
      return res.status(403).json({ error: "غير مصرح" });
    }

    let verification;
    try {
      verification = await verifyLahzaTransaction(reference);
    } catch (err) {
      const status = err?.response?.status || 500;
      console.error("payments/status verify error:", err?.message || err);
      return res
        .status(status)
        .json({ error: "فشل التحقق من حالة الدفع" });
    }

    return res.json({
      orderId: order._id,
      ...sanitizeVerification(verification),
    });
  } catch (err) {
    console.error("payments/status error:", err?.message || err);
    return res.status(500).json({ error: "خطأ في التحقق من الحالة" });
  }
  }
);

router.post(
  "/status/:reference/confirm",
  verifyTokenOptional,
  validateParams(referenceParamSchema),
  async (req, res) => {
  try {
    if (!LAHZA_SECRET_KEY) {
      return res.status(500).json({ error: "LAHZA secret key is missing" });
    }

    const reference = req.params.reference;

    const order = await Order.findOne({ reference }).lean();
    if (!order) {
      return res.status(404).json({ error: "الطلب غير موجود لهذا المرجع" });
    }

    if (!canAccessOrderPayments(order, req)) {
      return res.status(403).json({ error: "غير مصرح" });
    }

    let verification;
    try {
      verification = await verifyLahzaTransaction(reference);
    } catch (err) {
      const status = err?.response?.status || 500;
      console.error("payments/confirm verify error:", err?.message || err);
      return res
        .status(status)
        .json({ error: "فشل التحقق من حالة الدفع" });
    }

    const result = {
      updated: false,
      alreadyPaid: false,
      mismatch: false,
      orderId: String(order._id),
    };

    if (verification.status === "success") {
      const {
        amountMatches,
        currencyMatches,
        successSet,
        mismatchSet,
        cardDetails,
      } = prepareLahzaPaymentUpdate({ order, verification });

      if (!amountMatches || !currencyMatches) {
        result.mismatch = true;
        if (Object.keys(mismatchSet).length) {
          await Order.updateOne({ _id: order._id }, { $set: mismatchSet });
        }
      } else {
        const updated = await Order.findOneAndUpdate(
          { _id: order._id, paymentStatus: { $ne: "paid" } },
          { $set: successSet },
          { new: true }
        ).lean();

        if (updated) {
          result.updated = true;
          queueOrderSummarySMS({
            order: updated,
            cardType: cardDetails?.cardType,
            cardLast4: cardDetails?.last4,
          });
        } else {
          result.alreadyPaid = order.paymentStatus === "paid";
          await Order.updateOne({ _id: order._id }, { $set: successSet });
        }
      }
      if (cardDetails.cardType || cardDetails.last4) {
        result.card = cardDetails;
      }
    }

    return res.json({
      ok: true,
      status: verification.status,
      ...result,
      verification: sanitizeVerification(verification),
    });
  } catch (err) {
    console.error("payments/confirm error:", err?.message || err);
    return res.status(500).json({ error: "فشل تأكيد الدفع" });
  }
  }
);

module.exports = router;
