const mongoose = require("mongoose");
const { Schema } = mongoose;

const DiscountSchema = new Schema(
  {
    type: { type: String, enum: ["percent", "amount"], default: "percent" },
    value: { type: Number, min: 0, default: 0 },
    startAt: { type: Date },
    endAt: { type: Date },
  },
  { _id: false }
);

const VariantSchema = new Schema(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    // الأبعاد القابلة للفلترة
    measure: { type: String, required: true, trim: true },
    measureUnit: { type: String, trim: true, default: "" }, // ✅ جديد: وحدة القياس (cm, ml, kg...)
    measureSlug: { type: String, index: true },
    color: {
      name: { type: String, required: true, trim: true },
      code: { type: String, trim: true },
      images: { type: [String], default: [] },
    },
    colorSlug: { type: String, index: true },

    // التسعير
    price: {
      currency: { type: String, default: "USD" },
      amount: { type: Number, required: true, min: 0 }, // الأساسي
      compareAt: { type: Number, min: 0 }, // يُملأ تلقائيًا إن لم يُرسل
      discount: { type: DiscountSchema, default: () => ({}) },
    },

    // المخزون
    stock: {
      inStock: { type: Number, min: 0, default: 0 },
      sku: {
        type: String,
        required: true,
        trim: true,
        unique: true,
        index: true,
      },
    },
    // false = الكمية غير مقيّدة (مخزون لا نهائي)
    trackQuantity: { type: Boolean, default: false },

    // وسوم مرنة (dimension:value)
    tags: { type: [String], default: [], index: true },
  },
  { timestamps: true }
);

// فهارس
VariantSchema.index(
  { product: 1, measureSlug: 1, colorSlug: 1 },
  { unique: true }
);
VariantSchema.index({ "price.amount": 1 });
VariantSchema.index({ "stock.inStock": 1 });
VariantSchema.index({ updatedAt: -1 });
VariantSchema.index({ "price.discount.startAt": 1 });
VariantSchema.index({ "price.discount.endAt": 1 });

const slugify = (s) =>
  (s || "").toString().trim().toLowerCase().replace(/\s+/g, "-");

// منطق الخصم
function isDiscountActive(discount = {}) {
  if (!discount || !discount.value) return false;
  const now = new Date();
  if (discount.startAt && now < discount.startAt) return false;
  if (discount.endAt && now > discount.endAt) return false;
  return true;
}

function computeFinalAmount(price = {}) {
  const amount = typeof price.amount === "number" ? price.amount : 0;
  if (!amount) return 0;

  const discount = price.discount || {};
  if (!isDiscountActive(discount)) return amount;

  return discount.type === "percent"
    ? Math.max(0, amount - (amount * discount.value) / 100)
    : Math.max(0, amount - discount.value);
}

// حفظ: توليد السلوغات/الوسوم وملء compareAt
VariantSchema.pre("save", function (next) {
  this.measureSlug = slugify(this.measure);
  this.colorSlug = slugify(this.color?.name);

  const tagSet = new Set(this.tags || []);
  if (this.measureSlug) tagSet.add(`measure:${this.measureSlug}`);
  if (this.colorSlug) tagSet.add(`color:${this.colorSlug}`);
  if (this.color?.code)
    tagSet.add(`color_code:${String(this.color.code).toLowerCase()}`);
  // ✅ ممكن تفعّل هذا السطر لو بدك تحفظ الوحدة كوسم:
  // if (this.measureUnit) tagSet.add(`measure_unit:${String(this.measureUnit).toLowerCase()}`);
  this.tags = Array.from(tagSet);

  if (this.price && this.price.compareAt == null) {
    this.price.compareAt = this.price.amount;
  }
  next();
});

// تحديث: دعم dot notation + إعادة بناء الوسوم + تغطية compareAt
VariantSchema.pre("findOneAndUpdate", async function (next) {
  const update = this.getUpdate() || {};
  const $set = update.$set ?? {};

  const hasMeasureUpdate = Object.prototype.hasOwnProperty.call(
    $set,
    "measure"
  );
  const hasColorNameUpdate =
    ($set.color && Object.prototype.hasOwnProperty.call($set.color, "name")) ||
    Object.prototype.hasOwnProperty.call($set, "color.name");
  const hasColorCodeUpdate =
    ($set.color && Object.prototype.hasOwnProperty.call($set.color, "code")) ||
    Object.prototype.hasOwnProperty.call($set, "color.code");

  if (hasMeasureUpdate) $set.measureSlug = slugify($set.measure);
  if (hasColorNameUpdate) {
    const newName = ($set.color && $set.color.name) ?? $set["color.name"];
    if (newName != null) {
      $set.colorSlug = slugify(newName);
      if (!$set.color) $set.color = {};
      if ($set["color.name"] != null && $set.color.name == null) {
        $set.color.name = newName;
      }
    }
  }

  if ($set.price?.amount != null && $set.price?.compareAt == null) {
    $set.price.compareAt = $set.price.amount;
  }

  const tagsProvided = Array.isArray($set.tags) || Array.isArray(update.tags);
  const needTagsRebuild =
    hasMeasureUpdate ||
    hasColorNameUpdate ||
    hasColorCodeUpdate ||
    tagsProvided;

  if (needTagsRebuild) {
    const current = await this.model.findOne(this.getQuery()).lean();

    const finalMeasureSlug = $set.measureSlug ?? current?.measureSlug ?? null;
    const finalColorSlug = $set.colorSlug ?? current?.colorSlug ?? null;
    const finalColorCode =
      ($set.color && $set.color.code) ??
      $set["color.code"] ??
      current?.color?.code ??
      null;

    const base =
      (tagsProvided ? $set.tags || update.tags || [] : current?.tags || []) ||
      [];

    const filtered = base.filter(
      (t) =>
        !/^measure:/.test(t) && !/^color:/.test(t) && !/^color_code:/.test(t)
    );

    if (finalMeasureSlug) filtered.push(`measure:${finalMeasureSlug}`);
    if (finalColorSlug) filtered.push(`color:${finalColorSlug}`);
    if (finalColorCode)
      filtered.push(`color_code:${String(finalColorCode).toLowerCase()}`);

    // ✅ لو بدك تحفظ وسماً للوحدة عند التعديل (اختياري):
    // const unit = $set.measureUnit ?? current?.measureUnit ?? null;
    // if (unit) filtered.push(`measure_unit:${String(unit).toLowerCase()}`);

    $set.tags = Array.from(new Set(filtered));
  }

  if (update.$set) update.$set = { ...update.$set, ...$set };
  else this.setUpdate({ ...update, $set });

  next();
});

// ميثود/حقول محسوبة
VariantSchema.methods.finalAmount = function () {
  return computeFinalAmount(this.price);
};

VariantSchema.set("toJSON", {
  virtuals: true,
  transform: function (_doc, ret) {
    const active = isDiscountActive(ret.price?.discount);
    ret.isDiscountActive = active;
    ret.finalAmount = computeFinalAmount(ret.price);
    ret.displayCompareAt = active
      ? ret.price?.compareAt ?? ret.price?.amount
      : null;
    return ret;
  },
});

module.exports =
  mongoose.models.Variant || mongoose.model("Variant", VariantSchema);
