const express = require("express");
const SiteSettings = require("../models/SiteSettings");
const { verifyToken, isAdmin } = require("../middleware/authMiddleware");
const { validateBody, z } = require("../utils/validate");

const router = express.Router();

const localizedSchema = z
  .object({
    ar: z.string().trim().optional(),
    he: z.string().trim().optional(),
  })
  .optional();

const heroSchema = z
  .object({
    kicker: localizedSchema,
    title: localizedSchema,
    subtitle: localizedSchema,
    imageUrl: z.string().trim().optional(),
    calloutLabel: localizedSchema,
    calloutValue: localizedSchema,
    primaryCtaLabel: localizedSchema,
    secondaryCtaLabel: localizedSchema,
  })
  .optional();

const categorySchema = z
  .object({
    value: z.string().trim().min(1),
    label: localizedSchema,
    imageUrl: z.string().trim().optional(),
    order: z.coerce.number().optional(),
  })
  .passthrough();

const subCategorySchema = z
  .object({
    main: z.string().trim().min(1),
    value: z.string().trim().min(1),
    label: localizedSchema,
    imageUrl: z.string().trim().optional(),
    order: z.coerce.number().optional(),
  })
  .passthrough();

const siteSettingsSchema = z
  .object({
    hero: heroSchema,
    homeCategories: z.array(categorySchema).optional(),
    categoryMenu: z
      .object({
        main: z.array(categorySchema).optional(),
        sub: z.array(subCategorySchema).optional(),
      })
      .optional(),
  })
  .passthrough();

router.get("/", async (_req, res) => {
  try {
    const doc = await SiteSettings.getSingleton();
    return res.json(doc);
  } catch (err) {
    console.error("site-settings get error:", err);
    return res.status(500).json({ message: "تعذّر جلب إعدادات الموقع" });
  }
});

router.put(
  "/",
  verifyToken,
  isAdmin,
  validateBody(siteSettingsSchema),
  async (req, res) => {
    try {
      const payload = req.body || {};
      const doc = await SiteSettings.getSingleton();

      if (payload.hero) {
        doc.hero = {
          ...(doc.hero?.toObject ? doc.hero.toObject() : doc.hero),
          ...payload.hero,
        };
      }

      if (Array.isArray(payload.homeCategories)) {
        doc.homeCategories = payload.homeCategories;
      }

      if (payload.categoryMenu) {
        const currentMenu = doc.categoryMenu?.toObject
          ? doc.categoryMenu.toObject()
          : doc.categoryMenu;
        doc.categoryMenu = {
          ...(currentMenu || {}),
          ...payload.categoryMenu,
        };
        if (Array.isArray(payload.categoryMenu.main)) {
          doc.categoryMenu.main = payload.categoryMenu.main;
        }
        if (Array.isArray(payload.categoryMenu.sub)) {
          doc.categoryMenu.sub = payload.categoryMenu.sub;
        }
      }

      doc.seeded = true;
      await doc.save();
      return res.json(doc);
    } catch (err) {
      console.error("site-settings update error:", err);
      return res.status(500).json({ message: "تعذّر حفظ إعدادات الموقع" });
    }
  }
);

module.exports = router;
