// server/routes/discountRules.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { verifyToken, isAdmin } = require("../middleware/authMiddleware");
const DiscountRule = require("../models/DiscountRule");
const { validateBody, validateParams, z } = require("../utils/validate");

const idParamSchema = z.object({ id: z.string().min(1) });

const ruleBaseSchema = z.object({
  name: z.string().trim().optional(),
  threshold: z.coerce.number().nonnegative().optional(),
  type: z.enum(["percent", "fixed"]).optional(),
  value: z.coerce.number().nonnegative().optional(),
  isActive: z.boolean().optional(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  priority: z.coerce.number().optional(),
});

const ruleCreateSchema = ruleBaseSchema.extend({
  threshold: z.coerce.number().nonnegative(),
  value: z.coerce.number().nonnegative(),
});

const ruleUpdateSchema = ruleBaseSchema;

// إنشاء قاعدة
router.post(
  "/",
  verifyToken,
  isAdmin,
  validateBody(ruleCreateSchema),
  async (req, res) => {
  try {
    const {
      name,
      threshold,
      type = "percent",
      value,
      isActive = true,
      startAt,
      endAt,
      priority = 0,
    } = req.body || {};

    if (typeof threshold !== "number" || threshold < 0) {
      return res.status(400).json({ message: "threshold مطلوب وبقيمة صحيحة." });
    }
    if (!["percent", "fixed"].includes(type)) {
      return res
        .status(400)
        .json({ message: "type يجب أن يكون percent أو fixed." });
    }
    if (typeof value !== "number" || value < 0) {
      return res.status(400).json({ message: "value مطلوب وبقيمة صحيحة." });
    }

    const rule = await DiscountRule.create({
      name: name || "",
      threshold,
      type,
      value,
      isActive: !!isActive,
      startAt: startAt ? new Date(startAt) : null,
      endAt: endAt ? new Date(endAt) : null,
      priority: Number(priority) || 0,
    });

    res.status(201).json(rule);
  } catch (err) {
    console.error("Error creating discount rule:", err);
    res.status(500).json({ message: "فشل إنشاء قاعدة خصم" });
  }
  }
);

// قائمة القواعد
router.get("/", verifyToken, isAdmin, async (_req, res) => {
  try {
    const rules = await DiscountRule.find()
      .sort({ threshold: 1, priority: -1 })
      .lean();
    res.json(rules);
  } catch (err) {
    console.error("Error fetching discount rules:", err);
    res.status(500).json({ message: "فشل في جلب قواعد الخصم" });
  }
});

// تحديث قاعدة
router.patch(
  "/:id",
  verifyToken,
  isAdmin,
  validateParams(idParamSchema),
  validateBody(ruleUpdateSchema),
  async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ message: "معرّف غير صالح" });

    const payload = { ...req.body };
    if (payload.startAt) payload.startAt = new Date(payload.startAt);
    if (payload.endAt) payload.endAt = new Date(payload.endAt);

    const updated = await DiscountRule.findByIdAndUpdate(
      id,
      { $set: payload },
      { new: true }
    ).lean();
    if (!updated)
      return res.status(404).json({ message: "القاعدة غير موجودة" });

    res.json(updated);
  } catch (err) {
    console.error("Error updating discount rule:", err);
    res.status(500).json({ message: "فشل تحديث قاعدة الخصم" });
  }
  }
);

// حذف قاعدة
router.delete(
  "/:id",
  verifyToken,
  isAdmin,
  validateParams(idParamSchema),
  async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ message: "معرّف غير صالح" });

    const deleted = await DiscountRule.findByIdAndDelete(id).lean();
    if (!deleted)
      return res.status(404).json({ message: "القاعدة غير موجودة" });

    res.json({ message: "تم حذف قاعدة الخصم بنجاح" });
  } catch (err) {
    console.error("Error deleting discount rule:", err);
    res.status(500).json({ message: "فشل حذف قاعدة الخصم" });
  }
  }
);

module.exports = router;
