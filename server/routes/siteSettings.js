const express = require("express");
const SiteSettings = require("../models/SiteSettings");
const Product = require("../models/Product");
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

      const normalize = (value) => String(value || "").trim();
      const pickPrevValue = (item) =>
        typeof item?.prevValue === "string"
          ? item.prevValue
          : typeof item?.__prevValue === "string"
            ? item.__prevValue
            : typeof item?._prevValue === "string"
              ? item._prevValue
              : null;
      const pickPrevMain = (item) =>
        typeof item?.prevMain === "string"
          ? item.prevMain
          : typeof item?.__prevMain === "string"
            ? item.__prevMain
            : typeof item?._prevMain === "string"
              ? item._prevMain
              : null;

      const mainRenames = [];
      const subRenames = [];

      if (Array.isArray(payload.categoryMenu?.sub)) {
        payload.categoryMenu.sub.forEach((item) => {
          const prevMain = pickPrevMain(item);
          const prevValue = pickPrevValue(item);
          if (!prevMain || !prevValue) return;
          const nextMain = normalize(item.main);
          const nextValue = normalize(item.value);
          const fromMain = normalize(prevMain);
          const fromValue = normalize(prevValue);
          if (
            fromMain &&
            fromValue &&
            (fromMain !== nextMain || fromValue !== nextValue)
          ) {
            subRenames.push({
              fromMain,
              fromSub: fromValue,
              toMain: nextMain,
              toSub: nextValue,
            });
          }
        });
      }

      if (Array.isArray(payload.categoryMenu?.main)) {
        payload.categoryMenu.main.forEach((item) => {
          const prevValue = pickPrevValue(item);
          if (!prevValue) return;
          const nextValue = normalize(item.value);
          const fromValue = normalize(prevValue);
          if (fromValue && nextValue && fromValue !== nextValue) {
            mainRenames.push({ from: fromValue, to: nextValue });
          }
        });
      }

      if (payload.hero) {
        doc.hero = {
          ...(doc.hero?.toObject ? doc.hero.toObject() : doc.hero),
          ...payload.hero,
        };
      }

      if (Array.isArray(payload.homeCategories)) {
        doc.homeCategories = payload.homeCategories
          .map((item) => ({
            value: normalize(item.value),
            label: item.label,
            imageUrl: normalize(item.imageUrl),
            order: typeof item.order === "number" ? item.order : 0,
          }))
          .filter((item) => item.value);
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
          doc.categoryMenu.main = payload.categoryMenu.main
            .map((item) => ({
              value: normalize(item.value),
              label: item.label,
              imageUrl: normalize(item.imageUrl),
              order: typeof item.order === "number" ? item.order : 0,
            }))
            .filter((item) => item.value);
        }
        if (Array.isArray(payload.categoryMenu.sub)) {
          doc.categoryMenu.sub = payload.categoryMenu.sub
            .map((item) => ({
              main: normalize(item.main),
              value: normalize(item.value),
              label: item.label,
              imageUrl: normalize(item.imageUrl),
              order: typeof item.order === "number" ? item.order : 0,
            }))
            .filter((item) => item.main && item.value);
        }
      }

      doc.seeded = true;
      await doc.save();

      if (subRenames.length || mainRenames.length) {
        const ops = [];
        subRenames.forEach((rename) => {
          ops.push(
            Product.updateMany(
              {
                mainCategory: rename.fromMain,
                subCategory: rename.fromSub,
              },
              {
                $set: {
                  mainCategory: rename.toMain,
                  subCategory: rename.toSub,
                },
              }
            )
          );
        });
        mainRenames.forEach((rename) => {
          ops.push(
            Product.updateMany(
              { mainCategory: rename.from },
              { $set: { mainCategory: rename.to } }
            )
          );
        });
        await Promise.all(ops);
      }
      return res.json(doc);
    } catch (err) {
      console.error("site-settings update error:", err);
      return res.status(500).json({ message: "تعذّر حفظ إعدادات الموقع" });
    }
  }
);

module.exports = router;
