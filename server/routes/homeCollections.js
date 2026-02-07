// server/routes/homeCollections.js
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const HomeCollections = require("../models/HomeCollections");
const Product = require("../models/Product");
const {
  verifyToken,
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

// ====== Get: كلا القائمتين ======
router.get("/", async (_req, res) => {
  try {
    const doc = await HomeCollections.findOne({})
      .populate("recommended")
      .populate("newArrivals")
      .lean();
    return res.json(doc || { recommended: [], newArrivals: [] });
  } catch (err) {
    console.error("GET /api/home-collections error:", err);
    return res.status(500).json({ message: "خطأ في الخادم" });
  }
});

// ====== Get: المقترحة فقط ======
router.get("/recommended", async (_req, res) => {
  try {
    const doc = await HomeCollections.findOne({}).lean();
    if (!doc) return res.json([]);
    const populated = await HomeCollections.findById(doc._id)
      .populate("recommended")
      .lean();
    const list = Array.isArray(populated?.recommended)
      ? populated.recommended
      : [];
    return res.json(list);
  } catch (err) {
    console.error("GET /api/home-collections/recommended error:", err);
    return res.status(500).json({ message: "خطأ في الخادم" });
  }
});

// ====== Get: الجديد فقط ======
router.get("/new", async (_req, res) => {
  try {
    const doc = await HomeCollections.findOne({}).lean();
    if (!doc) return res.json([]);
    const populated = await HomeCollections.findById(doc._id)
      .populate("newArrivals")
      .lean();
    const list = Array.isArray(populated?.newArrivals)
      ? populated.newArrivals
      : [];
    return res.json(list);
  } catch (err) {
    console.error("GET /api/home-collections/new error:", err);
    return res.status(500).json({ message: "خطأ في الخادم" });
  }
});

module.exports = router;
