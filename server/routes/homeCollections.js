// server/routes/homeCollections.js
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const HomeCollections = require("../models/HomeCollections");
const Product = require("../models/Product");
const {
  verifyToken,
  verifyTokenOptional,
  isAdmin /* أو isAdmin فقط */,
} = require("../middleware/authMiddleware");
const { validateBody, z } = require("../utils/validate");

const updateCollectionsSchema = z
  .object({
    recommended: z.array(z.string()).optional(),
    newArrivals: z.array(z.string()).optional(),
    recommendedIds: z.array(z.string()).optional(),
    newArrivalIds: z.array(z.string()).optional(),
  })
  .passthrough();

// ====== Admin/Dealer: حفظ القوائم ======
router.put(
  "/",
  verifyToken,
  isAdmin,
  validateBody(updateCollectionsSchema),
  async (req, res) => {
  try {
    // نقبل الشكلين من الواجهة
    const { recommended, newArrivals, recommendedIds, newArrivalIds } =
      req.body || {};

    let recIds = Array.isArray(recommended)
      ? recommended
      : Array.isArray(recommendedIds)
      ? recommendedIds
      : [];
    let newIds = Array.isArray(newArrivals)
      ? newArrivals
      : Array.isArray(newArrivalIds)
      ? newArrivalIds
      : [];

    // تنظيف وتحويل إلى ObjectId صالحة فقط
    const toValidObjectIds = (ids = []) =>
      ids
        .map((x) => (typeof x === "string" ? x.trim() : x))
        .filter(Boolean)
        .filter((x) => mongoose.isValidObjectId(x))
        .map((x) => new mongoose.Types.ObjectId(x));

    recIds = toValidObjectIds(recIds);
    newIds = toValidObjectIds(newIds);

    // (اختياري) نتأكد أن المنتجات موجودة فعلاً
    const existingRec = await Product.find(
      { _id: { $in: recIds } },
      { _id: 1 }
    ).lean();
    const existingNew = await Product.find(
      { _id: { $in: newIds } },
      { _id: 1 }
    ).lean();
    const onlyValidRec = existingRec.map((d) => d._id);
    const onlyValidNew = existingNew.map((d) => d._id);

    // حفظ كوثيقة وحيدة (singleton)
    const doc = await HomeCollections.findOneAndUpdate(
      {},
      { $set: { recommended: onlyValidRec, newArrivals: onlyValidNew } },
      { upsert: true, new: true }
    );

    // نرجّعها مأهولة لسهولة تحديث الواجهة
    const populated = await HomeCollections.findById(doc._id)
      .populate("recommended")
      .populate("newArrivals")
      .lean();

    return res.json(populated || { recommended: [], newArrivals: [] });
  } catch (err) {
    console.error("PUT /api/home-collections error:", err);
    return res.status(500).json({ message: "خطأ في الخادم" });
  }
  }
);

const canViewHiddenProducts = (role) => role === "admin" || role === "dealer";
const visibleProductMatch = { isVisible: { $ne: false } };
const parseBooleanInput = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return null;
};
const shouldIncludeHidden = (req) => {
  const requested = parseBooleanInput(req?.query?.includeHidden);
  if (requested !== true) return false;
  return canViewHiddenProducts(req?.user?.role);
};

// ====== Get: كلا القائمتين ======
router.get("/", verifyTokenOptional, async (req, res) => {
  try {
    const allowHidden = shouldIncludeHidden(req);
    const doc = await HomeCollections.findOne({})
      .populate({
        path: "recommended",
        ...(allowHidden ? {} : { match: visibleProductMatch }),
      })
      .populate({
        path: "newArrivals",
        ...(allowHidden ? {} : { match: visibleProductMatch }),
      })
      .lean();
    if (!doc) return res.json({ recommended: [], newArrivals: [] });
    return res.json({
      ...doc,
      recommended: Array.isArray(doc.recommended)
        ? doc.recommended.filter(Boolean)
        : [],
      newArrivals: Array.isArray(doc.newArrivals)
        ? doc.newArrivals.filter(Boolean)
        : [],
    });
  } catch (err) {
    console.error("GET /api/home-collections error:", err);
    return res.status(500).json({ message: "خطأ في الخادم" });
  }
});

// ====== Get: المقترحة فقط ======
router.get("/recommended", verifyTokenOptional, async (req, res) => {
  try {
    const allowHidden = shouldIncludeHidden(req);
    const doc = await HomeCollections.findOne({}).lean();
    if (!doc) return res.json([]);
    const populated = await HomeCollections.findById(doc._id)
      .populate({
        path: "recommended",
        ...(allowHidden ? {} : { match: visibleProductMatch }),
      })
      .lean();
    const list = Array.isArray(populated?.recommended)
      ? populated.recommended.filter(Boolean)
      : [];
    return res.json(list);
  } catch (err) {
    console.error("GET /api/home-collections/recommended error:", err);
    return res.status(500).json({ message: "خطأ في الخادم" });
  }
});

// ====== Get: الجديد فقط ======
router.get("/new", verifyTokenOptional, async (req, res) => {
  try {
    const allowHidden = shouldIncludeHidden(req);
    const doc = await HomeCollections.findOne({}).lean();
    if (!doc) return res.json([]);
    const populated = await HomeCollections.findById(doc._id)
      .populate({
        path: "newArrivals",
        ...(allowHidden ? {} : { match: visibleProductMatch }),
      })
      .lean();
    const list = Array.isArray(populated?.newArrivals)
      ? populated.newArrivals.filter(Boolean)
      : [];
    return res.json(list);
  } catch (err) {
    console.error("GET /api/home-collections/new error:", err);
    return res.status(500).json({ message: "خطأ في الخادم" });
  }
});

module.exports = router;
