const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const Notification = require("../models/Notification");
const User = require("../models/User");
const { verifyToken, isAdmin } = require("../middleware/authMiddleware");
const { validateBody, validateParams, z } = require("../utils/validate");

const idParamSchema = z.object({ id: z.string().min(1) });

const createNotificationSchema = z
  .object({
    title: z.string().trim().min(1),
    message: z.string().trim().min(1),
    target: z.enum(["all", "user"]).optional(),
    userId: z.string().optional(),
  })
  .refine((data) => (data.target === "user" ? !!data.userId : true), {
    message: "user_required",
    path: ["userId"],
  });

// ✅ إنشاء إشعار جديد (أدمن فقط)
router.post(
  "/",
  verifyToken,
  isAdmin,
  validateBody(createNotificationSchema),
  async (req, res) => {
  const { title, message, target = "all", userId } = req.body || {};

  const trimmedTitle = String(title || "").trim();
  const trimmedMessage = String(message || "").trim();
  const normalizedTarget = target === "user" ? "user" : "all";

  if (!trimmedTitle) {
    return res.status(400).json({ message: "العنوان مطلوب" });
  }

  if (!trimmedMessage) {
    return res.status(400).json({ message: "نص الإشعار مطلوب" });
  }

  try {
    let user = null;
    if (normalizedTarget === "user") {
      if (!userId) {
        return res
          .status(400)
          .json({ message: "يجب تحديد المستخدم عند اختيار إشعار مخصص" });
      }
      user = await User.findById(userId).select("_id name email phone");
      if (!user) {
        return res
          .status(404)
          .json({ message: "المستخدم المطلوب غير موجود" });
      }
    }

    const notification = await Notification.create({
      title: trimmedTitle,
      message: trimmedMessage,
      target: normalizedTarget,
      user: normalizedTarget === "user" ? user._id : undefined,
    });

    const populated = await notification.populate("user", "name email phone");

    return res.status(201).json(populated);
  } catch (err) {
    console.error("Failed to create notification", err);
    return res
      .status(500)
      .json({ message: "تعذّر إنشاء الإشعار، حاول مرة أخرى لاحقًا" });
  }
  }
);

// ✅ جلب كل الإشعارات (أدمن فقط)
router.get("/", verifyToken, isAdmin, async (_req, res) => {
  try {
    const notifications = await Notification.find()
      .sort({ createdAt: -1 })
      .populate("user", "name email phone")
      .lean();

    return res.json(Array.isArray(notifications) ? notifications : []);
  } catch (err) {
    console.error("Failed to fetch notifications", err);
    return res
      .status(500)
      .json({ message: "تعذّر جلب الإشعارات، حاول مرة أخرى لاحقًا" });
  }
});

// ✅ جلب إشعارات المستخدم الحالي
router.get("/my", verifyToken, async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: "يرجى تسجيل الدخول أولًا" });
  }

  try {
    const notifications = await Notification.find({
      $or: [
        { target: "all" },
        { target: "user", user: userId },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const mapped = notifications.map((n) => ({
      _id: n._id,
      title: n.title,
      message: n.message,
      target: n.target,
      createdAt: n.createdAt,
      isRead: Array.isArray(n.readBy)
        ? n.readBy.some((reader) => String(reader) === String(userId))
        : false,
    }));

    return res.json(mapped);
  } catch (err) {
    console.error("Failed to fetch user notifications", err);
    return res
      .status(500)
      .json({ message: "تعذّر جلب الإشعارات، حاول مرة أخرى لاحقًا" });
  }
});

// ✅ تعليم الإشعار كمقروء للمستخدم الحالي
router.patch(
  "/:id/read",
  verifyToken,
  validateParams(idParamSchema),
  async (req, res) => {
  const userId = req.user?.id;
  const { id } = req.params;

  if (!userId) {
    return res.status(401).json({ message: "يرجى تسجيل الدخول أولًا" });
  }

  try {
    const notification = await Notification.findOneAndUpdate(
      {
        _id: id,
        $or: [
          { target: "all" },
          { target: "user", user: userId },
        ],
      },
      { $addToSet: { readBy: userId } },
      { new: true }
    )
      .select("_id title message target createdAt readBy")
      .lean();

    if (!notification) {
      return res.status(404).json({ message: "الإشعار غير موجود" });
    }

    const isRead = Array.isArray(notification.readBy)
      ? notification.readBy.some((reader) => String(reader) === String(userId))
      : false;

    return res.json({
      _id: notification._id,
      title: notification.title,
      message: notification.message,
      target: notification.target,
      createdAt: notification.createdAt,
      isRead,
    });
  } catch (err) {
    console.error("Failed to mark notification as read", err);
    return res
      .status(500)
      .json({ message: "تعذّر تحديث الإشعار، حاول مرة أخرى لاحقًا" });
  }
  }
);

// ✅ حذف إشعار (أدمن فقط)
router.delete(
  "/:id",
  verifyToken,
  isAdmin,
  validateParams(idParamSchema),
  async (req, res) => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "معرّف الإشعار غير صالح" });
  }

  try {
    const deletedNotification = await Notification.findByIdAndDelete(id).lean();

    if (!deletedNotification) {
      return res.status(404).json({ message: "الإشعار غير موجود" });
    }

    return res.json({
      message: "تم حذف الإشعار",
      notification: deletedNotification,
    });
  } catch (err) {
    console.error("Failed to delete notification", err);
    return res
      .status(500)
      .json({ message: "تعذّر حذف الإشعار، حاول مرة أخرى لاحقًا" });
  }
  }
);

module.exports = router;
