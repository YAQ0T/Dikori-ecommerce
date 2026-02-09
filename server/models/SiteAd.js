const mongoose = require("mongoose");

const LocalizedSchema = new mongoose.Schema(
  {
    ar: { type: String, trim: true, default: "" },
    he: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const SiteAdSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false, index: true },
    title: { type: LocalizedSchema, default: () => ({}) },
    text: { type: LocalizedSchema, default: () => ({}) },
    imageUrl: { type: String, trim: true, default: "" },
    targetType: {
      type: String,
      enum: ["none", "product", "url"],
      default: "none",
    },
    targetValue: { type: String, trim: true, default: "" },
    showMode: {
      type: String,
      enum: ["once_per_session", "always"],
      default: "once_per_session",
    },
  },
  { timestamps: true }
);

SiteAdSchema.statics.getSingleton = async function () {
  let doc = await this.findOne();
  if (!doc) {
    doc = await this.create({});
  }
  return doc;
};

module.exports = mongoose.model("SiteAd", SiteAdSchema);
