const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const crypto = require("crypto");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(32);
process.env.LAHZA_SECRET_KEY = "test-lahza-secret";
process.env.WEBHOOK_ALLOWED_IPS = "::ffff:203.0.113.5:443";

const ordersRouter = require("../routes/orders");
const paymentsRouter = require("../routes/payments");
const orderStatusRouter = require("../routes/order-status");

const Order = require("../models/Order");
const Product = require("../models/Product");
const Variant = require("../models/Variant");
const DiscountRule = require("../models/DiscountRule");
const axios = require("axios");
const { issuePaymentToken } = require("../utils/paymentTokens");
const {
  lahzaWebhookHandler,
  getClientIp,
  normalizeIp,
  WEBHOOK_ALLOWED_IPS,
} = require("../index");

const ordersStore = new Map();

const defaultAxiosGet = async () => ({ data: { data: {} } });
axios.get = defaultAxiosGet;

Order.create = async (doc) => {
  const _id = new mongoose.Types.ObjectId().toString();
  const saved = { ...doc, _id };
  ordersStore.set(_id, saved);
  return saved;
};

Order.findById = (id) => ({
  lean: async () => ordersStore.get(String(id)) || null,
});

Order.findByIdAndUpdate = (id, update) => ({
  lean: async () => {
    const existing = ordersStore.get(String(id));
    if (!existing) return null;
    const set = { ...(update?.$set || {}) };
    const updated = { ...existing, ...set };
    ordersStore.set(String(id), updated);
    return updated;
  },
});

const originalFindOneAndUpdate = Order.findOneAndUpdate;
if (typeof originalFindOneAndUpdate !== "function") {
  Order.findOneAndUpdate = () => ({
    lean: async () => null,
  });
}

function normalizeComparable(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof mongoose.Types.ObjectId) {
    return value.toString();
  }
  if (typeof value === "object" && typeof value.toString === "function") {
    return value.toString();
  }
  return value;
}

function matchesFilter(doc, filter = {}) {
  if (!filter || typeof filter !== "object") return true;
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (Object.prototype.hasOwnProperty.call(value, "$ne")) {
        return (
          normalizeComparable(doc[key]) !== normalizeComparable(value.$ne)
        );
      }
      return false;
    }
    return normalizeComparable(doc[key]) === normalizeComparable(value);
  });
}

Order.findOne = (filter = {}) => ({
  lean: async () => {
    for (const order of ordersStore.values()) {
      if (matchesFilter(order, filter)) {
        return { ...order };
      }
    }
    return null;
  },
});

Order.findOneAndUpdate = (filter = {}, update = {}, options = {}) => ({
  lean: async () => {
    for (const [id, order] of ordersStore.entries()) {
      if (!matchesFilter(order, filter)) continue;
      const set = { ...(update?.$set || {}) };
      const updated = { ...order, ...set };
      ordersStore.set(id, updated);
      return options?.new ? { ...updated } : { ...order };
    }
    return null;
  },
});

Order.updateOne = async (filter = {}, update = {}) => {
  for (const [id, order] of ordersStore.entries()) {
    if (!matchesFilter(order, filter)) continue;
    const set = { ...(update?.$set || {}) };
    const updated = { ...order, ...set };
    ordersStore.set(id, updated);
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  }
  return { acknowledged: false, matchedCount: 0, modifiedCount: 0 };
};

let variantResolver = () => null;
Variant.findOne = (query) => ({
  lean: async () => {
    const res = await variantResolver(query);
    return res ? { ...res } : null;
  },
});

let productResolver = () => null;
Product.findById = (id) => ({
  lean: async () => {
    const res = await productResolver(id);
    return res ? { ...res } : null;
  },
});

let discountResolver = () => null;
DiscountRule.findOne = (query) => ({
  sort() {
    return this;
  },
  lean: async () => {
    const res = await discountResolver(query);
    return res ? { ...res } : null;
  },
});

let lastLahzaPayload = null;
axios.post = async (url, payload) => {
  lastLahzaPayload = { url, payload };
  return {
    data: {
      data: {
        authorization_url: "https://lahza.example/checkout",
        reference: "lahza-ref-123",
      },
    },
  };
};

function resetState() {
  ordersStore.clear();
  lastLahzaPayload = null;
  variantResolver = () => null;
  productResolver = () => null;
  discountResolver = () => null;
  axios.get = defaultAxiosGet;
}

function createMockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    sendStatus(code) {
      this.statusCode = code;
      this.body = undefined;
      return this;
    },
  };
}

function getRouteHandler(router, method, path) {
  const stack = router.stack || (router.default && router.default.stack) || [];
  for (const layer of stack) {
    if (
      layer.route &&
      layer.route.path === path &&
      layer.route.methods?.[method]
    ) {
      const handlers = layer.route.stack || [];
      return handlers[handlers.length - 1].handle;
    }
  }
  throw new Error(`Handler for ${method.toUpperCase()} ${path} not found`);
}

const codHandler = getRouteHandler(ordersRouter, "post", "/");
const prepareCardHandler = getRouteHandler(
  ordersRouter,
  "post",
  "/prepare-card"
);
const lahzaCreateHandler = getRouteHandler(paymentsRouter, "post", "/create");
const lahzaConfirmHandler = getRouteHandler(
  paymentsRouter,
  "post",
  "/status/:reference/confirm"
);
const adminPayHandler = getRouteHandler(
  ordersRouter,
  "patch",
  "/by-reference/:reference/pay"
);
const orderStatusHandler = getRouteHandler(
  orderStatusRouter,
  "patch",
  "/:id/status"
);

test(
  "Updating an order to delivered marks it as paid",
  { concurrency: false },
  async () => {
    resetState();

    const orderId = new mongoose.Types.ObjectId().toString();
    const baseOrder = {
      _id: orderId,
      status: "on_the_way",
      paymentStatus: "unpaid",
      items: [],
      subtotal: 0,
      total: 0,
      discount: { amount: 0 },
      address: "Delivery Lane",
    };
    ordersStore.set(orderId, baseOrder);

    const req = {
      params: { id: orderId },
      body: { status: "delivered" },
      user: { id: new mongoose.Types.ObjectId().toString(), role: "admin" },
    };
    const res = createMockRes();

    await orderStatusHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, "delivered");
    assert.equal(res.body.paymentStatus, "paid");
    assert.ok(res.body.deliveredAt instanceof Date);

    const saved = ordersStore.get(orderId);
    assert.equal(saved.paymentStatus, "paid");
    assert.ok(saved.deliveredAt instanceof Date);
  }
);
test(
  "COD orders force paymentStatus to unpaid",
  { concurrency: false },
  async () => {
    resetState();

    const productId = new mongoose.Types.ObjectId().toString();
    const variantId = new mongoose.Types.ObjectId().toString();

    const variantDoc = {
      _id: variantId,
      product: productId,
      price: { amount: 50, discount: null },
      stock: { sku: "SKU-PAID", inStock: 10 },
      color: { images: [] },
    };

    variantResolver = (query) => {
      if (
        query?._id &&
        String(query._id) === variantId &&
        (!query.product || String(query.product) === productId)
      ) {
        return variantDoc;
      }
      return null;
    };

    const req = {
      body: {
        address: "Force Unpaid St",
        items: [
          {
            productId,
            variantId,
            quantity: 1,
          },
        ],
        paymentMethod: "cod",
        paymentStatus: "paid",
      },
    };

    const res = createMockRes();
    await codHandler(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.paymentStatus, "unpaid");

    const saved = ordersStore.get(res.body._id);
    assert.ok(saved, "order persisted in store");
    assert.equal(saved.paymentStatus, "unpaid");
  }
);

test(
  "COD orders recompute tampered discount server-side",
  { concurrency: false },
  async () => {
    resetState();

    const productId = new mongoose.Types.ObjectId().toString();
    const variantId = new mongoose.Types.ObjectId().toString();
    const ruleId = new mongoose.Types.ObjectId().toString();

    const variantDoc = {
      _id: variantId,
      product: productId,
      price: { amount: 100, discount: null },
      stock: { sku: "SKU123", inStock: 10 },
      color: { images: [] },
    };
    variantResolver = (query) => {
      if (
        query?._id &&
        String(query._id) === variantId &&
        (!query.product || String(query.product) === productId)
      ) {
        return variantDoc;
      }
      return null;
    };

    productResolver = (id) => {
      if (String(id) === productId) {
        return {
          _id: productId,
          images: ["img.png"],
          name: { ar: "منتج", he: "Product" },
        };
      }
      return null;
    };

    const discountRule = {
      _id: ruleId,
      type: "percent",
      value: 10,
      threshold: 100,
      isActive: true,
      name: "Ten Percent",
    };
    discountResolver = (query) => {
      const threshold = query?.threshold?.$lte ?? Infinity;
      const eligible =
        threshold >= discountRule.threshold && discountRule.isActive;
      if (!eligible) return null;
      if (query?._id) {
        return String(query._id) === ruleId ? discountRule : null;
      }
      return discountRule;
    };

    const req = {
      body: {
        address: "Test Address",
        items: [
          {
            productId,
            variantId,
            quantity: 2,
          },
        ],
        paymentMethod: "cod",
        discount: {
          applied: true,
          ruleId,
          amount: 9999,
          type: "percent",
          value: 999,
        },
      },
    };

    const res = createMockRes();
    await codHandler(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.subtotal, 200);
    assert.equal(res.body.discount.amount, 20);
    assert.equal(res.body.total, 180);

    const saved = ordersStore.get(res.body._id);
    assert.ok(saved, "order persisted in store");
    assert.equal(saved.discount.amount, 20);
    assert.equal(saved.total, 180);
  }
);

test(
  "Card preparation ignores discounts without a valid rule",
  { concurrency: false },
  async () => {
    resetState();

    const productId = new mongoose.Types.ObjectId().toString();
    const variantId = new mongoose.Types.ObjectId().toString();

    const variantDoc = {
      _id: variantId,
      product: productId,
      price: { amount: 150, discount: null },
      stock: { sku: "SKU987", inStock: 10 },
      color: { images: [] },
    };
    variantResolver = (query) => {
      if (
        query?._id &&
        String(query._id) === variantId &&
        (!query.product || String(query.product) === productId)
      ) {
        return variantDoc;
      }
      return null;
    };

    productResolver = (id) => {
      if (String(id) === productId) {
        return {
          _id: productId,
          images: [],
          name: { ar: "عنصر", he: "Item" },
        };
      }
      return null;
    };

    discountResolver = () => null;

    const req = {
      body: {
        address: "Card Address",
        items: [
          {
            productId,
            variantId,
            quantity: 2,
          },
        ],
        guestInfo: { name: "Guest" },
        discount: {
          applied: true,
          ruleId: new mongoose.Types.ObjectId().toString(),
          amount: 75,
          type: "fixed",
          value: 75,
        },
      },
    };

    const res = createMockRes();
    await prepareCardHandler(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.total, 300);

    const saved = ordersStore.get(res.body._id);
    assert.ok(saved, "order persisted in store");
    assert.equal(saved.discount.amount, 0);
    assert.equal(saved.total, 300);
  }
);

test(
  "Lahza initialization uses the authoritative order total",
  { concurrency: false },
  async () => {
    resetState();

    const productId = new mongoose.Types.ObjectId().toString();
    const variantId = new mongoose.Types.ObjectId().toString();
    const ruleId = new mongoose.Types.ObjectId().toString();

    const variantDoc = {
      _id: variantId,
      product: productId,
      price: { amount: 120, discount: null },
      stock: { sku: "SKU555", inStock: 10 },
      color: { images: [] },
    };
    variantResolver = (query) => {
      if (
        query?._id &&
        String(query._id) === variantId &&
        (!query.product || String(query.product) === productId)
      ) {
        return variantDoc;
      }
      return null;
    };

    productResolver = (id) => {
      if (String(id) === productId) {
        return {
          _id: productId,
          images: [],
          name: { ar: "منتج", he: "Product" },
        };
      }
      return null;
    };

    const discountRule = {
      _id: ruleId,
      type: "percent",
      value: 20,
      threshold: 100,
      isActive: true,
      name: "Twenty Percent",
    };
    discountResolver = (query) => {
      const threshold = query?.threshold?.$lte ?? Infinity;
      const eligible =
        threshold >= discountRule.threshold && discountRule.isActive;
      if (!eligible) return null;
      if (query?._id) {
        return String(query._id) === ruleId ? discountRule : null;
      }
      return discountRule;
    };

    const orderReq = {
      body: {
        address: "Pay Address",
        items: [
          {
            productId,
            variantId,
            quantity: 2,
          },
        ],
        guestInfo: { name: "Guest" },
        discount: {
          applied: true,
          ruleId,
          amount: 9999,
          type: "percent",
          value: 999,
        },
      },
    };

    const prepareRes = createMockRes();
    await prepareCardHandler(orderReq, prepareRes);
    const orderId = prepareRes.body._id;
    const paymentToken = prepareRes.body.paymentToken;
    const expectedTotal = 192;

    const req = {
      body: {
        orderId,
        paymentToken,
        callback_url: "https://example.com/return",
        name: "Test User",
        email: "user@example.com",
        mobile: "+970500000000",
      },
    };

    const res = createMockRes();
    await lahzaCreateHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.authorization_url);
    assert.ok(res.body.reference);

    assert.ok(lastLahzaPayload, "Lahza payload captured");
    assert.equal(
      lastLahzaPayload.payload.amount,
      Math.round(expectedTotal * 100)
    );
    const metadata = JSON.parse(lastLahzaPayload.payload.metadata);
    assert.equal(metadata.expectedAmountMinor, Math.round(expectedTotal * 100));

    const saved = ordersStore.get(orderId);
    assert.equal(saved.total, expectedTotal);
    assert.equal(saved.reference, "lahza-ref-123");
    assert.equal(saved.paymentMethod, "card");
  }
);

test(
  "Admin pay accepts Lahza verification amounts returned in major units",
  { concurrency: false },
  async () => {
    resetState();

    const reference = "lahza-major-amount";
    const orderId = new mongoose.Types.ObjectId().toString();
    const baseOrder = {
      _id: orderId,
      reference,
      total: 120,
      subtotal: 120,
      discount: { amount: 0 },
      items: [],
      paymentStatus: "unpaid",
      paymentCurrency: "ILS",
      status: "waiting_confirmation",
    };
    ordersStore.set(orderId, baseOrder);

    const previousAxiosGet = axios.get;
    axios.get = async (url) => {
      assert.ok(
        url.includes(reference),
        "verification call should target the order reference"
      );
      return {
        data: {
          data: {
            status: "success",
            amount: 120,
            currency: "ILS",
            metadata: {
              expectedAmountMinor: 12000,
            },
            reference,
            id: "txn-120",
          },
        },
      };
    };

    const req = {
      params: { reference },
      user: { id: new mongoose.Types.ObjectId().toString(), role: "admin" },
    };
    const res = createMockRes();

    try {
      await adminPayHandler(req, res);
    } finally {
      axios.get = previousAxiosGet;
    }

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.paymentStatus, "paid");
    assert.equal(res.body.paymentVerifiedAmount, 120);

    const saved = ordersStore.get(orderId);
    assert.ok(saved, "order should remain stored");
    assert.equal(saved.paymentStatus, "paid");
    assert.equal(saved.paymentVerifiedAmount, 120);
  }
);

test(
  "Lahza webhook accepts IPv6-mapped allowed IPs",
  { concurrency: false },
  async () => {
    resetState();

    const allowedIp = WEBHOOK_ALLOWED_IPS[0] || "203.0.113.5";
    const reference = "lahza-ipv6-whitelist";
    const orderId = new mongoose.Types.ObjectId().toString();
    const baseOrder = {
      _id: orderId,
      reference,
      total: 50,
      subtotal: 50,
      discount: { amount: 0 },
      items: [],
      paymentStatus: "unpaid",
      paymentCurrency: "ILS",
      status: "waiting_confirmation",
    };
    ordersStore.set(orderId, baseOrder);

    const previousAxiosGet = axios.get;
    axios.get = async () => ({
      data: {
        data: {
          status: "success",
          amount_minor: 5000,
          currency: "ILS",
          metadata: {
            expectedAmountMinor: 5000,
          },
          id: "txn-ipv6",
        },
      },
    });

    const eventPayload = {
      event: "charge.success",
      data: {
        reference,
        amount_minor: 5000,
        currency: "ILS",
        metadata: {
          expectedAmountMinor: 5000,
        },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(eventPayload));
    const signature = crypto
      .createHmac("sha256", process.env.LAHZA_SECRET_KEY)
      .update(rawBody)
      .digest("hex");

    const req = {
      headers: {},
      body: rawBody,
      socket: { remoteAddress: `::ffff:${allowedIp}:8443` },
      ip: `::ffff:${allowedIp}:8443`,
      get(header) {
        if (header && header.toLowerCase() === "x-lahza-signature") {
          return signature;
        }
        return this.headers[header];
      },
    };
    const res = createMockRes();

    try {
      await lahzaWebhookHandler(req, res);
    } finally {
      axios.get = previousAxiosGet;
    }

    assert.equal(res.statusCode, 200);
    const saved = ordersStore.get(orderId);
    assert.ok(saved, "order should remain stored");
    assert.equal(saved.paymentStatus, "paid");
    assert.equal(
      getClientIp(req),
      allowedIp,
      "IPv6-mapped remote address should normalize to IPv4"
    );
    assert.equal(
      normalizeIp(` ::ffff:${allowedIp}:1024 `),
      allowedIp,
      "normalizeIp should strip mapped prefix and whitespace"
    );
    assert.equal(
      normalizeIp(`${allowedIp}:443`),
      allowedIp,
      "normalizeIp should drop trailing port from IPv4"
    );
  }
);

test(
  "Lahza webhook treats data.ref as the reference",
  { concurrency: false },
  async () => {
    resetState();

    const allowedIp = WEBHOOK_ALLOWED_IPS[0] || "203.0.113.5";
    const reference = "lahza-ref-alias";
    const orderId = new mongoose.Types.ObjectId().toString();
    const baseOrder = {
      _id: orderId,
      reference,
      total: 25,
      subtotal: 25,
      discount: { amount: 0 },
      items: [],
      paymentStatus: "unpaid",
      paymentCurrency: "ILS",
      status: "waiting_confirmation",
    };
    ordersStore.set(orderId, baseOrder);

    const previousAxiosGet = axios.get;
    axios.get = async () => ({
      data: {
        data: {
          status: "success",
          amount_minor: 2500,
          currency: "ILS",
          metadata: {
            expectedAmountMinor: 2500,
          },
          id: "txn-ref-alias",
        },
      },
    });

    const eventPayload = {
      event: "charge.success",
      data: {
        ref: reference,
        amount_minor: 2500,
        currency: "ILS",
        metadata: {
          expectedAmountMinor: 2500,
        },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(eventPayload));
    const signature = crypto
      .createHmac("sha256", process.env.LAHZA_SECRET_KEY)
      .update(rawBody)
      .digest("hex");

    const req = {
      headers: {},
      body: rawBody,
      socket: { remoteAddress: allowedIp },
      ip: allowedIp,
      get(header) {
        if (header && header.toLowerCase() === "x-lahza-signature") {
          return signature;
        }
        return this.headers[header];
      },
    };
    const res = createMockRes();

    try {
      await lahzaWebhookHandler(req, res);
    } finally {
      axios.get = previousAxiosGet;
    }

    assert.equal(res.statusCode, 200);
    const saved = ordersStore.get(orderId);
    assert.ok(saved, "order should remain stored");
    assert.equal(saved.paymentStatus, "paid");
  }
);

test(
  "Lahza confirm endpoint marks order paid without webhook",
  { concurrency: false },
  async () => {
    resetState();

    const reference = "lahza-fallback-confirm";
    const orderId = new mongoose.Types.ObjectId().toString();
    const baseOrder = {
      _id: orderId,
      reference,
      total: 50,
      subtotal: 50,
      discount: { amount: 0 },
      items: [],
      paymentStatus: "unpaid",
      paymentCurrency: "ILS",
      status: "pending",
    };
    ordersStore.set(orderId, baseOrder);

    const previousAxiosGet = axios.get;
    axios.get = async (url) => {
      assert.ok(url.includes(reference));
      return {
        data: {
          data: {
            status: "success",
            amount_minor: 5000,
            currency: "ILS",
            metadata: {
              expectedAmountMinor: 5000,
              expectedCurrency: "ILS",
            },
            id: "txn-fallback",
          },
        },
      };
    };

    const paymentToken = issuePaymentToken(orderId);
    const req = {
      params: { reference },
      headers: { "x-payment-token": paymentToken },
      body: { paymentToken },
    };
    const res = createMockRes();

    try {
      await lahzaConfirmHandler(req, res);
    } finally {
      axios.get = previousAxiosGet;
    }

    assert.equal(res.statusCode, 200);
    assert.ok(res.body?.ok, "confirm endpoint should respond with ok");
    assert.equal(res.body?.status, "success");
    assert.equal(res.body?.orderId, orderId);
    assert.equal(res.body?.updated, true);
    assert.equal(res.body?.mismatch, false);

    const saved = ordersStore.get(orderId);
    assert.ok(saved, "order should remain stored");
    assert.equal(saved.paymentStatus, "paid");
    assert.equal(saved.paymentVerifiedAmount, 50);
    assert.equal(saved.paymentVerifiedCurrency, "ILS");
    assert.equal(saved.paymentTransactionId, "txn-fallback");
    assert.equal(saved.status, "waiting_confirmation");
  }
);
