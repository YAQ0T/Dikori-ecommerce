// server/routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const { getJwtSecret } = require("../utils/config");
const { sendSMSHTD, normalizePhone } = require("../utils/smsHtd");
const { createRateLimiter } = require("../utils/rateLimit");

const router = express.Router();

const DEFAULT_RESET_PASSWORD_MAX_ATTEMPTS = 5;
const parsedResetAttempts = Number.parseInt(
  process.env.RESET_PASSWORD_MAX_ATTEMPTS,
  10
);
const RESET_PASSWORD_MAX_ATTEMPTS =
  Number.isInteger(parsedResetAttempts) && parsedResetAttempts > 0
    ? parsedResetAttempts
    : DEFAULT_RESET_PASSWORD_MAX_ATTEMPTS;

const RESET_PASSWORD_THROTTLE_MESSAGE =
  "تجاوزت الحد المسموح لمحاولات التحقق. اطلب رمزًا جديدًا.";

/* =========================
   ضبط بيئة/إعدادات
========================= */
const JWT_SECRET = getJwtSecret();
const limiterSignup = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: "تجاوزت حد محاولات التسجيل، حاول لاحقًا.",
  name: "auth-signup",
});
const limiterLogin = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 40,
  message: "محاولات تسجيل دخول كثيرة. حاول بعد قليل.",
  name: "auth-login",
});
const limiterSendSms = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: "تجاوزت حد إرسال أكواد التحقق. حاول لاحقًا.",
  name: "auth-send-sms",
  keyGenerator: (req) => {
    const ip = req.ip || req.headers["x-forwarded-for"] || "ip";
    const normPhone = req.body?.phone ? normalizePhone(req.body.phone) : null;
    const userId = req.body?.userId ? String(req.body.userId) : "";
    return `${ip}:${normPhone || userId || "unknown"}`;
  },
});
const limiterPasswordRequest = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: "طلبات الاستعادة كثيرة. حاول لاحقًا.",
  name: "auth-password-request",
  keyGenerator: (req) => {
    const ip = req.ip || req.headers["x-forwarded-for"] || "ip";
    const normPhone = req.body?.phone ? normalizePhone(req.body.phone) : null;
    const normEmail = req.body?.email
      ? String(req.body.email).trim().toLowerCase()
      : "";
    return `${ip}:${normPhone || normEmail || "unknown"}`;
  },
});
const limiterPasswordReset = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: "محاولات إعادة التعيين كثيرة. حاول لاحقًا.",
  name: "auth-password-reset",
  keyGenerator: (req) => {
    const ip = req.ip || req.headers["x-forwarded-for"] || "ip";
    const normPhone = req.body?.phone ? normalizePhone(req.body.phone) : null;
    const normEmail = req.body?.email
      ? String(req.body.email).trim().toLowerCase()
      : "";
    return `${ip}:${normPhone || normEmail || "unknown"}`;
  },
});
const limiterVerifySms = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: "محاولات التحقق كثيرة. حاول لاحقًا.",
  name: "auth-verify-sms",
});

function normalizeEmail(email) {
  if (!email) return null;
  const e = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

/* =========================
   OTP Helpers
========================= */
function isBcryptHash(str) {
  return typeof str === "string" && /^\$2[aby]\$/.test(str);
}

async function verifyPhoneOTPHybrid(user, code) {
  if (!user.phoneVerificationCodeHash || !user.phoneVerificationExpires)
    return false;
  if (user.phoneVerificationExpires.getTime() < Date.now()) return false;

  const stored = user.phoneVerificationCodeHash;

  if (isBcryptHash(stored)) {
    try {
      const ok = await bcrypt.compare(String(code), stored);
      return !!ok;
    } catch {
      return false;
    }
  }

  const hash = crypto.createHash("sha256").update(String(code)).digest("hex");
  return hash === stored;
}

async function setPhoneOTPOnUser(user, code) {
  const hash = await bcrypt.hash(String(code), 10);
  user.phoneVerificationCodeHash = hash;
  user.phoneVerificationExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 دقائق
  user.phoneVerificationAttempts = 0;
}

/* =========================
   إنشاء حساب
========================= */
router.post("/signup", limiterSignup, async (req, res) => {
  try {
    const { name, phone, email, password } = req.body || {};

    const normPhone = phone ? normalizePhone(phone) : null;
    const normEmail = email ? normalizeEmail(email) : null;

    if ((!normPhone && !normEmail) || !password || !name) {
      return res.status(400).json({
        message:
          "أدخل جوالًا صحيحًا أو بريدًا إلكترونيًا صالحًا مع كلمة المرور والاسم",
      });
    }

    const or = [];
    if (normPhone) or.push({ phone: normPhone });
    if (normEmail) or.push({ email: normEmail });

    let existing = null;
    if (or.length > 0) {
      existing = await User.findOne({ $or: or }).lean();
    }

    if (existing) {
      return res
        .status(409)
        .json({ message: "الحساب موجود مسبقًا لهذا البريد/الجوال" });
    }

    const hash = await bcrypt.hash(String(password), 10);

    const user = new User({
      name: String(name || "").trim(),
      email: normEmail || undefined,
      phone: normPhone || undefined,
      password: hash,
      role: "user",
      phoneVerified: false,
      phoneVerificationAttempts: 0,
    });

    const code = Math.floor(100000 + Math.random() * 900000);

    if (typeof user.setPhoneOTP === "function") {
      user.setPhoneOTP(code); // قد تستخدم SHA-256 بناءً على الـ Model
    } else {
      await setPhoneOTPOnUser(user, code); // احتياطي (bcrypt)
    }

    await user.save();

    if (user.phone) {
      await sendSMSHTD(user.phone, `رمز التحقق: ${code}`);
    }

    return res.status(201).json({
      message: "تم إنشاء الحساب. أرسلنا رمز تحقق إلى جوالك (إن كان متاحًا).",
      userId: user._id,
      phone: user.phone || null,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      const keys = Object.keys(err.keyPattern || {});
      const what = keys.length ? keys.join(", ") : "حقل فريد";
      return res.status(409).json({ message: `قيمة مكررة في ${what}` });
    }
    console.error("signup error:", err);
    return res
      .status(500)
      .json({ message: err?.message || "حدث خطأ أثناء إنشاء الحساب" });
  }
});

/* =========================
   إرسال كود SMS (اختياري)
========================= */
router.post("/send-sms-code", limiterSendSms, async (req, res) => {
  try {
    const { userId, phone } = req.body || {};

    const user = userId
      ? await User.findById(userId)
      : await User.findOne({ phone: normalizePhone(phone) });

    if (!user) return res.status(404).json({ message: "المستخدم غير موجود" });

    const code = Math.floor(100000 + Math.random() * 900000);

    if (typeof user.setPhoneOTP === "function") {
      user.setPhoneOTP(code);
    } else {
      await setPhoneOTPOnUser(user, code);
    }

    await user.save();

    if (user.phone) {
      await sendSMSHTD(user.phone, `رمز التحقق: ${code}`);
    }

    return res.json({
      ok: true,
      userId: user._id,
      phone: user.phone || null,
      message:
        "إن كان الجوال مسجّلًا، فقد أرسلنا رمز تحقق جديد. صالح لمدة 5 دقائق.",
    });
  } catch (err) {
    console.error("send-sms-code error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   توثيق رمز الـ SMS
========================= */
router.post("/verify-sms", limiterVerifySms, async (req, res) => {
  try {
    const { userId, code } = req.body || {};
    if (!userId || !code)
      return res.status(400).json({ message: "بيانات ناقصة" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "المستخدم غير موجود" });
    if (user.phoneVerified)
      return res.json({ ok: true, message: "الهاتف موثق مسبقًا" });

    if (user.phoneVerificationAttempts >= 6) {
      return res
        .status(429)
        .json({ message: "تجاوزت حد المحاولات. اطلب رمزًا جديدًا" });
    }

    user.phoneVerificationAttempts += 1;
    const ok = await verifyPhoneOTPHybrid(user, code);

    if (!ok) {
      await user.save();
      return res.status(400).json({ message: "رمز غير صحيح أو منتهي" });
    }

    user.phoneVerified = true;
    user.phoneVerificationCodeHash = undefined;
    user.phoneVerificationExpires = undefined;
    user.phoneVerificationAttempts = 0;
    await user.save();

    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, {
      expiresIn: "90d",
    });

    return res.json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email || null,
        role: user.role,
        phone: user.phone,
        phoneVerified: user.phoneVerified,
      },
      message: "تم توثيق رقم الهاتف بنجاح",
    });
  } catch (err) {
    console.error("verify-sms error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   تسجيل الدخول
========================= */
router.post("/login", limiterLogin, async (req, res) => {
  try {
    const { phone, email, password } = req.body || {};
    if ((!phone && !email) || !password) {
      return res
        .status(400)
        .json({ message: "أدخل رقم الجوال أو البريد مع كلمة المرور" });
    }

    const query = phone
      ? { phone: normalizePhone(phone) }
      : { email: String(email).toLowerCase() };
    const user = await User.findOne(query);
    if (!user)
      return res.status(400).json({ message: "بيانات الدخول غير صحيحة" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: "كلمة المرور خاطئة" });

    if (!user.phoneVerified) {
      try {
        const code = Math.floor(100000 + Math.random() * 900000);
        if (typeof user.setPhoneOTP === "function") {
          user.setPhoneOTP(code);
        } else {
          await setPhoneOTPOnUser(user, code);
        }
        await user.save();

        if (user.phone) {
          await sendSMSHTD(user.phone, `رمز التحقق: ${code}`);
        }
      } catch (e) {
        console.error("auto-otp-on-login error:", e);
      }

      return res.status(403).json({
        message: "يجب توثيق رقم الجوال قبل تسجيل الدخول. أرسلنا رمز تحقق جديد.",
        userId: user._id,
        phone: user.phone || null,
      });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, {
      expiresIn: "90d",
    });

    res.json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email || null,
        role: user.role,
        phone: user.phone,
        phoneVerified: user.phoneVerified,
      },
    });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   نسيت كلمة المرور — طلب كود
========================= */
router.post("/password/request-reset", limiterPasswordRequest, async (req, res) => {
  try {
    const { phone, email } = req.body || {};
    if (!phone && !email) {
      return res
        .status(400)
        .json({ message: "أدخل رقم الجوال أو البريد لإرسال رمز الاستعادة" });
    }

    const user = phone
      ? await User.findOne({ phone: normalizePhone(phone) })
      : await User.findOne({ email: String(email).toLowerCase() });

    if (!user) {
      return res.json({
        message: "إن كان الحساب موجودًا سنرسل رمز الاستعادة إلى بياناتك.",
      });
    }

    const code = Math.floor(100000 + Math.random() * 900000);

    const hash = await bcrypt.hash(String(code), 10);
    user.resetPasswordCodeHash = hash;
    user.resetPasswordExpires = new Date(Date.now() + 10 * 60 * 1000);
    user.resetPasswordAttempts = 0;
    await user.save();

    if (user.phone) {
      await sendSMSHTD(user.phone, `رمز الاستعادة: ${code}`);
    }

    return res.json({
      message: "إن كان الحساب موجودًا سنرسل لك رمز الاستعادة (صالح 10 دقائق).",
    });
  } catch (err) {
    console.error("password-request error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   استكمال إعادة التعيين
========================= */
router.post("/password/reset", limiterPasswordReset, async (req, res) => {
  try {
    const { token, password, email, phone } = req.body || {};
    if (!token || !password || (!email && !phone)) {
      return res.status(400).json({ message: "بيانات ناقصة" });
    }

    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = phone ? normalizePhone(phone) : null;

    const user = normalizedEmail
      ? await User.findOne({ email: normalizedEmail })
      : await User.findOne({ phone: normalizedPhone });

    if (!user) {
      return res.status(400).json({ message: "رمز غير صحيح أو منتهي" });
    }

    if (
      !user.resetPasswordCodeHash ||
      !user.resetPasswordExpires ||
      user.resetPasswordExpires.getTime() < Date.now()
    ) {
      return res.status(400).json({ message: "رمز غير صحيح أو منتهي" });
    }

    const attempts = Number.isFinite(Number(user.resetPasswordAttempts))
      ? Number(user.resetPasswordAttempts)
      : 0;
    if (attempts >= RESET_PASSWORD_MAX_ATTEMPTS) {
      return res
        .status(429)
        .json({ message: RESET_PASSWORD_THROTTLE_MESSAGE });
    }

    const ok = await bcrypt.compare(String(token), user.resetPasswordCodeHash);
    if (!ok) {
      user.resetPasswordAttempts = attempts + 1;
      await user.save();
      return res
        .status(429)
        .json({ message: RESET_PASSWORD_THROTTLE_MESSAGE });
    }

    const newPassword = String(password);
    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ message: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });
    }

    user.password = await bcrypt.hash(String(newPassword), 10);
    user.resetPasswordCodeHash = undefined;
    user.resetPasswordExpires = undefined;
    user.resetPasswordAttempts = 0;

    await user.save();
    return res.json({ ok: true, message: "تم تحديث كلمة المرور بنجاح" });
  } catch (err) {
    console.error("password-reset error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
