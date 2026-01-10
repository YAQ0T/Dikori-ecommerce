// server/utils/paymentTokens.js
// Lightweight, in-memory JWT helper for authorizing payment actions
const jwt = require("jsonwebtoken");
const { getJwtSecret } = require("./config");

const PAYMENT_TOKEN_SECRET =
  process.env.PAYMENT_TOKEN_SECRET || getJwtSecret();
const PAYMENT_TOKEN_TTL = process.env.PAYMENT_TOKEN_TTL || "60m";

function issuePaymentToken(orderId) {
  if (!orderId) return null;
  return jwt.sign({ orderId: String(orderId) }, PAYMENT_TOKEN_SECRET, {
    expiresIn: PAYMENT_TOKEN_TTL,
  });
}

function verifyPaymentToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, PAYMENT_TOKEN_SECRET);
  } catch {
    return null;
  }
}

function extractPaymentTokenFromRequest(req) {
  if (!req) return null;
  const headerToken =
    typeof req.get === "function" ? req.get("x-payment-token") : null;
  if (headerToken) return headerToken;

  const bodyToken = req.body?.paymentToken;
  if (bodyToken) return bodyToken;

  const queryToken = req.query?.paymentToken || req.query?.token;
  if (queryToken) return queryToken;

  return null;
}

module.exports = {
  issuePaymentToken,
  verifyPaymentToken,
  extractPaymentTokenFromRequest,
};
