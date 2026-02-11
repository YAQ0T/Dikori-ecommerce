// server/routes/orders.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const axios = require("axios");
const { validateBody, validateParams, z } = require("../utils/validate");

const {
  verifyToken,
  verifyTokenOptional,
  isAdmin,
} = require("../middleware/authMiddleware");

const Order = require("../models/Order");
const Product = require("../models/Product");
const Variant = require("../models/Variant");
const User = require("../models/User");
const DiscountRule = require("../models/DiscountRule");
const { verifyRecaptchaToken } = require("../utils/recaptcha");
const {
  ensureLocalizedObject,
  hasAnyTranslation,
  mapLocalizedForResponse,
} = require("../utils/localized");
const { queueOrderSummarySMS } = require("../utils/orderSms");
const { queueOrderAlertEmail } = require("../utils/orderEmail");
const { issuePaymentToken } = require("../utils/paymentTokens");
const DEFAULT_RECAPTCHA_ACTION = "checkout";
const ENV_MIN_SCORE = Number(process.env.RECAPTCHA_MIN_SCORE);
const DEFAULT_RECAPTCHA_MIN_SCORE = Number.isFinite(ENV_MIN_SCORE)
  ? ENV_MIN_SCORE
  : 0.5;

const orderItemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().optional(),
  name: z.string().optional(),
  quantity: z.coerce.number().int().positive(),
  sku: z.string().optional(),
  color: z.string().nullable().optional(),
  measure: z.string().nullable().optional(),
});

const orderCreateSchema = z
  .object({
    address: z.string().trim().min(1),
    paymentMethod: z.string().optional(),
    paymentStatus: z.string().optional(),
    status: z.string().optional(),
    notes: z.string().optional(),
    items: z.array(orderItemSchema).min(1),
    recaptchaToken: z.string().optional(),
    recaptchaAction: z.string().optional(),
    recaptchaMinScore: z.coerce.number().optional(),
    discount: z.record(z.any()).optional(),
  })
  .passthrough();

const prepareCardSchema = orderCreateSchema.extend({
  guestInfo: z
    .object({
      name: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
    })
    .optional(),
}).passthrough();

const idParamSchema = z.object({ id: z.string().min(1) });
const referenceParamSchema = z.object({ reference: z.string().min(1) });

const isIOSAppRequest = (req) => {
  if (!req || typeof req.get !== "function") {
    return false;
  }

  const header = req.get("x-dikori-client") || req.get("x-app-client");
  if (!header) return false;

  return String(header).trim().toLowerCase() === "ios-app";
};

async function ensureRecaptcha(req, res) {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.RECAPTCHA_TEST_BYPASS === "1"
  ) {
    return true;
  }

  if (isIOSAppRequest(req)) {
    return true;
  }

  const action = isNonEmpty(req.body?.recaptchaAction)
    ? String(req.body.recaptchaAction).trim()
    : DEFAULT_RECAPTCHA_ACTION;
  const requestedMinScore = Number(req.body?.recaptchaMinScore);
  const minScore =
    Number.isFinite(requestedMinScore) && requestedMinScore >= 0
      ? requestedMinScore
      : DEFAULT_RECAPTCHA_MIN_SCORE;

  try {
    await verifyRecaptchaToken({
      token: req.body?.recaptchaToken,
      expectedAction: action,
      minScore,
    });
    return true;
  } catch (err) {
    const status = err?.statusCode || 400;
    if (status >= 500) {
      console.error("reCAPTCHA verification error:", err);
      res.status(status).json({
        message: "خطأ في التحقق من reCAPTCHA",
        error: err?.code || "RECAPTCHA_FAILED",
      });
      return false;
    }

    res.status(400).json({
      message: "فشل التحقق من reCAPTCHA",
      error: err?.code || "RECAPTCHA_FAILED",
      ...(err?.details ? { details: err.details } : {}),
    });
    return false;
  }
}

/* =============== Helpers =============== */
const LAHZA_SECRET_KEY = process.env.LAHZA_SECRET_KEY || "";
const DEFAULT_PAY_CURRENCY = process.env.PAY_CURRENCY || "ILS";
// Minor-unit tolerance shared with webhook handler
const ENV_MINOR_TOLERANCE = Number(process.env.PAYMENT_MINOR_TOLERANCE);
const MINOR_AMOUNT_TOLERANCE = Number.isFinite(ENV_MINOR_TOLERANCE)
  ? Math.max(0, Math.round(ENV_MINOR_TOLERANCE))
  : 1;
const {
  normalizeMinorAmount,
  mapVerificationPayload,
  resolveMinorAmount,
  extractCardDetails,
} = require("../utils/lahza");

async function verifyLahzaCharge(reference) {
  if (!LAHZA_SECRET_KEY) {
    const err = new Error("LAHZA_SECRET_KEY is not configured");
    err.code = "NO_SECRET";
    throw err;
  }

  const url = `https://api.lahza.io/transaction/verify/${encodeURIComponent(
    reference
  )}`;

  const { data } = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${LAHZA_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });

  const payload = mapVerificationPayload(data?.data || {});
  return {
    status: payload.status,
    amountMinor: payload.amountMinor,
    amount: payload.amountMinor != null ? payload.amountMinor / 100 : null,
    currency: payload.currency,
    metadata: payload.metadata,
    transactionId: payload.transactionId,
    raw: data?.data || {},
  };
}

const isNonEmpty = (s) => typeof s === "string" && s.trim().length > 0;
const toOid = (id) =>
  mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : null;
const slugify = (s) =>
  (s || "").toString().trim().toLowerCase().replace(/\s+/g, "-");
const canViewHiddenProducts = (role) => role === "admin" || role === "dealer";

const toDisplayName = (raw) => {
  const normalized = ensureLocalizedObject(raw);
  return normalized.ar || normalized.he || "منتج";
};

function isQuantityTracked(variantDoc) {
  return variantDoc?.trackQuantity === true;
}

function getVariantStock(variantDoc) {
  return Number(
    variantDoc?.stock && typeof variantDoc.stock.inStock !== "undefined"
      ? variantDoc.stock.inStock
      : 0
  );
}

function hasEnoughStock(variantDoc, requestedQty) {
  if (!isQuantityTracked(variantDoc)) return true;
  const qty = getVariantStock(variantDoc);
  return Number.isFinite(qty) && qty >= requestedQty;
}

function buildStockErrorPayload({ variantDoc, requestedQty, itemName }) {
  const available = isQuantityTracked(variantDoc)
    ? Math.max(0, getVariantStock(variantDoc))
    : null;
  const displayName = toDisplayName(itemName);

  if (available === null) {
    return {
      message: `المتغيّر غير متوفر حاليًا لعنصر: ${displayName}`,
      code: "OUT_OF_STOCK",
    };
  }

  return {
    message: `الكمية المطلوبة غير متوفرة لعنصر: ${displayName}. المتاح حاليًا: ${available}، المطلوب: ${requestedQty}`,
    code: "INSUFFICIENT_STOCK",
    details: {
      available,
      requested: requestedQty,
      variantId: variantDoc?._id ? String(variantDoc._id) : null,
      productId: variantDoc?.product ? String(variantDoc.product) : null,
    },
  };
}

function groupItemsByVariant(
  items = [],
  { onlyFlaggedTracked = false } = {}
) {
  const grouped = new Map();
  for (const item of items || []) {
    if (onlyFlaggedTracked && item?.trackQuantity !== true) continue;
    const variantId = item?.variantId ? String(item.variantId) : "";
    if (!variantId) continue;
    const qty = Math.max(1, parseInt(item?.quantity, 10) || 0);
    if (!qty) continue;
    grouped.set(variantId, (grouped.get(variantId) || 0) + qty);
  }
  return grouped;
}

async function incrementTrackedStockByOrderItems(items = [], options = {}) {
  const grouped = groupItemsByVariant(items, options);
  if (!grouped.size) return;
  await Promise.all(
    Array.from(grouped.entries()).map(([variantId, qty]) => {
      const oid = toOid(variantId);
      if (!oid) return null;
      return Variant.updateOne(
        { _id: oid, trackQuantity: true },
        { $inc: { "stock.inStock": qty } }
      );
    }).filter(Boolean)
  );
}

async function decrementTrackedStockByOrderItems(items = [], options = {}) {
  const grouped = groupItemsByVariant(items, options);
  if (!grouped.size) return;

  const applied = [];
  try {
    for (const [variantId, qty] of grouped.entries()) {
      const oid = toOid(variantId);
      if (!oid) continue;

      const result = await Variant.updateOne(
        {
          _id: oid,
          trackQuantity: true,
          "stock.inStock": { $gte: qty },
        },
        { $inc: { "stock.inStock": -qty } }
      );

      if (result.modifiedCount > 0) {
        applied.push({ variantId: oid, qty });
        continue;
      }

      const current = await Variant.findById(oid, {
        _id: 1,
        product: 1,
        trackQuantity: 1,
        stock: 1,
      }).lean();

      if (!current) {
        const err = new Error("المتغيّر غير موجود");
        err.status = 404;
        err.payload = {
          message: "المتغيّر غير موجود",
          code: "VARIANT_NOT_FOUND",
          details: { variantId },
        };
        throw err;
      }

      if (current.trackQuantity !== true) {
        continue;
      }

      const payload = buildStockErrorPayload({
        variantDoc: current,
        requestedQty: qty,
        itemName: null,
      });
      const err = new Error(payload.message);
      err.status = 409;
      err.payload = payload;
      throw err;
    }
  } catch (err) {
    if (applied.length) {
      await Promise.all(
        applied.map((entry) =>
          Variant.updateOne(
            { _id: entry.variantId, trackQuantity: true },
            { $inc: { "stock.inStock": entry.qty } }
          )
        )
      );
    }
    throw err;
  }
}

const resolveItemName = ({
  requestedName,
  productDoc,
}) => {
  const fromProduct = mapLocalizedForResponse(productDoc?.name, {
    defaultEmpty: false,
  });

  if (fromProduct && hasAnyTranslation(fromProduct)) {
    return fromProduct;
  }

  const fromRequest = ensureLocalizedObject(requestedName);
  if (hasAnyTranslation(fromRequest)) {
    return fromRequest;
  }

  return { ar: "منتج", he: "" };
};

function isDiscountActive(discount = {}) {
  if (!discount || !discount.value) return false;
  const now = new Date();
  if (discount.startAt && now < discount.startAt) return false;
  if (discount.endAt && now > discount.endAt) return false;
  return true;
}
function computeFinalAmount(price = {}) {
  const amount = typeof price.amount === "number" ? price.amount : 0;
  if (!amount) return 0;
  const discount = price.discount || {};
  if (!isDiscountActive(discount)) return amount;
  return discount.type === "amount"
    ? Math.max(0, amount - (discount.value || 0))
    : Math.max(0, amount - (amount * (discount.value || 0)) / 100);
}

async function resolveVariant({ productId, sku, measure, color }) {
  if (isNonEmpty(sku)) {
    const viaSku = await Variant.findOne({ "stock.sku": sku.trim() }).lean();
    if (viaSku) return viaSku;
  }
  const pid = toOid(productId);
  if (!pid) return null;

  const measureSlug = isNonEmpty(measure) ? slugify(measure) : null;
  const colorSlug = isNonEmpty(color) ? slugify(color) : null;

  const q = { product: pid };
  if (measureSlug) q.measureSlug = measureSlug;
  if (colorSlug) q.colorSlug = colorSlug;

  const viaDims = await Variant.findOne(q).lean();
  if (viaDims) return viaDims;

  const viaNames = await Variant.findOne({
    product: pid,
    ...(isNonEmpty(measure) ? { measure: measure } : {}),
    ...(isNonEmpty(color) ? { "color.name": color } : {}),
  }).lean();

  return viaNames || null;
}

const EMPTY_DISCOUNT = {
  applied: false,
  ruleId: null,
  type: null,
  value: 0,
  amount: 0,
  threshold: 0,
  name: "",
};

async function findBestDiscountRule(subtotal) {
  const now = new Date();
  const rule = await DiscountRule.findOne({
    isActive: true,
    threshold: { $lte: subtotal },
    $and: [
      {
        $or: [
          { startAt: null },
          { startAt: { $lte: now } },
          { startAt: { $exists: false } },
        ],
      },
      {
        $or: [
          { endAt: null },
          { endAt: { $gte: now } },
          { endAt: { $exists: false } },
        ],
      },
    ],
  })
    .sort({ threshold: -1, priority: -1, createdAt: -1 })
    .lean();

  return rule || null;
}

async function findEligibleRuleById(ruleId, subtotal) {
  if (!ruleId) return null;
  const now = new Date();
  const rule = await DiscountRule.findOne({
    _id: ruleId,
    isActive: true,
    threshold: { $lte: subtotal },
    $and: [
      {
        $or: [
          { startAt: null },
          { startAt: { $lte: now } },
          { startAt: { $exists: false } },
        ],
      },
      {
        $or: [
          { endAt: null },
          { endAt: { $gte: now } },
          { endAt: { $exists: false } },
        ],
      },
    ],
  }).lean();

  return rule || null;
}

function buildDiscountFromRule(rule, subtotal) {
  if (!rule) return { ...EMPTY_DISCOUNT };
  const value = Number(rule.value || 0) || 0;
  let amount = 0;

  if (rule.type === "percent") {
    amount = Math.max(0, (subtotal * value) / 100);
  } else if (rule.type === "fixed") {
    amount = Math.max(0, Math.min(value, subtotal));
  }

  return {
    applied: amount > 0,
    ruleId: rule._id || null,
    type: rule.type || null,
    value,
    amount,
    threshold: Number(rule.threshold || 0) || 0,
    name: rule.name || "",
  };
}

async function computeOrderTotals(items, incomingDiscount) {
  const subtotal = items.reduce((s, it) => s + it.price * it.quantity, 0);

  if (!subtotal) {
    return { subtotal, discount: { ...EMPTY_DISCOUNT }, total: 0 };
  }
  const maybeRuleId = toOid(incomingDiscount?.ruleId);
  const verifiedRule =
    (await findEligibleRuleById(maybeRuleId, subtotal)) ||
    (await findBestDiscountRule(subtotal));

  const discount = buildDiscountFromRule(verifiedRule, subtotal);
  const total = Math.max(0, subtotal - discount.amount);

  return { subtotal, discount, total };
}

/* ======================= إنشاء طلب COD ======================= */
router.post(
  "/",
  verifyTokenOptional,
  validateBody(orderCreateSchema),
  async (req, res) => {
  let stockDecremented = false;
  let stockItemsForRollback = [];
  try {
    const recaptchaOk = await ensureRecaptcha(req, res);
    if (!recaptchaOk) return;

    const {
      address,
      notes,
      items: rawItems,
      paymentMethod = "cod",
      status = "waiting_confirmation",
      discount: incomingDiscount,
    } = req.body || {};

    if (!isNonEmpty(address)) {
      return res.status(400).json({ message: "العنوان مطلوب" });
    }
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return res.status(400).json({ message: "قائمة العناصر مطلوبة" });
    }
    if (paymentMethod !== "cod") {
      return res
        .status(400)
        .json({ message: "طريقة الدفع لهذا المسار يجب أن تكون cod" });
    }

    let userObj = undefined;
    if (req.user?.id) {
      const u = await User.findById(req.user.id).lean();
      if (u) {
        userObj = {
          _id: u._id,
          name: u.name || "",
          phone: u.phone || "",
          email: u.email || "",
        };
      }
    }

    const productCache = new Map();
    const cleanItems = [];
    for (const it of rawItems) {
      const pid = toOid(it?.productId);
      const qty = Math.max(1, parseInt(it?.quantity, 10) || 0);
      if (!pid || !qty) continue;

      let variant = null;
      if (it?.variantId && toOid(it.variantId)) {
        variant = await Variant.findOne({
          _id: toOid(it.variantId),
          product: pid,
        }).lean();
      }
      if (!variant) {
        variant = await resolveVariant({
          productId: pid,
          sku: it?.sku,
          measure: it?.measure,
          color: it?.color,
        });
      }
      if (!variant) {
        return res.status(400).json({
          message: `تعذّر إيجاد المتغيّر لعنصر: ${toDisplayName(it?.name)}`,
        });
      }

      if (!hasEnoughStock(variant, qty)) {
        return res
          .status(409)
          .json(
            buildStockErrorPayload({
              variantDoc: variant,
              requestedQty: qty,
              itemName: it?.name,
            })
          );
      }

      const price = computeFinalAmount(variant.price || { amount: 0 });

      let productDoc = productCache.get(String(pid));
      if (!productDoc) {
        productDoc = await Product.findById(pid, {
          name: 1,
          images: 1,
          isVisible: 1,
        }).lean();
        if (productDoc) {
          productCache.set(String(pid), productDoc);
        }
      }
      if (
        productDoc &&
        productDoc.isVisible === false &&
        !canViewHiddenProducts(req.user?.role)
      ) {
        return res.status(409).json({
          message: `المنتج غير متاح حاليًا: ${toDisplayName(it?.name)}`,
        });
      }

      const localizedName = resolveItemName({
        requestedName: it?.name,
        productDoc,
      });

      let image = it?.image || "";
      if (!image) {
        const vcImgs = Array.isArray(variant?.color?.images)
          ? variant.color.images.filter(Boolean)
          : [];
        if (vcImgs.length) image = vcImgs[0];
        else {
          if (productDoc?.images?.length) image = productDoc.images[0];
        }
      }

      cleanItems.push({
        productId: pid,
        variantId: variant._id,
        name: localizedName,
        quantity: qty,
        trackQuantity: variant.trackQuantity === true,
        price,
        color: isNonEmpty(it?.color) ? String(it.color).trim() : undefined,
        measure: isNonEmpty(it?.measure)
          ? String(it.measure).trim()
          : undefined,
        sku: isNonEmpty(it?.sku)
          ? String(it.sku).trim()
          : variant?.stock?.sku || undefined,
        image: image || undefined,
      });
    }

    if (cleanItems.length === 0) {
      return res
        .status(400)
        .json({ message: "لم يتمكّن الخادم من بناء عناصر صالحة للطلب" });
    }

    const { subtotal, discount, total } = await computeOrderTotals(
      cleanItems,
      incomingDiscount
    );

    await decrementTrackedStockByOrderItems(cleanItems, {
      onlyFlaggedTracked: true,
    });
    stockDecremented = true;
    stockItemsForRollback = cleanItems;

    const doc = await Order.create({
      user: userObj,
      guestInfo: { name: "", phone: "", email: "", address: "" },
      isGuest: !userObj,
      items: cleanItems,
      subtotal,
      discount,
      total,
      address: String(address).trim(),
      status: [
        "pending",
        "waiting_confirmation",
        "on_the_way",
        "delivered",
        "cancelled",
      ].includes(status)
        ? status
        : "waiting_confirmation",
      paymentMethod: "cod",
      paymentCurrency: DEFAULT_PAY_CURRENCY,
      paymentStatus: "unpaid",

      reference: null,
      notes: isNonEmpty(notes) ? String(notes).trim() : "",
    });
    stockDecremented = false;
    stockItemsForRollback = [];

    queueOrderSummarySMS({
      order: doc,
      cardType: "الدفع عند الاستلام",
    });
    queueOrderAlertEmail({ order: doc });

    return res.status(201).json(doc);
  } catch (err) {
    if (stockDecremented) {
      try {
        await incrementTrackedStockByOrderItems(stockItemsForRollback, {
          onlyFlaggedTracked: true,
        });
      } catch (rollbackErr) {
        console.error("POST /api/orders rollback stock error:", rollbackErr);
      }
    }
    if (err?.status && err?.payload) {
      return res.status(err.status).json(err.payload);
    }
    console.error("POST /api/orders error:", err);
    return res.status(500).json({ message: "فشل إنشاء طلب COD" });
  }
  }
);

/* ==================== تحضير طلب للبطاقة ==================== */
router.post(
  "/prepare-card",
  verifyTokenOptional,
  validateBody(prepareCardSchema),
  async (req, res) => {
  try {
    const recaptchaOk = await ensureRecaptcha(req, res);
    if (!recaptchaOk) return;

    const {
      address,
      notes,
      items: rawItems,
      guestInfo,
      discount: incomingDiscount,
    } = req.body || {};

    if (!isNonEmpty(address)) {
      return res.status(400).json({ message: "العنوان مطلوب" });
    }
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return res.status(400).json({ message: "قائمة العناصر مطلوبة" });
    }

    let userObj = undefined;
    let guestObj = { name: "", phone: "", email: "", address: "" };

    if (req.user?.id) {
      const u = await User.findById(req.user.id).lean();
      if (u) {
        userObj = {
          _id: u._id,
          name: u.name || "",
          phone: u.phone || "",
          email: u.email || "",
        };
      }
    } else if (guestInfo && typeof guestInfo === "object") {
      guestObj = {
        name: isNonEmpty(guestInfo.name) ? guestInfo.name.trim() : "",
        phone: isNonEmpty(guestInfo.phone) ? guestInfo.phone.trim() : "",
        email: isNonEmpty(guestInfo.email) ? guestInfo.email.trim() : "",
        address: isNonEmpty(guestInfo.address) ? guestInfo.address.trim() : "",
      };
    }

    const productCache = new Map();
    const cleanItems = [];
    for (const it of rawItems) {
      const pid = toOid(it?.productId);
      const qty = Math.max(1, parseInt(it?.quantity, 10) || 0);
      if (!pid || !qty) continue;

      let variant = null;
      if (it?.variantId && toOid(it.variantId)) {
        variant = await Variant.findOne({
          _id: toOid(it.variantId),
          product: pid,
        }).lean();
      }
      if (!variant) {
        variant = await resolveVariant({
          productId: pid,
          sku: it?.sku,
          measure: it?.measure,
          color: it?.color,
        });
      }
      if (!variant) {
        return res
          .status(400)
          .json({
            message: `تعذّر إيجاد المتغيّر لعنصر: ${toDisplayName(it?.name)}`,
          });
      }

      if (!hasEnoughStock(variant, qty)) {
        return res
          .status(409)
          .json(
            buildStockErrorPayload({
              variantDoc: variant,
              requestedQty: qty,
              itemName: it?.name,
            })
          );
      }

      const price = computeFinalAmount(variant.price || { amount: 0 });

      let productDoc = productCache.get(String(pid));
      if (!productDoc) {
        productDoc = await Product.findById(pid, {
          name: 1,
          images: 1,
          isVisible: 1,
        }).lean();
        if (productDoc) {
          productCache.set(String(pid), productDoc);
        }
      }
      if (
        productDoc &&
        productDoc.isVisible === false &&
        !canViewHiddenProducts(req.user?.role)
      ) {
        return res.status(409).json({
          message: `المنتج غير متاح حاليًا: ${toDisplayName(it?.name)}`,
        });
      }

      const localizedName = resolveItemName({
        requestedName: it?.name,
        productDoc,
      });

      let image = it?.image || "";
      if (!image) {
        const vcImgs = Array.isArray(variant?.color?.images)
          ? variant.color.images.filter(Boolean)
          : [];
        if (vcImgs.length) image = vcImgs[0];
        else {
          if (productDoc?.images?.length) image = productDoc.images[0];
        }
      }

      cleanItems.push({
        productId: pid,
        variantId: variant._id,
        name: localizedName,
        quantity: qty,
        price,
        color: isNonEmpty(it?.color) ? String(it.color).trim() : undefined,
        measure: isNonEmpty(it?.measure)
          ? String(it.measure).trim()
          : undefined,
        sku: isNonEmpty(it?.sku)
          ? String(it.sku).trim()
          : variant?.stock?.sku || undefined,
        image: image || undefined,
      });
    }

    if (cleanItems.length === 0) {
      return res
        .status(400)
        .json({ message: "لم يتمكّن الخادم من بناء عناصر صالحة للطلب" });
    }

    const { subtotal, discount, total } = await computeOrderTotals(
      cleanItems,
      incomingDiscount
    );

    const doc = await Order.create({
      user: userObj,
      guestInfo: userObj
        ? { name: "", phone: "", email: "", address: "" }
        : guestObj,
      isGuest: !userObj,
      items: cleanItems,
      subtotal,
      discount,
      total,
      address: String(address).trim(),
      status: "waiting_confirmation",
      paymentMethod: "card",
      paymentCurrency: DEFAULT_PAY_CURRENCY,
      paymentStatus: "unpaid",
      reference: null,
      notes: isNonEmpty(notes) ? String(notes).trim() : "",
    });
    queueOrderAlertEmail({ order: doc });

    const paymentToken = issuePaymentToken(doc._id);

    return res
      .status(201)
      .json({ _id: doc._id, total: doc.total, paymentToken });
  } catch (err) {
    console.error("POST /api/orders/prepare-card error:", err);
    return res.status(500).json({ message: "فشل تحضير طلب البطاقة" });
  }
  }
);

/* =========== وسم الطلب مدفوعًا بالمرجع =========== */
router.patch(
  "/by-reference/:reference/pay",
  verifyToken,
  isAdmin,
  validateParams(referenceParamSchema),
  async (req, res) => {
    try {
      const reference = String(req.params.reference || "").trim();
      if (!reference)
        return res.status(400).json({ message: "reference مطلوب" });

      const order = await Order.findOne({ reference }).lean();
      if (!order) {
        return res.status(404).json({ message: "طلب غير موجود لهذا المرجع" });
      }

      let verification;
      try {
        verification = await verifyLahzaCharge(reference);
        if (!verification || verification.status !== "success") {
          return res
            .status(400)
            .json({ message: "فشل تأكيد الدفع من لحظة لهذا المرجع" });
        }
      } catch (err) {
        if (err?.code === "NO_SECRET") {
          console.error("LAHZA_SECRET_KEY is missing when verifying payment");
          return res.status(500).json({ message: "مفتاح لحظة غير مهيأ" });
        }
        console.error("Error verifying Lahza payment:", err?.message || err);
        return res
          .status(502)
          .json({ message: "تعذر التحقق من الدفع من لحظة، حاول لاحقًا" });
      }

      const cardDetails = extractCardDetails({ verification });
      const metadataExpected = resolveMinorAmount({
        candidates: [
          verification.metadata?.expectedAmountMinor,
          verification.metadata?.amountMinor,
        ],
      });
      const fallbackExpected = Math.round(Number(order.total || 0) * 100);
      const amountMinor = resolveMinorAmount({
        candidates: [
          verification.amountMinor,
          verification.raw?.amount_minor,
          verification.raw?.amountMinor,
          verification.raw?.amount,
          verification.metadata?.amountMinor,
          verification.metadata?.expectedAmountMinor,
        ],
        expectedMinor:
          metadataExpected !== null && Number.isFinite(metadataExpected)
            ? metadataExpected
            : fallbackExpected,
      });
      const expectedMinor = Math.round(Number(order.total || 0) * 100);
      const amountDelta =
        typeof amountMinor === "number" && Number.isFinite(amountMinor)
          ? Math.abs(amountMinor - expectedMinor)
          : null;
      const amountMatches =
        typeof amountMinor === "number" && Number.isFinite(amountMinor)
          ? amountDelta <= MINOR_AMOUNT_TOLERANCE
          : false;

      const actualCurrency = (verification.currency || "")
        .toString()
        .trim()
        .toUpperCase();
      const expectedCurrency = (order.paymentCurrency || DEFAULT_PAY_CURRENCY || "")
        .toString()
        .trim()
        .toUpperCase();
      const currencyMatches = expectedCurrency
        ? actualCurrency && actualCurrency === expectedCurrency
        : true;

      const amountForStorage =
        typeof amountMinor === "number" && Number.isFinite(amountMinor)
          ? Number((amountMinor / 100).toFixed(2))
          : null;
      const transactionId = verification.transactionId || null;

      const paymentDetailsUpdate = {};
      if (amountForStorage !== null)
        paymentDetailsUpdate.paymentVerifiedAmount = amountForStorage;
      if (actualCurrency)
        paymentDetailsUpdate.paymentVerifiedCurrency = actualCurrency;
      if (transactionId)
        paymentDetailsUpdate.paymentTransactionId = String(transactionId);

      if (!amountMatches || !currencyMatches) {
        console.error("🚫 Admin pay: تعارض في مبلغ/عملة الدفع", {
          reference,
          amountMinor,
          expectedMinor,
          amountDelta,
          toleranceMinor: MINOR_AMOUNT_TOLERANCE,
          actualCurrency,
          expectedCurrency,
        });

        if (Object.keys(paymentDetailsUpdate).length) {
          await Order.updateOne({ _id: order._id }, { $set: paymentDetailsUpdate });
        }

        return res.status(400).json({
          message: "مبلغ أو عملة الدفع لا تطابق الطلب",
          details: {
            expectedAmountMinor: expectedMinor,
            actualAmountMinor: amountMinor ?? null,
            amountDelta: amountDelta ?? null,
            toleranceMinor: MINOR_AMOUNT_TOLERANCE,
            expectedCurrency,
            actualCurrency: actualCurrency || null,
          },
        });
      }

      const updateSet = {
        paymentStatus: "paid",
        status: "waiting_confirmation",
        ...paymentDetailsUpdate,
      };
      if (!order.paymentCurrency && actualCurrency) {
        updateSet.paymentCurrency = actualCurrency;
      }
      if (cardDetails.cardType) {
        updateSet.paymentCardType = cardDetails.cardType;
      }
      if (cardDetails.last4) {
        updateSet.paymentCardLast4 = cardDetails.last4;
      }

      await decrementTrackedStockByOrderItems(order.items || []);

      const updated = await Order.findOneAndUpdate(
        { _id: order._id, paymentStatus: { $ne: "paid" } },
        { $set: updateSet },
        { new: true }
      ).lean();

      if (!updated) {
        try {
          await incrementTrackedStockByOrderItems(order.items || []);
        } catch (rollbackErr) {
          console.error("Admin pay rollback stock error:", rollbackErr);
        }
        await Order.updateOne({ _id: order._id }, { $set: updateSet });
        const existing = await Order.findOne({ _id: order._id }).lean();
        return res.json({ message: "الطلب مدفوع مسبقًا", order: existing });
      }

      queueOrderSummarySMS({
        order: updated,
        cardType: cardDetails.cardType,
        cardLast4: cardDetails.last4,
      });

      return res.json(updated);
    } catch (err) {
      console.error("Error marking order paid:", err);
      if (err?.status && err?.payload) {
        return res.status(err.status).json(err.payload);
      }
      res.status(500).json({ message: "فشل وسم الطلب مدفوع" });
    }
  }
);
/* ==================== تفاصيل طلب بالمرجع (قراءة فقط) ==================== */
router.get("/by-reference/:reference", verifyToken, async (req, res) => {
  try {
    const reference = String(req.params.reference || "").trim();
    if (!reference) {
      return res.status(400).json({ message: "reference مطلوب" });
    }

    const order = await Order.findOne({ reference }).lean();
    if (!order) {
      return res.status(404).json({ message: "الطلب غير موجود" });
    }

    const isOwner =
      order?.user?._id && String(order.user._id) === String(req.user?.id);
    const isAdminUser = req.user?.role === "admin";

    if (!isOwner && !isAdminUser) {
      return res.status(403).json({ message: "غير مصرح" });
    }

    return res.json(order);
  } catch (err) {
    console.error("GET /api/orders/by-reference/:reference error:", err);
    return res.status(500).json({ message: "فشل في جلب تفاصيل الطلب" });
  }
});

/* ======================= طلباتي (قائمة) ======================= */
router.get("/mine", verifyToken, async (req, res) => {
  try {
    const uid = req.user?.id;
    if (!uid || !mongoose.isValidObjectId(uid)) {
      return res.status(401).json({ message: "توكن غير صالح" });
    }

    const orders = await Order.find({ "user._id": uid })
      .sort({ createdAt: -1 })
      .lean();

    return res.json(orders || []);
  } catch (err) {
    console.error("GET /api/orders/mine error:", err);
    return res.status(500).json({ message: "فشل في جلب الطلبات" });
  }
});

/* ======================= طلبات مستخدم معين (قائمة) ======================= */
router.get("/user/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "معرّف المستخدم غير صالح" });
    }

    const isOwner = String(req.user?.id) === String(id);
    const isAdminUser = req.user?.role === "admin";

    if (!isOwner && !isAdminUser) {
      return res.status(403).json({ message: "غير مصرح" });
    }

    const orders = await Order.find({ "user._id": id })
      .sort({ createdAt: -1 })
      .lean();

    return res.json(orders || []);
  } catch (err) {
    console.error("GET /api/orders/user/:id error:", err);
    return res.status(500).json({ message: "فشل في جلب الطلبات" });
  }
});

/* ======================= تفاصيل طلب واحد (بالمسار الأبسط) ======================= */
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "معرّف الطلب غير صالح" });
    }

    const order = await Order.findById(id).lean();
    if (!order) return res.status(404).json({ message: "الطلب غير موجود" });

    const isOwner =
      order?.user?._id && String(order.user._id) === String(req.user?.id);
    const isAdminUser = req.user?.role === "admin";

    if (!isOwner && !isAdminUser) {
      return res.status(403).json({ message: "غير مصرح" });
    }

    return res.json(order);
  } catch (err) {
    console.error("GET /api/orders/:id error:", err);
    return res.status(500).json({ message: "فشل في جلب تفاصيل الطلب" });
  }
});

/* ======================= تفاصيل طلب واحد (يطابق مسارك الحالي) =======================
   GET /api/orders/user/:userId/order/:orderId
   - يبقي الواجهة كما هي بدون تعديل
==================================================================================== */
router.get("/user/:userId/order/:orderId", verifyToken, async (req, res) => {
  try {
    const { userId, orderId } = req.params;

    if (
      !mongoose.isValidObjectId(userId) ||
      !mongoose.isValidObjectId(orderId)
    ) {
      return res.status(400).json({ message: "معرّفات غير صالحة" });
    }

    const order = await Order.findOne({
      _id: orderId,
      "user._id": userId,
    }).lean();

    if (!order) return res.status(404).json({ message: "الطلب غير موجود" });

    const isOwner = String(req.user?.id) === String(userId);
    const isAdminUser = req.user?.role === "admin";
    if (!isOwner && !isAdminUser) {
      return res.status(403).json({ message: "غير مصرح" });
    }

    return res.json(order);
  } catch (err) {
    console.error("GET /api/orders/user/:userId/order/:orderId error:", err);
    return res.status(500).json({ message: "فشل في جلب تفاصيل الطلب" });
  }
});

/* ======================= حذف طلب (أدمن) ======================= */
router.delete(
  "/:id",
  verifyToken,
  isAdmin,
  validateParams(idParamSchema),
  async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "معرّف الطلب غير صالح" });
    }

    const deleted = await Order.findByIdAndDelete(id).lean();

    if (!deleted) {
      return res.status(404).json({ message: "الطلب غير موجود" });
    }

    return res.json({ message: "تم حذف الطلب", order: deleted });
  } catch (err) {
    console.error("DELETE /api/orders/:id error:", err);
    return res.status(500).json({ message: "فشل حذف الطلب" });
  }
  }
);

/* ======================= كل الطلبات (أدمن) ======================= */
router.get("/", verifyToken, isAdmin, async (_req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).lean();
    res.json(orders);
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ message: "فشل في جلب الطلبات" });
  }
});

module.exports = router;
