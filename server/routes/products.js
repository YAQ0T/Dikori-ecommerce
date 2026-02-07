// server/routes/products.js
const express = require("express");
const router = express.Router();
const {
  verifyToken,
  isAdmin,
  verifyTokenOptional,
} = require("../middleware/authMiddleware");
const { validateBody, validateParams, z } = require("../utils/validate");

const ProductsController = require("../controllers/products.controller");

const idParamSchema = z.object({ id: z.string().min(1) });
const productSchema = z.object({}).passthrough();
const prioritySchema = z.object({
  priority: z.enum(["A", "B", "C"]).optional(),
});

// طبّق التحقق الاختياري على كل الراوتس (يعرف الدور إن وُجد)
router.use(verifyTokenOptional);

/* =========================
 * CREATE (يدعم priority)
 * ========================= */
router.post(
  "/",
  verifyToken,
  isAdmin,
  validateBody(productSchema),
  ProductsController.create
);

/* =========================
 * READ with-stats (يحترم priority + فلاتر + Pagination + Sorting)
 * ========================= */
router.get("/with-stats", ProductsController.getWithStats);

/* =========================
 * READ suggest (خفيف للبحث)
 * ========================= */
router.get("/suggest", ProductsController.suggest);

/* =========================
 * READ facets (colors & measures) من Variants.tags
 * (إرجاع الأسماء جاهزة بدون استخدام $replaceAll لتفادي مشاكل نسخة Mongo)
 * ========================= */
router.get("/facets", ProductsController.getFacets);

/* =========================
 * READ all (يحترم priority)
 * ========================= */
router.get("/", ProductsController.list);

/* =========================
 * READ one (withVariants=1 اختياري)
 * ========================= */
router.get("/:id", ProductsController.getOne);

/* =========================
 * UPDATE (يشمل priority)
 * ========================= */
router.put(
  "/:id",
  verifyToken,
  isAdmin,
  validateParams(idParamSchema),
  validateBody(productSchema),
  ProductsController.update
);

/* =========================
 * PATCH priority فقط
 * ========================= */
router.patch(
  "/:id/priority",
  verifyToken,
  isAdmin,
  validateParams(idParamSchema),
  validateBody(prioritySchema),
  ProductsController.patchPriority
);

/* =========================
 * DELETE (مع حذف الـVariants)
 * ========================= */
router.delete(
  "/:id",
  verifyToken,
  isAdmin,
  validateParams(idParamSchema),
  ProductsController.remove
);

module.exports = router;
