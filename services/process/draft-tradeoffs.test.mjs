// Focused tests for draft-tradeoffs.mjs. Zero dependencies: node:test + node:assert only.
//   node --test services/process/draft-tradeoffs.test.mjs
// Covers the pure helpers (prompt building, draft validation). Live model calls
// are exercised by --dry-run (no API) and real runs, not by unit tests.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTradeoffPrompt, validateTradeoffDraft, wordCount } from "./draft-tradeoffs.mjs";

const bill = {
  bill_id: "hr649-119",
  number: "H.R. 649",
  short_context: "The bill would let schools in federal meal programs offer whole milk.",
  binary_question: {
    question: "Should schools be allowed to serve whole milk?",
    options: [
      { stance: "support", label: "Allow schools to serve whole milk" },
      { stance: "oppose", label: "Keep current limits on milk fat" },
    ],
  },
};

describe("wordCount", () => {
  it("counts whitespace-separated tokens like the validator", () => {
    assert.equal(wordCount("one two  three"), 3);
    assert.equal(wordCount("  padded  "), 1);
  });
});

describe("buildTradeoffPrompt", () => {
  it("includes the context, question and both options", () => {
    const { system, user } = buildTradeoffPrompt(bill);
    assert.match(system, /25 words/);
    assert.match(system, /tradeoff/i);
    assert.match(user, /whole milk/);
    assert.match(user, /Should schools be allowed/);
    assert.match(user, /\[support\] Allow schools/);
    assert.match(user, /\[oppose\] Keep current limits/);
  });
});

describe("validateTradeoffDraft", () => {
  it("accepts a balanced pair within caps", () => {
    assert.deepEqual(validateTradeoffDraft({ tradeoffs: { support: "More saturated fat in school meals.", oppose: "Schools lose a popular menu option." } }), []);
  });
  it("rejects missing, over-long and over-worded tradeoffs", () => {
    assert.ok(validateTradeoffDraft({ tradeoffs: { support: "Fine." } }).some((p) => /oppose.*missing/.test(p)));
    assert.ok(validateTradeoffDraft({ tradeoffs: { support: "x".repeat(201), oppose: "Fine." } }).some((p) => /200 chars/.test(p)));
    const long = Array(26).fill("word").join(" ");
    assert.ok(validateTradeoffDraft({ tradeoffs: { support: long, oppose: "Fine." } }).some((p) => /25 words/.test(p)));
    assert.ok(validateTradeoffDraft({}).some((p) => /tradeoffs missing/.test(p)));
  });
});
