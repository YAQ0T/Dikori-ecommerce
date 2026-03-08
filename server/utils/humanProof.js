const crypto = require("crypto");

class HumanProofError extends Error {
  constructor(
    message,
    { statusCode = 400, code = "HUMAN_PROOF_FAILED", details } = {}
  ) {
    super(message);
    this.name = "HumanProofError";
    this.statusCode = statusCode;
    this.code = code;
    if (details) {
      this.details = details;
    }
  }
}

const ACTION_RE = /^[a-z0-9_-]{1,64}$/;
const usedChallenges = new Map();

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeAction(action) {
  const normalized = String(action || "checkout").trim().toLowerCase();
  if (!normalized) return "checkout";
  return ACTION_RE.test(normalized) ? normalized : "checkout";
}

function getConfig() {
  const difficulty = clamp(
    toPositiveInt(process.env.HUMAN_PROOF_DIFFICULTY, 3),
    2,
    6
  );
  const ttlMs = clamp(
    toPositiveInt(process.env.HUMAN_PROOF_CHALLENGE_TTL_MS, 120_000),
    30_000,
    5 * 60_000
  );
  const maxNonce = clamp(
    toPositiveInt(process.env.HUMAN_PROOF_MAX_NONCE, 250_000),
    10_000,
    5_000_000
  );
  const secret = String(
    process.env.HUMAN_PROOF_SECRET ||
      process.env.JWT_SECRET ||
      process.env.JWT_SECRET_KEY ||
      "dev-human-proof-secret"
  );
  return { difficulty, ttlMs, maxNonce, secret };
}

function cleanupUsedChallenges(now = Date.now()) {
  for (const [id, expiresAt] of usedChallenges.entries()) {
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      usedChallenges.delete(id);
    }
  }
}

function signPayload(payload, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function buildPayload({ challengeId, expiresAt, action, difficulty, maxNonce }) {
  return `${challengeId}.${expiresAt}.${action}.${difficulty}.${maxNonce}`;
}

function parseChallengeToken(challengeToken) {
  const parts = String(challengeToken || "").split(".");
  if (parts.length !== 6) {
    throw new HumanProofError("Invalid challenge token format", {
      code: "INVALID_CHALLENGE_TOKEN",
    });
  }

  const [challengeId, expiresRaw, actionRaw, difficultyRaw, maxNonceRaw, sig] =
    parts;
  if (!/^[a-f0-9]{32}$/i.test(challengeId)) {
    throw new HumanProofError("Invalid challenge id", {
      code: "INVALID_CHALLENGE_ID",
    });
  }
  if (!ACTION_RE.test(actionRaw)) {
    throw new HumanProofError("Invalid challenge action", {
      code: "INVALID_CHALLENGE_ACTION",
    });
  }

  const expiresAt = Number.parseInt(expiresRaw, 10);
  const difficulty = Number.parseInt(difficultyRaw, 10);
  const maxNonce = Number.parseInt(maxNonceRaw, 10);

  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new HumanProofError("Invalid challenge expiry", {
      code: "INVALID_CHALLENGE_EXPIRY",
    });
  }
  if (!Number.isFinite(difficulty) || difficulty < 1 || difficulty > 8) {
    throw new HumanProofError("Invalid challenge difficulty", {
      code: "INVALID_CHALLENGE_DIFFICULTY",
    });
  }
  if (!Number.isFinite(maxNonce) || maxNonce < 1) {
    throw new HumanProofError("Invalid challenge max nonce", {
      code: "INVALID_CHALLENGE_MAX_NONCE",
    });
  }

  return {
    challengeId,
    expiresAt,
    action: actionRaw,
    difficulty,
    maxNonce,
    signature: sig,
  };
}

function createHumanProofChallenge({ action } = {}) {
  const now = Date.now();
  cleanupUsedChallenges(now);
  const { ttlMs, difficulty, maxNonce, secret } = getConfig();
  const challengeId = crypto.randomBytes(16).toString("hex");
  const expiresAt = now + ttlMs;
  const normalizedAction = normalizeAction(action);
  const payload = buildPayload({
    challengeId,
    expiresAt,
    action: normalizedAction,
    difficulty,
    maxNonce,
  });

  return {
    challengeToken: `${payload}.${signPayload(payload, secret)}`,
    challengeId,
    action: normalizedAction,
    difficulty,
    maxNonce,
    expiresAt,
  };
}

function verifyHumanProofPayload({ proof, expectedAction } = {}) {
  if (!proof || typeof proof !== "object") {
    throw new HumanProofError("Human proof payload is required", {
      code: "MISSING_HUMAN_PROOF",
    });
  }

  const challengeToken = String(proof.challengeToken || "").trim();
  const nonceRaw = String(proof.nonce ?? "").trim();

  if (!challengeToken || !nonceRaw) {
    throw new HumanProofError("Challenge token and nonce are required", {
      code: "MISSING_HUMAN_PROOF_FIELDS",
    });
  }
  if (!/^\d+$/.test(nonceRaw)) {
    throw new HumanProofError("Nonce must be a positive integer", {
      code: "INVALID_NONCE",
    });
  }

  const nonce = Number.parseInt(nonceRaw, 10);
  const parsed = parseChallengeToken(challengeToken);
  const now = Date.now();
  cleanupUsedChallenges(now);

  const normalizedExpectedAction = normalizeAction(expectedAction || parsed.action);
  if (parsed.action !== normalizedExpectedAction) {
    throw new HumanProofError("Unexpected human proof action", {
      code: "UNEXPECTED_HUMAN_PROOF_ACTION",
      details: {
        expectedAction: normalizedExpectedAction,
        action: parsed.action,
      },
    });
  }

  if (parsed.expiresAt <= now) {
    throw new HumanProofError("Challenge expired", {
      code: "CHALLENGE_EXPIRED",
    });
  }

  if (nonce > parsed.maxNonce) {
    throw new HumanProofError("Nonce is out of allowed range", {
      code: "NONCE_OUT_OF_RANGE",
      details: { maxNonce: parsed.maxNonce },
    });
  }

  if (usedChallenges.has(parsed.challengeId)) {
    throw new HumanProofError("Challenge already used", {
      code: "CHALLENGE_ALREADY_USED",
    });
  }

  const { secret } = getConfig();
  const payload = buildPayload(parsed);
  const expectedSignature = signPayload(payload, secret);
  if (!safeEqual(expectedSignature, parsed.signature)) {
    throw new HumanProofError("Challenge signature mismatch", {
      code: "INVALID_CHALLENGE_SIGNATURE",
    });
  }

  const digest = crypto
    .createHash("sha256")
    .update(`${challengeToken}:${nonceRaw}`)
    .digest("hex");
  if (!digest.startsWith("0".repeat(parsed.difficulty))) {
    throw new HumanProofError("Human proof challenge not solved", {
      code: "PROOF_OF_WORK_FAILED",
      details: { difficulty: parsed.difficulty },
    });
  }

  usedChallenges.set(parsed.challengeId, parsed.expiresAt);
  return {
    success: true,
    action: parsed.action,
    difficulty: parsed.difficulty,
    expiresAt: parsed.expiresAt,
  };
}

function __unsafeResetHumanProofState() {
  usedChallenges.clear();
}

module.exports = {
  createHumanProofChallenge,
  verifyHumanProofPayload,
  HumanProofError,
  __unsafeResetHumanProofState,
};
