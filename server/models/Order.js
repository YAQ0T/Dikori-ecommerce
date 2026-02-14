// server/models/Order.js
const mongoose = require("mongoose");
const { ensureLocalizedObject } = require("../utils/localized");

const LocalizedSchema = new mongoose.Schema(
  {
    ar: { type: String, default: "" },
    he: { type: String, default: "" },
  },
  { _id: false }
);

const OrderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Variant",
      required: true,
    },
    name: {
      type: LocalizedSchema,
      required: true,
      default: () => ({ ar: "", he: "" }),
    },
    quantity: { type: Number, min: 1, required: true },
    price: { type: Number, min: 0, required: true },
    color: { type: String },
    measure: { type: String },
    sku: { type: String },
    image: { type: String },
  },
  { _id: false }
);

OrderItemSchema.pre("validate", function orderItemEnsureLocalized(next) {
  this.name = ensureLocalizedObject(this.name);
  next();
});

const OrderSchema = new mongoose.Schema(
  {
    user: {
      _id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: false,
      },
      name: String,
      phone: String,
      email: String,
    },
    guestInfo: {
      name: { type: String, default: "" },
      phone: { type: String, default: "" },
      email: { type: String, default: "" },
      address: { type: String, default: "" },
    },
    isGuest: { type: Boolean, default: false, index: true },

    items: { type: [OrderItemSchema], required: true },
    subtotal: { type: Number, min: 0, required: true },
    discount: {
      applied: { type: Boolean, default: false },
      ruleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "DiscountRule",
        default: null,
      },
      type: { type: String, enum: ["percent", "fixed", null], default: null },
      value: { type: Number, min: 0, default: 0 },
      amount: { type: Number, min: 0, default: 0 },
      threshold: { type: Number, min: 0, default: 0 },
      name: { type: String, default: "" },
    },
    total: { type: Number, min: 0, required: true },
    address: { type: String, required: true },
    status: {
      type: String,
      enum: [
        "pending",
        "waiting_confirmation",
        "on_the_way",
        "delivered",
        "cancelled",
      ],
      default: "waiting_confirmation",
      index: true,
    },
    deliveredAt: { type: Date },
    paymentMethod: {
      type: String,
      enum: ["card", "cod", "bank_transfer"],
      default: "cod",
      index: true,
    },
    paymentCurrency: {
      type: String,
      default: () => process.env.PAY_CURRENCY || "ILS",
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid", "failed"],
      default: "unpaid",
      index: true,
    },
    reference: { type: String, index: true, default: null },
    paymentVerifiedAmount: { type: Number, min: 0, default: null },
    paymentVerifiedCurrency: { type: String, default: "" },
    paymentTransactionId: { type: String, default: "" },
    paymentCardType: { type: String, default: "" },
    paymentCardLast4: { type: String, default: "" },
    paymentStatusNote: { type: String, default: "" },
    bankTransferStatus: {
      type: String,
      enum: [
        "pending_contact",
        "instructions_sent",
        "transfer_received",
        "verified",
        "",
      ],
      default: "",
    },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Order || mongoose.model("Order", OrderSchema);
