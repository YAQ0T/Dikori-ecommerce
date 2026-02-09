const express = require("express");

// عدّل المسارات حسب مشروعك إذا لزم
const Product = require("../models/Product");
const Variant = require("../models/Variant");
const { mapLocalizedForResponse } = require("../utils/localized");
const { verifyTokenOptional } = require("../middleware/authMiddleware");

const router = express.Router();

/* ===== Helpers: نفس منطق الخصم الذي لديك ===== */
function isDiscountActive(discount = {}) {
  if (!discount || !discount.value) return false;
  const now = new Date();
  if (discount.startAt && now < discount.startAt) return false;
  if (discount.endAt && now > discount.endAt) return false;
  return true;
}

/**
 * GET /api/products/recent-updates
 * - يسترجع المنتجات التي تم تحديثها (product أو variant) خلال X أيام
 * - يدعم: mainCategory, subCategory, q, ownership, tags, page, limit, days
 */
router.get("/recent-updates", verifyTokenOptional, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      days = 14,
      q,
      mainCategory,
      subCategory,
      ownership,
      tags,
      threshold,
    } = req.query;

    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const daysNum = Math.max(1, parseInt(days, 10) || 14);

    const sinceDate = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);

    // Build product query
    const productMatch = {
      $or: [
        { updatedAt: { $gte: sinceDate } },
        { createdAt: { $gte: sinceDate } },
      ],
    };
    const canViewHidden = req.user?.role === "admin" || req.user?.role === "dealer";
    if (!canViewHidden) {
      productMatch.isVisible = { $ne: false };
    }
    if (q) {
      productMatch.$text = { $search: String(q) };
    }
    if (mainCategory) productMatch.mainCategory = String(mainCategory);
    if (subCategory) productMatch.subCategory = String(subCategory);
    if (ownership && ["ours", "local"].includes(String(ownership))) {
      // FIX: use schema field ownershipType
      productMatch.ownershipType = ownership;
    }
    if (tags) {
      const arr =
        typeof tags === "string"
          ? tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [];
      if (arr.length) productMatch.tags = { $in: arr };
    }

    const agg = [
      { $match: productMatch },
      {
        $lookup: {
          from: "variants",
          localField: "_id",
          foreignField: "productId",
          as: "variants",
        },
      },
      {
        $addFields: {
          anyVariantUpdatedRecently: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: "$variants",
                    as: "v",
                    cond: {
                      $or: [
                        { $gte: ["$$v.updatedAt", sinceDate] },
                        { $gte: ["$$v.createdAt", sinceDate] },
                      ],
                    },
                  },
                },
              },
              0,
            ],
          },
        },
      },
      {
        $match: {
          $or: [
            { anyVariantUpdatedRecently: true },
            { updatedAt: { $gte: sinceDate } },
            { createdAt: { $gte: sinceDate } },
          ],
        },
      },
      { $sort: { updatedAt: -1, createdAt: -1 } },
      {
        $facet: {
          meta: [{ $count: "total" }],
          data: [{ $skip: (p - 1) * l }, { $limit: l }],
        },
      },
    ];

    const result = await Product.aggregate(agg);
    const total = result?.[0]?.meta?.[0]?.total || 0;
    const totalPages = Math.ceil(total / l);

    // shape output (calculate final price from variant discount/price)
    const shaped = (result?.[0]?.data || []).map((doc) => {
      const v = Array.isArray(doc.variants) ? doc.variants[0] : null;
      let finalPrice = v?.price?.amount ?? null;
      if (v && v.discount && isDiscountActive(v.discount)) {
        finalPrice =
          v.discount.type === "percent"
            ? Math.max(
                0,
                Math.round((v.price.amount * (100 - v.discount.value)) / 100)
              )
            : Math.max(0, v.price.amount - v.discount.value);
      }
      return {
        _id: doc._id,
        name: mapLocalizedForResponse(doc.name),
        images: doc.images || [],
        mainCategory: doc.mainCategory,
        subCategory: doc.subCategory,
        ownershipType: doc.ownershipType || null,
        tags: doc.tags || [],
        updatedAt: doc.updatedAt,
        createdAt: doc.createdAt,
        firstVariant: v
          ? {
              _id: v._id,
              price: v.price || null,
              discount: v.discount || null,
              finalPrice,
            }
          : null,
      };
    });

    // threshold (min final price) optional filter
    let filtered = shaped;
    const th = Number(threshold);
    if (!Number.isNaN(th)) {
      filtered = shaped.filter(
        (p) => (p.firstVariant?.finalPrice ?? Infinity) >= th
      );
    }

    res.json({
      page: p,
      limit: l,
      data: filtered,
      totalPages,
      total,
      updatedSinceDays: daysNum,
      threshold,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Server error in /recent-updates",
      message: err?.message || "Unknown error",
    });
  }
});

module.exports = router;
