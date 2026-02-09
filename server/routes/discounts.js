// server/routes/discounts.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const Variant = require("../models/Variant");
const Product = require("../models/Product");
const DiscountRule = require("../models/DiscountRule");
const { validateBody, z } = require("../utils/validate");

const applyDiscountSchema = z.object({
  items: z
    .array(
      z
        .object({
          productId: z.string().min(1),
          quantity: z.coerce.number().optional(),
          sku: z.string().optional(),
          color: z.string().optional(),
          measure: z.string().optional(),
          selectedColor: z.string().optional(),
          selectedMeasure: z.string().optional(),
          name: z.string().optional(),
        })
        .passthrough()
    )
    .min(1),
});

// ===== Helpers (نفس منطق الأسعار والخصم المستخدم في orders.js) =====
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
  return discount.type === "percent"
    ? Math.max(0, amount - (amount * discount.value) / 100)
    : Math.max(0, amount - discount.value);
}
async function findBestDiscountRule(subtotal) {
  const now = new Date();
  const rule = await DiscountRule.findOne({
    isActive: true,
    threshold: { $lte: subtotal },
    $and: [
      { $or: [{ startAt: null }, { startAt: { $lte: now } }] },
      { $or: [{ endAt: null }, { endAt: { $gte: now } }] },
    ],
  })
    .sort({ threshold: -1, priority: -1, createdAt: -1 })
    .lean();
  return rule || null;
}

/**
 * POST /api/discounts/apply
 * body: { items: [{ productId, sku?, color?, measure?, quantity }] }
 * ملاحظات:
 * - نتجاهل أي "price" مرسل من العميل ونقرأ السعر من الـ Variant (لمنع التلاعب).
 * - لا نتحقق من المخزون هنا (اختياري)، لأن الهدف معاينة الخصم فقط.
 */
router.post("/apply", validateBody(applyDiscountSchema), async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ message: "عناصر السلة مطلوبة." });
    }

    let subtotal = 0;
    const cleanItems = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const productId = it.productId;
      const quantity = Math.max(1, Number(it.quantity || 1));
      const color = (it.color || it.selectedColor || "").trim();
      const measure = (it.measure || it.selectedMeasure || "").trim();
      const sku = (it.sku || "").trim();

      if (!mongoose.isValidObjectId(productId)) {
        return res
          .status(400)
          .json({ message: `productId غير صالح في العنصر رقم ${i + 1}` });
      }

      // ابحث عن المتغير: أولوية SKU ثم (product + color + measure)
      let variant;
      if (sku) {
        variant = await Variant.findOne({
          "stock.sku": sku,
          product: productId,
        });
      } else if (measure && color) {
        variant = await Variant.findOne({
          product: productId,
          measure,
          "color.name": color,
        });
      }
      if (!variant) {
        return res.status(404).json({
          message: `لم يتم العثور على المتغير المناسب للعنصر رقم ${i + 1}`,
        });
      }

      const finalPrice = computeFinalAmount(variant.price);
      if (finalPrice <= 0) {
        return res.status(400).json({
          message: `سعر المتغير غير صالح للعنصر رقم ${i + 1}`,
        });
      }

      const product = await Product.findById(productId, {
        name: 1,
        isVisible: 1,
      }).lean();
      if (product && product.isVisible === false) {
        return res.status(409).json({
          message: `المنتج غير متاح حاليًا للعنصر رقم ${i + 1}`,
        });
      }
      cleanItems.push({
        productId: variant.product,
        variantId: variant._id,
        name: product?.name || it.name || "منتج",
        quantity,
        price: finalPrice,
        color: variant.color?.name || color || null,
        measure: variant.measure || measure || null,
        sku: variant.stock?.sku || sku || null,
      });

      subtotal += finalPrice * quantity;
    }

    // طبّق أفضل قاعدة خصم
    let discountInfo = {
      applied: false,
      ruleId: null,
      type: null,
      value: 0,
      amount: 0,
      threshold: 0,
      name: "",
    };

    const rule = await findBestDiscountRule(subtotal);
    if (rule) {
      let amount = 0;
      if (rule.type === "percent") {
        amount = Math.max(0, (subtotal * rule.value) / 100);
      } else if (rule.type === "fixed") {
        amount = Math.max(0, Math.min(rule.value, subtotal));
      }
      discountInfo = {
        applied: amount > 0,
        ruleId: rule._id,
        type: rule.type,
        value: rule.value,
        amount,
        threshold: rule.threshold,
        name: rule.name || "",
      };
    }

    const total = Math.max(0, subtotal - discountInfo.amount);

    return res.json({
      items: cleanItems, // معلومات موحّدة إن احتجتها بالواجهة
      subtotal,
      discount: discountInfo,
      total,
    });
  } catch (err) {
    console.error("Error applying discount:", err);
    return res.status(500).json({ message: "فشل احتساب الخصم" });
  }
});

module.exports = router;
