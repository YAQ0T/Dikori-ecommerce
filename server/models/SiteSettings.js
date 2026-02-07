const mongoose = require("mongoose");

const LocalizedSchema = new mongoose.Schema(
  {
    ar: { type: String, default: "" },
    he: { type: String, default: "" },
  },
  { _id: false }
);

const HeroSchema = new mongoose.Schema(
  {
    kicker: { type: LocalizedSchema, default: () => ({}) },
    title: { type: LocalizedSchema, default: () => ({}) },
    subtitle: { type: LocalizedSchema, default: () => ({}) },
    imageUrl: { type: String, default: "" },
    calloutLabel: { type: LocalizedSchema, default: () => ({}) },
    calloutValue: { type: LocalizedSchema, default: () => ({}) },
    primaryCtaLabel: { type: LocalizedSchema, default: () => ({}) },
    secondaryCtaLabel: { type: LocalizedSchema, default: () => ({}) },
  },
  { _id: false }
);

const CategorySchema = new mongoose.Schema(
  {
    value: { type: String, required: true },
    label: { type: LocalizedSchema, default: () => ({}) },
    imageUrl: { type: String, default: "" },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const SubCategorySchema = new mongoose.Schema(
  {
    main: { type: String, required: true },
    value: { type: String, required: true },
    label: { type: LocalizedSchema, default: () => ({}) },
    imageUrl: { type: String, default: "" },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const CategoryMenuSchema = new mongoose.Schema(
  {
    main: { type: [CategorySchema], default: [] },
    sub: { type: [SubCategorySchema], default: [] },
  },
  { _id: false }
);

const SiteSettingsSchema = new mongoose.Schema(
  {
    seeded: { type: Boolean, default: false },
    hero: { type: HeroSchema, default: () => ({}) },
    homeCategories: { type: [CategorySchema], default: [] },
    categoryMenu: { type: CategoryMenuSchema, default: () => ({}) },
  },
  { timestamps: true }
);

SiteSettingsSchema.statics.getSingleton = async function () {
  let doc = await this.findOne();
  if (!doc) {
    doc = await this.create({});
  }
  return doc;
};

module.exports = mongoose.model("SiteSettings", SiteSettingsSchema);
