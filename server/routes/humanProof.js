const express = require("express");

const router = express.Router();
const { createRateLimiter } = require("../utils/rateLimit");
const { validateBody, z } = require("../utils/validate");
const { createHumanProofChallenge } = require("../utils/humanProof");

const challengeLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 40,
  message: "طلبات تحقق كثيرة. حاول بعد قليل.",
  name: "human-proof-challenge",
});

const challengeSchema = z.object({
  action: z.string().trim().max(64).optional(),
});

router.post(
  "/challenge",
  challengeLimiter,
  validateBody(challengeSchema),
  (req, res) => {
    try {
      const challenge = createHumanProofChallenge({
        action: req.body?.action,
      });
      return res.json(challenge);
    } catch (err) {
      console.error("Human proof challenge error:", err);
      return res
        .status(500)
        .json({ message: "تعذر إنشاء تحدي التحقق", error: "CHALLENGE_ERROR" });
    }
  }
);

module.exports = router;
