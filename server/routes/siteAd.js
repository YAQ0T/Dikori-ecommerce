const express = require("express");
const mongoose = require("mongoose");
const SiteAd = require("../models/SiteAd");
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

const siteAdSchema = z
  .object({
    enabled: z.boolean().optional(),
    title: localizedSchema,
    text: localizedSchema,
    imageUrl: z.string().trim().optional(),
    targetType: z.enum(["none", "product", "url"]).optional(),
    targetValue: z.string().trim().optional(),
    showMode: z.enum(["once_per_session", "always"]).optional(),
  })
  .passthrough();

function normalize(value) {
  return String(value || "").trim();
}

function toResponse(doc) {
  if (!doc) return null;
  const source = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const updatedAtMs = source.updatedAt
    ? new Date(source.updatedAt).getTime()
    : 0;
  return {
    _id: source._id,
    enabled: source.enabled === true,
    title: {
      ar: normalize(source?.title?.ar),
      he: normalize(source?.title?.he),
    },
    text: {
      ar: normalize(source?.text?.ar),
      he: normalize(source?.text?.he),
    },
    imageUrl: normalize(source.imageUrl),
    targetType: source.targetType || "none",
    targetValue: normalize(source.targetValue),
    showMode: source.showMode || "once_per_session",
    updatedAt: source.updatedAt || null,
    dismissKey: `site-ad:${updatedAtMs || 0}`,
  };
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

router.get("/", async (_req, res) => {
  try {
    const doc = await SiteAd.getSingleton();
    return res.json(toResponse(doc));
  } catch (err) {
    console.error("site-ad get error:", err);
    return res.status(500).json({ message: "تعذّر جلب الإعلان" });
  }
});

router.put(
  "/",
  verifyToken,
  isAdmin,
  validateBody(siteAdSchema),
  async (req, res) => {
    try {
      const payload = req.body || {};
      const doc = await SiteAd.getSingleton();

      if (typeof payload.enabled !== "undefined") {
        doc.enabled = payload.enabled === true;
      }

      if (payload.title) {
        doc.title = {
          ...(doc.title?.toObject ? doc.title.toObject() : doc.title),
          ...payload.title,
        };
      }

      if (payload.text) {
        doc.text = {
          ...(doc.text?.toObject ? doc.text.toObject() : doc.text),
          ...payload.text,
        };
      }

      if (typeof payload.imageUrl !== "undefined") {
        doc.imageUrl = normalize(payload.imageUrl);
      }

      if (typeof payload.targetType !== "undefined") {
        doc.targetType = payload.targetType;
      }

      if (typeof payload.targetValue !== "undefined") {
        doc.targetValue = normalize(payload.targetValue);
      }

      if (typeof payload.showMode !== "undefined") {
        doc.showMode = payload.showMode;
      }

      const finalTargetType = doc.targetType || "none";
      const finalTargetValue = normalize(doc.targetValue);

      if (finalTargetType === "none") {
        doc.targetValue = "";
      } else if (finalTargetType === "product") {
        if (!mongoose.isValidObjectId(finalTargetValue)) {
          return res
            .status(400)
            .json({ message: "معرّف المنتج في الإعلان غير صالح" });
        }

        const exists = await Product.exists({ _id: finalTargetValue });
        if (!exists) {
          return res.status(400).json({ message: "المنتج المحدد غير موجود" });
        }
        doc.targetValue = finalTargetValue;
      } else if (finalTargetType === "url") {
        if (!finalTargetValue || !isValidHttpUrl(finalTargetValue)) {
          return res
            .status(400)
            .json({ message: "رابط الإعلان يجب أن يكون http/https صالحًا" });
        }
        doc.targetValue = finalTargetValue;
      }

      await doc.save();
      return res.json(toResponse(doc));
    } catch (err) {
      console.error("site-ad update error:", err);
      return res.status(500).json({ message: "تعذّر حفظ الإعلان" });
    }
  }
);

module.exports = router;
