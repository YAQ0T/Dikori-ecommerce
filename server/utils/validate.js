const { z } = require("zod");

const errorResponse = (res, error) => {
  const details = error?.flatten ? error.flatten() : undefined;
  return res.status(400).json({
    message: "بيانات الطلب غير صالحة",
    details,
  });
};

const validateBody = (schema) => (req, res, next) => {
  try {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) return errorResponse(res, result.error);
    req.body = result.data;
    return next();
  } catch (err) {
    return errorResponse(res, err);
  }
};

const validateParams = (schema) => (req, res, next) => {
  try {
    const result = schema.safeParse(req.params ?? {});
    if (!result.success) return errorResponse(res, result.error);
    req.params = result.data;
    return next();
  } catch (err) {
    return errorResponse(res, err);
  }
};

const optionalString = (min = 1) =>
  z
    .string()
    .trim()
    .min(min)
    .optional();

module.exports = {
  validateBody,
  validateParams,
  optionalString,
  z,
};
