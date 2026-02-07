// server/routes/order-status.js
const express = require("express");
const mongoose = require("mongoose");
const { verifyToken, isAdmin } = require("../middleware/authMiddleware");
const Order = require("../models/Order");
const { validateBody, validateParams, z } = require("../utils/validate");

const router = express.Router();

const idParamSchema = z.object({ id: z.string().min(1) });
const statusSchema = z.object({
  status: z.enum([
    "waiting_confirmation",
    "pending",
    "on_the_way",
    "delivered",
    "cancelled",
  ]),
});

/**
 * PATCH /api/orders/:id/status
 * body: { status: "waiting_confirmation" | "pending" | "on_the_way" | "delivered" | "cancelled" }
 * - فقط للأدمن
 * - تحقّق من ObjectId وصحة القيمة ضمن enum
 * - يعيد الطلب بعد التحديث
 */
router.patch(
  "/:id/status",
  verifyToken,
  isAdmin,
  validateParams(idParamSchema),
  validateBody(statusSchema),
  async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // تحقّق من صحة الـ ObjectId
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "معرّف الطلب غير صالح" });
    }

    // تحقق من صحة الحالة ضمن enum الخاص بالموديل
    const allowed = new Set([
      "waiting_confirmation",
      "pending",
      "on_the_way",
      "delivered",
      "cancelled",
    ]);
    if (!allowed.has(status)) {
      return res.status(400).json({
        message:
          "قيمة الحالة غير صالحة. القيم المسموح بها: waiting_confirmation | pending | on_the_way | delivered | cancelled",
      });
    }

    const updateSet = { status };
    if (status === "delivered") {
      updateSet.paymentStatus = "paid";
      updateSet.deliveredAt = new Date();
    }

    const updated = await Order.findByIdAndUpdate(
      id,
      { $set: updateSet },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ message: "الطلب غير موجود" });
    }

    return res.json(updated);
  } catch (err) {
    console.error("❌ فشل تحديث حالة الطلب:", err);
    return res.status(500).json({ message: "حدث خطأ أثناء تحديث الحالة" });
  }
  }
);

module.exports = router;
