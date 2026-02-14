// server/routes/order-status.js
const express = require("express");
const mongoose = require("mongoose");
const { verifyToken, isAdmin } = require("../middleware/authMiddleware");
const Order = require("../models/Order");
const {
  queuePaymentConfirmationNotification,
} = require("../utils/paymentConfirmation");
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

const paymentSchema = z
  .object({
    paymentStatus: z.enum(["unpaid", "paid", "failed"]).optional(),
    paymentStatusNote: z.string().trim().max(2000).optional(),
    bankTransferStatus: z
      .enum([
        "pending_contact",
        "instructions_sent",
        "transfer_received",
        "verified",
      ])
      .optional(),
  })
  .refine(
    (value) =>
      typeof value.paymentStatus !== "undefined" ||
      typeof value.paymentStatusNote !== "undefined" ||
      typeof value.bankTransferStatus !== "undefined",
    {
      message:
        "يجب إرسال paymentStatus أو paymentStatusNote أو bankTransferStatus على الأقل",
    }
  );

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

/**
 * PATCH /api/orders/:id/payment
 * body: {
 *   paymentStatus?: "unpaid" | "paid" | "failed",
 *   paymentStatusNote?: string,
 *   bankTransferStatus?: "pending_contact" | "instructions_sent" | "transfer_received" | "verified"
 * }
 */
router.patch(
  "/:id/payment",
  verifyToken,
  isAdmin,
  validateParams(idParamSchema),
  validateBody(paymentSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { paymentStatus, paymentStatusNote, bankTransferStatus } = req.body;

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ message: "معرّف الطلب غير صالح" });
      }

      const existing = await Order.findById(id).lean();
      if (!existing) {
        return res.status(404).json({ message: "الطلب غير موجود" });
      }
      const previousPaymentStatus = String(existing.paymentStatus || "unpaid");

      if (
        typeof bankTransferStatus !== "undefined" &&
        existing.paymentMethod !== "bank_transfer"
      ) {
        return res.status(400).json({
          message: "حالة الحوالة البنكية متاحة فقط للطلبات بطريقة bank_transfer",
        });
      }

      const updateSet = {};
      if (typeof paymentStatus !== "undefined") {
        updateSet.paymentStatus = paymentStatus;
      }
      if (typeof paymentStatusNote !== "undefined") {
        updateSet.paymentStatusNote = String(paymentStatusNote || "").trim();
      }
      if (typeof bankTransferStatus !== "undefined") {
        updateSet.bankTransferStatus = bankTransferStatus;
        if (
          bankTransferStatus === "verified" &&
          typeof updateSet.paymentStatus === "undefined"
        ) {
          updateSet.paymentStatus = "paid";
        }
      }
      const nextPaymentStatus =
        typeof updateSet.paymentStatus !== "undefined"
          ? String(updateSet.paymentStatus)
          : previousPaymentStatus;

      const updated = await Order.findByIdAndUpdate(
        id,
        { $set: updateSet },
        { new: true, runValidators: true }
      ).lean();

      if (!updated) {
        return res.status(404).json({ message: "الطلب غير موجود" });
      }

      if (previousPaymentStatus !== "paid" && nextPaymentStatus === "paid") {
        const noteToSend =
          typeof updateSet.paymentStatusNote !== "undefined"
            ? updateSet.paymentStatusNote
            : existing.paymentStatusNote || "";
        queuePaymentConfirmationNotification({
          order: updated,
          paymentNote: noteToSend,
        });
      }

      return res.json(updated);
    } catch (err) {
      console.error("❌ فشل تحديث حالة الدفع:", err);
      return res.status(500).json({ message: "حدث خطأ أثناء تحديث حالة الدفع" });
    }
  }
);

module.exports = router;
