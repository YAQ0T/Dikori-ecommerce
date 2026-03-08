const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  createHumanProofChallenge,
  verifyHumanProofPayload,
  HumanProofError,
  __unsafeResetHumanProofState,
} = require("../utils/humanProof");

const ORIGINAL_ENV = {
  HUMAN_PROOF_SECRET: process.env.HUMAN_PROOF_SECRET,
  HUMAN_PROOF_DIFFICULTY: process.env.HUMAN_PROOF_DIFFICULTY,
  HUMAN_PROOF_CHALLENGE_TTL_MS: process.env.HUMAN_PROOF_CHALLENGE_TTL_MS,
  HUMAN_PROOF_MAX_NONCE: process.env.HUMAN_PROOF_MAX_NONCE,
};

function solveProof(challengeToken, difficulty, maxNonce) {
  const prefix = "0".repeat(difficulty);
  for (let nonce = 0; nonce <= maxNonce; nonce += 1) {
    const digest = crypto
      .createHash("sha256")
      .update(`${challengeToken}:${nonce}`)
      .digest("hex");
    if (digest.startsWith(prefix)) {
      return String(nonce);
    }
  }
  return null;
}

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test.beforeEach(() => {
  process.env.HUMAN_PROOF_SECRET = "test-human-proof-secret";
  process.env.HUMAN_PROOF_DIFFICULTY = "2";
  process.env.HUMAN_PROOF_CHALLENGE_TTL_MS = "60000";
  process.env.HUMAN_PROOF_MAX_NONCE = "40000";
  __unsafeResetHumanProofState();
});

test.after(() => {
  __unsafeResetHumanProofState();
  restoreEnv();
});

test("human proof challenge can be solved once", () => {
  const challenge = createHumanProofChallenge({ action: "checkout" });
  const nonce = solveProof(
    challenge.challengeToken,
    challenge.difficulty,
    challenge.maxNonce
  );
  assert.ok(nonce, "expected a solvable nonce");

  const verified = verifyHumanProofPayload({
    proof: {
      challengeToken: challenge.challengeToken,
      nonce,
      action: "checkout",
    },
    expectedAction: "checkout",
  });
  assert.equal(verified.success, true);
  assert.equal(verified.action, "checkout");

  assert.throws(
    () =>
      verifyHumanProofPayload({
        proof: {
          challengeToken: challenge.challengeToken,
          nonce,
          action: "checkout",
        },
        expectedAction: "checkout",
      }),
    (err) =>
      err instanceof HumanProofError && err.code === "CHALLENGE_ALREADY_USED"
  );
});

test("human proof rejects mismatched action", () => {
  const challenge = createHumanProofChallenge({ action: "checkout" });
  const nonce = solveProof(
    challenge.challengeToken,
    challenge.difficulty,
    challenge.maxNonce
  );
  assert.ok(nonce, "expected a solvable nonce");

  assert.throws(
    () =>
      verifyHumanProofPayload({
        proof: {
          challengeToken: challenge.challengeToken,
          nonce,
          action: "checkout",
        },
        expectedAction: "contact",
      }),
    (err) =>
      err instanceof HumanProofError &&
      err.code === "UNEXPECTED_HUMAN_PROOF_ACTION"
  );
});
