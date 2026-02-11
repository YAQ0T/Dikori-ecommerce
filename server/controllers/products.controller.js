// server/controllers/products.controller.js
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Variant = require("../models/Variant");
const {
  slugify,
  buildWantedTags,
  readOwnershipFilterFromQuery,
} = require("../utils/filters");
const {
  parseLocalizedInput,
  ensureLocalizedObject,
  mapLocalizedForResponse,
} = require("../utils/localized");

/** تحويل ترتيب الأولويات إلى رقم للفرز */
const priorityRankExpr = {
  $switch: {
    branches: [
      { case: { $eq: ["$priority", "A"] }, then: 1 },
      { case: { $eq: ["$priority", "B"] }, then: 2 },
      { case: { $eq: ["$priority", "C"] }, then: 3 },
    ],
    default: 4,
  },
};

/** حارس بسيط لفهم limit/page */
function parsePagination(q) {
  const pageNum = Math.max(parseInt(q.page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(q.limit, 10) || 9, 1);
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
}

/** اختيار طريقة الفرز */
function resolveSort(sort, locale = "ar") {
  const nameField = locale === "he" ? "name.he" : "name.ar";
  if (sort === "priceAsc") return { minPrice: 1, createdAt: -1 };
  if (sort === "priceDesc") return { minPrice: -1, createdAt: -1 };
  if (sort === "nameAsc") return { [nameField]: 1, createdAt: -1 };
  if (sort === "nameDesc") return { [nameField]: -1, createdAt: -1 };
  return { priorityRank: 1, createdAt: -1 }; // الافتراضي: الأحدث مع احترام الأولوية
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSearchMatch(q) {
  const term = String(q || "").trim();
  if (!term) return null;

  const quoted = term.match(/"([^"]+)"/g) || [];
  const phrases = quoted
    .map((p) => p.replace(/"/g, "").trim())
    .filter(Boolean);
  const remainder = term.replace(/"([^"]+)"/g, " ").trim();
  const tokens = remainder.split(/\s+/).filter(Boolean);
  const parts = Array.from(new Set([...phrases, ...tokens])).filter(Boolean);
  if (!parts.length) return null;

  const fields = ["name.ar", "name.he", "description.ar", "description.he"];
  const clauses = parts.map((part) => {
    const escaped = escapeRegex(part).replace(/\s+/g, "\\s+");
    return {
      $or: fields.map((field) => ({
        [field]: { $regex: escaped, $options: "i" },
      })),
    };
  });

  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

function toFiniteAmount(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number(value.toFixed(2));
}

function computeVariantDisplayPrice(variant, now = new Date()) {
  const amount = Number(variant?.price?.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return { final: null, compare: null };
  }

  const discount = variant?.price?.discount || {};
  const discountValue = Number(discount.value || 0);
  const startAt = discount.startAt ? new Date(discount.startAt) : null;
  const endAt = discount.endAt ? new Date(discount.endAt) : null;

  const isDiscountActive =
    discountValue > 0 &&
    (!startAt || startAt <= now) &&
    (!endAt || endAt >= now);

  let final = amount;
  if (isDiscountActive) {
    if (discount.type === "amount") {
      final = Math.max(0, amount - discountValue);
    } else {
      final = Math.max(0, amount - (amount * discountValue) / 100);
    }
  }

  const compareAt = Number(variant?.price?.compareAt);
  const compareCandidate = Number.isFinite(compareAt) ? compareAt : amount;
  const compare = compareCandidate > final ? compareCandidate : null;

  return { final: toFiniteAmount(final), compare: toFiniteAmount(compare) };
}

function parseBooleanInput(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return null;
}

function canViewHiddenProducts(role) {
  return role === "admin" || role === "dealer";
}

function shouldIncludeHidden(req) {
  const requested = parseBooleanInput(req?.query?.includeHidden);
  if (requested !== true) return false;
  return canViewHiddenProducts(req?.user?.role);
}

function applyVisibilityFilter(target, includeHidden = false) {
  if (!includeHidden) {
    target.isVisible = { $ne: false };
  }
}

/** توحيد اسم وداتا المنتج قبل الإنشاء */
function prepareCreateData(body) {
  const {
    name,
    category,
    mainCategory,
    subCategory,
    description,
    images,
    ownershipType,
    priority,
    isVisible,
  } = body;

  const nameResult = parseLocalizedInput(name, {
    requireArabic: true,
    arabicRequiredMessage:
      "يرجى إدخال اسم المنتج باللغة العربية على الأقل",
  });
  if (nameResult.error) return { error: nameResult.error };
  const normalizedName = nameResult.value;

  if (!normalizedName) {
    return { error: "اسم المنتج مطلوب" };
  }

  if (
    !mainCategory ||
    !subCategory ||
    !Array.isArray(images) ||
    images.length === 0
  ) {
    return {
      error:
        "يرجى تعبئة الحقول الأساسية: name, mainCategory, subCategory, images[]",
    };
  }

  const data = {
    name: normalizedName,
    category: category ? String(category).trim() : undefined,
    mainCategory: String(mainCategory).trim(),
    subCategory: String(subCategory).trim(),
    images: images.map((u) => String(u)),
  };

  const descriptionResult = parseLocalizedInput(description, {
    allowEmpty: false,
    arabicRequiredMessage:
      "الوصف العربي مطلوب عند إضافة وصف جديد",
  });
  if (descriptionResult.error) return { error: descriptionResult.error };
  if (descriptionResult.value) {
    data.description = descriptionResult.value;
  }

  if (typeof ownershipType !== "undefined") {
    const v = String(ownershipType);
    if (!["ours", "local"].includes(v)) {
      return { error: "قيمة ownershipType غير صحيحة: ours | local" };
    }
    data.ownershipType = v;
  }

  if (typeof priority !== "undefined") {
    const pv = String(priority).toUpperCase();
    if (!["A", "B", "C"].includes(pv)) {
      return { error: "قيمة priority: A | B | C" };
    }
    data.priority = pv;
  }

  if (typeof isVisible !== "undefined") {
    const parsedVisibility = parseBooleanInput(isVisible);
    if (parsedVisibility === null) {
      return { error: "قيمة isVisible غير صحيحة: true | false" };
    }
    data.isVisible = parsedVisibility;
  }

  return { data };
}

function formatProduct(product) {
  if (!product) return product;
  const source =
    typeof product.toObject === "function" ? product.toObject() : product;
  return {
    ...source,
    name: mapLocalizedForResponse(source.name),
    description: mapLocalizedForResponse(source.description),
  };
}

function formatProducts(list = []) {
  return list.map((item) => formatProduct(item));
}

const ProductsController = {
  /* =========================
   * CREATE
   * ========================= */
  async create(req, res) {
    try {
      const prepared = prepareCreateData(req.body);
      if (prepared.error)
        return res.status(400).json({ error: prepared.error });

      const product = await Product.create(prepared.data);
      return res.status(201).json(product);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  },

  /* =========================
   * READ with-stats
   * ========================= */
  async getWithStats(req, res) {
    try {
      const {
        mainCategory,
        subCategory,
        q,
        maxPrice,
        sort = "new",
        locale,
      } = req.query;

      // فلترة المُلصقات المطلوبة (tags) من كويري
      const wantedTags = buildWantedTags(req.query);

      // صلاحية رؤية المِلكية
      const role = req.user?.role;
      const canUseOwnership = role === "admin" || role === "dealer";
      const includeHidden = shouldIncludeHidden(req);
      const ownershipFilter = readOwnershipFilterFromQuery(
        req.query,
        canUseOwnership
      );

      // فلاتر البحث الأساسية
      const $match = { ...ownershipFilter };
      applyVisibilityFilter($match, includeHidden);
      if (mainCategory) $match.mainCategory = String(mainCategory);
      if (subCategory) $match.subCategory = String(subCategory);
      const searchMatch = buildSearchMatch(q);
      if (searchMatch) Object.assign($match, searchMatch);

      // صفحة وحدّ
      const { pageNum, limitNum, skip } = parsePagination(req.query);

      // ترتيب
      const $sortStage = resolveSort(sort, locale);

      // لحساب الخصومات المفعلة الآن
      const now = new Date();

      const pipeline = [
        { $match },
        { $addFields: { priorityRank: priorityRankExpr } },

        // احضار الفيريانتس
        {
          $lookup: {
            from: "variants",
            localField: "_id",
            foreignField: "product",
            as: "vars",
          },
        },

        // حقن wantedTags في الوثيقة
        { $addFields: { _wantedTags: wantedTags } },

        // فلترة الـvariants حسب التاغات المطلوبة إن وُجدت
        {
          $addFields: {
            vars: {
              $cond: [
                { $gt: [{ $size: "$_wantedTags" }, 0] },
                {
                  $filter: {
                    input: "$vars",
                    as: "v",
                    cond: { $setIsSubset: ["$_wantedTags", "$$v.tags"] },
                  },
                },
                "$vars",
              ],
            },
          },
        },

        // لو فيه tags مطلوبة، لازم يكون فيه على الأقل variant واحد بعد الفلترة
        ...(wantedTags.length
          ? [{ $match: { "vars.0": { $exists: true } } }]
          : []),

        // حساب السعر النهائي لكل variant بناءً على نافذة الخصم
        {
          $addFields: {
            _finalPrices: {
              $map: {
                input: "$vars",
                as: "v",
                in: {
                  $let: {
                    vars: {
                      amount: { $ifNull: ["$$v.price.amount", 0] },
                      dType: "$$v.price.discount.type",
                      dValue: { $ifNull: ["$$v.price.discount.value", 0] },
                      dStart: "$$v.price.discount.startAt",
                      dEnd: "$$v.price.discount.endAt",
                    },
                    in: {
                      $let: {
                        vars: {
                          isActive: {
                            $and: [
                              { $gt: ["$$dValue", 0] },
                              {
                                $or: [
                                  { $eq: ["$$dStart", null] },
                                  { $lte: ["$$dStart", now] },
                                ],
                              },
                              {
                                $or: [
                                  { $eq: ["$$dEnd", null] },
                                  { $gte: ["$$dEnd", now] },
                                ],
                              },
                            ],
                          },
                        },
                        in: {
                          $cond: [
                            "$$isActive",
                            {
                              $cond: [
                                { $eq: ["$$dType", "amount"] },
                                {
                                  $max: [
                                    0,
                                    { $subtract: ["$$amount", "$$dValue"] },
                                  ],
                                },
                                {
                                  $max: [
                                    0,
                                    {
                                      $subtract: [
                                        "$$amount",
                                        {
                                          $divide: [
                                            {
                                              $multiply: [
                                                "$$amount",
                                                "$$dValue",
                                              ],
                                            },
                                            100,
                                          ],
                                        },
                                      ],
                                    },
                                  ],
                                },
                              ],
                            },
                            "$$amount",
                          ],
                        },
                      },
                    },
                  },
                },
              },
            },
            _stocks: {
              $map: {
                input: "$vars",
                as: "v",
                in: { $ifNull: ["$$v.stock.inStock", 0] },
              },
            },
          },
        },

        // تنظيف الأسعار النهائية (إزالة null والسالب)
        {
          $addFields: {
            _finalPricesClean: {
              $filter: {
                input: "$_finalPrices",
                as: "p",
                cond: { $and: [{ $ne: ["$$p", null] }, { $gte: ["$$p", 0] }] },
              },
            },
          },
        },

        // حساب minPrice و totalStock
        {
          $addFields: {
            minPrice: {
              $cond: [
                { $gt: [{ $size: "$_finalPricesClean" }, 0] },
                { $min: "$_finalPricesClean" },
                0,
              ],
            },
            totalStock: { $sum: "$_stocks" },
          },
        },

        // فلترة بـ maxPrice إن وُجد
        ...(req.query.maxPrice
          ? [{ $match: { minPrice: { $lte: Number(maxPrice) } } }]
          : []),

        // Facet للعدّ والعناصر مع الصفحات
        {
          $facet: {
            meta: [{ $count: "total" }],
            items: [
              { $sort: $sortStage },
              { $skip: skip },
              { $limit: limitNum },
              {
                $project: {
                  name: 1,
                  description: 1,
                  images: 1,
                  mainCategory: 1,
                  subCategory: 1,
                  createdAt: 1,
                  minPrice: 1,
                  totalStock: 1,
                  ownershipType: 1,
                  priority: 1,
                  isVisible: 1,
                },
              },
            ],
          },
        },

        // إخراج نهائي أنظف
        {
          $project: {
            items: 1,
            total: { $ifNull: [{ $arrayElemAt: ["$meta.total", 0] }, 0] },
          },
        },
      ];

      const agg = Product.aggregate(pipeline);
      if (sort === "nameAsc" || sort === "nameDesc") {
        agg.collation({
          locale: locale === "he" ? "he" : "ar",
          strength: 2,
        });
      }
      const [result] = await agg;
      const total = result?.total || 0;
      const items = formatProducts(result?.items || []);
      const totalPages = Math.ceil(total / limitNum);

      return res.json({
        items,
        total,
        totalPages,
        page: pageNum,
        limit: limitNum,
      });
    } catch (err) {
      console.error("with-stats error:", err && err.stack ? err.stack : err);
      return res.status(500).json({ error: "Server error in /with-stats" });
    }
  },

  /* =========================
   * READ facets (بدون $replaceAll)
   * ========================= */
  async getFacets(req, res) {
    try {
      const { mainCategory, subCategory, q } = req.query;

      const role = req.user?.role;
      const canUseOwnership = role === "admin" || role === "dealer";
      const includeHidden = shouldIncludeHidden(req);
      const ownershipFilter = readOwnershipFilterFromQuery(
        req.query,
        canUseOwnership
      );

      const $match = { ...ownershipFilter };
      applyVisibilityFilter($match, includeHidden);
      if (mainCategory) $match.mainCategory = String(mainCategory);
      if (subCategory) $match.subCategory = String(subCategory);
      const searchMatch = buildSearchMatch(q);
      if (searchMatch) Object.assign($match, searchMatch);

      const pipeline = [
        { $match },
        {
          $lookup: {
            from: "variants",
            localField: "_id",
            foreignField: "product",
            as: "vars",
          },
        },
        { $unwind: "$vars" },
        { $unwind: "$vars.tags" },
        {
          $group: {
            _id: null,
            colorSlugs: {
              $addToSet: {
                $cond: [
                  { $regexMatch: { input: "$vars.tags", regex: /^color:/ } },
                  {
                    $substrBytes: [
                      "$vars.tags",
                      6, // بعد "color:"
                      { $subtract: [{ $strLenBytes: "$vars.tags" }, 6] },
                    ],
                  },
                  "$$REMOVE",
                ],
              },
            },
            measureSlugs: {
              $addToSet: {
                $cond: [
                  { $regexMatch: { input: "$vars.tags", regex: /^measure:/ } },
                  {
                    $substrBytes: [
                      "$vars.tags",
                      8, // بعد "measure:"
                      { $subtract: [{ $strLenBytes: "$vars.tags" }, 8] },
                    ],
                  },
                  "$$REMOVE",
                ],
              },
            },
          },
        },
      ];

      const [agg] = await Product.aggregate(pipeline);

      // تجهيز الإخراج في Node لتفادي $replaceAll (تشتغل على كل نسخ Mongo)
      const toName = (slug) =>
        String(slug || "")
          .replace(/[-_]+/g, " ")
          .trim();

      const colors =
        agg?.colorSlugs?.map((s) => ({ slug: s, name: toName(s) })) || [];
      const measures =
        agg?.measureSlugs?.map((s) => ({ slug: s, name: toName(s) })) || [];

      return res.json({ colors, measures });
    } catch (err) {
      console.error("facets error:", err && err.stack ? err.stack : err);
      return res.status(500).json({ error: "Server error in /facets" });
    }
  },

  /* =========================
   * READ suggestions (خفيف)
   * ========================= */
  async suggest(req, res) {
    try {
      const q = String(req.query.q || "").trim();
      if (!q || q.length < 2) {
        return res.json({ items: [] });
      }

      const limitNum = Math.max(
        1,
        Math.min(parseInt(req.query.limit, 10) || 8, 20)
      );
      const role = req.user?.role;
      const canUseOwnership = role === "admin" || role === "dealer";
      const includeHidden = shouldIncludeHidden(req);
      const ownershipFilter = readOwnershipFilterFromQuery(
        req.query,
        canUseOwnership
      );

      const searchMatch = buildSearchMatch(q);
      const filter = { ...ownershipFilter, ...(searchMatch || {}) };
      applyVisibilityFilter(filter, includeHidden);

      const items = await Product.find(filter, { name: 1, images: 1, price: 1 })
        .sort({ priority: 1, createdAt: -1 })
        .limit(limitNum)
        .lean();

      const productIds = items.map((item) => item._id);
      const variants = productIds.length
        ? await Variant.find(
            { product: { $in: productIds } },
            {
              product: 1,
              "price.amount": 1,
              "price.compareAt": 1,
              "price.discount": 1,
            }
          ).lean()
        : [];

      const now = new Date();
      const minPriceByProduct = new Map();
      for (const variant of variants) {
        const productId = String(variant.product || "");
        if (!productId) continue;

        const price = computeVariantDisplayPrice(variant, now);
        if (price.final === null) continue;

        const current = minPriceByProduct.get(productId);
        if (!current || price.final < current.price) {
          minPriceByProduct.set(productId, {
            price: price.final,
            comparePrice: price.compare,
          });
        }
      }

      return res.json({
        items: (items || []).map((p) => ({
          _id: p._id,
          name: mapLocalizedForResponse(p.name),
          image: Array.isArray(p.images) ? p.images[0] || null : null,
          price:
            minPriceByProduct.get(String(p._id))?.price ??
            toFiniteAmount(p.price),
          comparePrice:
            minPriceByProduct.get(String(p._id))?.comparePrice ?? null,
        })),
      });
    } catch (err) {
      console.error("suggest error:", err && err.stack ? err.stack : err);
      return res.status(500).json({ error: "Server error in /suggest" });
    }
  },

  /* =========================
   * READ all (يحترم priority)
   * ========================= */
  async list(req, res) {
    try {
      const { mainCategory, subCategory, q } = req.query;

      const role = req.user?.role;
      const canUseOwnership = role === "admin" || role === "dealer";
      const includeHidden = shouldIncludeHidden(req);
      const ownershipFilter = readOwnershipFilterFromQuery(
        req.query,
        canUseOwnership
      );

      const filter = { ...ownershipFilter };
      applyVisibilityFilter(filter, includeHidden);
      if (mainCategory) filter.mainCategory = String(mainCategory);
      if (subCategory) filter.subCategory = String(subCategory);
      const searchMatch = buildSearchMatch(q);
      if (searchMatch) Object.assign(filter, searchMatch);

      const { pageNum, limitNum, skip } = parsePagination({
        page: req.query.page || 1,
        limit: req.query.limit || 50,
      });

      const products = await Product.find(filter)
        .sort({ priority: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean();

      return res.status(200).json(formatProducts(products));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  },

  /* =========================
   * READ one
   * ========================= */
  async getOne(req, res) {
    try {
      const withVariants = req.query.withVariants === "1";
      const { id } = req.params;
      const includeHidden = shouldIncludeHidden(req);

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "معرّف غير صالح" });
      }

      const product = await Product.findById(id).lean();
      if (!product)
        return res.status(404).json({ message: "المنتج غير موجود" });
      if (!includeHidden && product.isVisible === false) {
        return res.status(404).json({ message: "المنتج غير موجود" });
      }

      const normalizedProduct = formatProduct(product);

      if (!withVariants) return res.json(normalizedProduct);

      const variants = await Variant.find({ product: product._id }).lean();
      return res.json({ ...normalizedProduct, variants });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  },

  /* =========================
   * UPDATE (يشمل priority)
   * ========================= */
  async update(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "معرّف غير صالح" });
      }

      const {
        name,
        category,
        mainCategory,
        subCategory,
        description,
        images,
        ownershipType,
        priority,
        isVisible,
      } = req.body;

      const updateData = {};
      if (typeof name !== "undefined") {
        const nameResult = parseLocalizedInput(name, {
          requireArabic: true,
          arabicRequiredMessage:
            "يرجى إدخال اسم المنتج باللغة العربية على الأقل",
        });
        if (nameResult.error)
          return res.status(400).json({ error: nameResult.error });
        if (!nameResult.value)
          return res.status(400).json({ error: "اسم المنتج مطلوب" });
        updateData.name = nameResult.value;
      }
      if (typeof category !== "undefined")
        updateData.category = String(category).trim();
      if (typeof mainCategory !== "undefined")
        updateData.mainCategory = String(mainCategory).trim();
      if (typeof subCategory !== "undefined")
        updateData.subCategory = String(subCategory).trim();
      if (typeof description !== "undefined") {
        const descriptionResult = parseLocalizedInput(description, {
          allowEmpty: true,
          arabicRequiredMessage: "الوصف العربي مطلوب عند إضافة وصف جديد",
        });
        if (descriptionResult.error)
          return res.status(400).json({ error: descriptionResult.error });
        if (descriptionResult.value === undefined || descriptionResult.value === null) {
          updateData.description = { ar: "", he: "" };
        } else {
          updateData.description = descriptionResult.value;
        }
      }

      if (typeof images !== "undefined") {
        if (!Array.isArray(images))
          return res
            .status(400)
            .json({ error: "images يجب أن تكون مصفوفة سلاسل" });
        updateData.images = images.map((u) => String(u));
      }

      if (typeof ownershipType !== "undefined") {
        const v = String(ownershipType);
        if (!["ours", "local"].includes(v)) {
          return res
            .status(400)
            .json({ error: "قيمة ownershipType غير صحيحة: ours | local" });
        }
        updateData.ownershipType = v;
      }

      if (typeof priority !== "undefined") {
        const pv = String(priority).toUpperCase();
        if (!["A", "B", "C"].includes(pv)) {
          return res.status(400).json({ error: "قيمة priority: A | B | C" });
        }
        updateData.priority = pv;
      }

      if (typeof isVisible !== "undefined") {
        const parsedVisibility = parseBooleanInput(isVisible);
        if (parsedVisibility === null) {
          return res
            .status(400)
            .json({ error: "قيمة isVisible غير صحيحة: true | false" });
        }
        updateData.isVisible = parsedVisibility;
      }

      const updated = await Product.findByIdAndUpdate(id, updateData, {
        new: true,
        runValidators: true,
      }).lean();

      if (!updated) return res.status(404).json({ error: "المنتج غير موجود" });

      return res.json(formatProduct(updated));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  },

  /* =========================
   * PATCH priority فقط
   * ========================= */
  async patchPriority(req, res) {
    try {
      const { id } = req.params;
      const { priority } = req.body;

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "معرّف غير صالح" });
      }

      const pv = String(priority || "C").toUpperCase();
      if (!["A", "B", "C"].includes(pv)) {
        return res.status(400).json({ error: "قيمة priority: A | B | C" });
      }

      const updated = await Product.findByIdAndUpdate(
        id,
        { priority: pv },
        { new: true, runValidators: true }
      ).lean();

      if (!updated) return res.status(404).json({ error: "المنتج غير موجود" });

      return res.json(formatProduct(updated));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  },

  /* =========================
   * DELETE
   * ========================= */
  async remove(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "معرّف غير صالح" });
      }

      const deleted = await Product.findByIdAndDelete(id).lean();
      if (!deleted) return res.status(404).json({ error: "المنتج غير موجود" });

      await Variant.deleteMany({ product: id });

      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  },
};

module.exports = ProductsController;
