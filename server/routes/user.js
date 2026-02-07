const express = require("express");
const router = express.Router();
const User = require("../models/User");
const { verifyToken, isAdmin } = require("../middleware/authMiddleware");
const { validateParams, z } = require("../utils/validate");

const idParamSchema = z.object({ id: z.string().min(1) });

// ✅ جلب جميع المستخدمين - محمي بالأدمن فقط
router.get("/", verifyToken, isAdmin, async (req, res) => {
  try {
    const users = await User.find().select("-password"); // لا ترجع الباسورد
    res.json(users);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ message: "فشل في جلب المستخدمين" });
  }
});

// ✅ حذف مستخدم - للأدمن فقط
router.delete(
  "/:id",
  verifyToken,
  isAdmin,
  validateParams(idParamSchema),
  async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "تم حذف المستخدم بنجاح" });
  } catch (err) {
    console.error("Error deleting user:", err);
    res.status(500).json({ message: "فشل في حذف المستخدم" });
  }
  }
);

module.exports = router;
