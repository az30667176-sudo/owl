// Focused tests for derive.mjs. Zero dependencies: node:test + node:assert only.
//   node --test apps/web/lib/derive.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { kindOf, kindFactor, effOf, deriveEdges, matchRank } from "./derive.mjs";

const row = (o) => ({
  person: "p1", issue: "i1", date: "2026-01-01", score: 0.8, direction: "support",
  linkage: "high", llm_confidence: "high", quote: "q", bill: null, source: "https://x", model: "m",
  ...o,
});

describe("kindOf", () => {
  it("prefers the contract kind field", () => {
    assert.equal(kindOf(row({ kind: "speech", model: "anything" })), "speech");
    assert.equal(kindOf(row({ kind: "sponsored" })), "sponsored");
    assert.equal(kindOf(row({ kind: "cosponsored" })), "cosponsored");
    assert.equal(kindOf(row({ kind: "views" })), "views");
    assert.equal(kindOf(row({ kind: "vote", direction: "support" })), "yea");
    assert.equal(kindOf(row({ kind: "vote", direction: "oppose" })), "nay");
  });
  it("falls back to legacy inference without kind", () => {
    assert.equal(kindOf(row({ model: "owl-ingest-metadata", score: 1 })), "sponsored");
    assert.equal(kindOf(row({ model: "owl-ingest-metadata", score: 0.8 })), "cosponsored");
    assert.equal(kindOf(row({ model: "owl-ingest-rule", rationale: "Signed minority views on H.R. 1." })), "views");
    assert.equal(kindOf(row({ model: "owl-ingest-rule", score: 0.8 })), "yea");
    assert.equal(kindOf(row({ model: "muse-spark-1.3" })), "speech");
  });
});

describe("kindFactor", () => {
  it("scales signatures below speech", () => {
    assert.equal(kindFactor(row({ kind: "speech", score: 0.9 })), 1);
    assert.equal(kindFactor(row({ kind: "sponsored", score: 1 })), 0.8);
    assert.equal(kindFactor(row({ kind: "cosponsored" })), 0.5);
    assert.equal(kindFactor(row({ kind: "views" })), 0.25);
    assert.equal(effOf(row({ kind: "cosponsored" })), 0.4);
  });
  it("splits votes by question, defaulting unknowns to 0.75", () => {
    assert.equal(kindFactor(row({ kind: "vote", direction: "support", vote_question: "final_passage" })), 1);
    assert.equal(kindFactor(row({ kind: "vote", direction: "support", vote_question: "amendment" })), 0.5);
    assert.equal(kindFactor(row({ kind: "vote", direction: "oppose", vote_question: "procedural" })), 0.5);
    assert.equal(kindFactor(row({ kind: "vote", direction: "support" })), 0.75);
    assert.equal(kindFactor(row({ model: "owl-ingest-rule", score: 0.8 })), 0.75);
  });
});

describe("deriveEdges", () => {
  it("shows a pure-cosponsor edge at the effective score", () => {
    const [e] = deriveEdges([row({ kind: "cosponsored" })], { now: new Date("2026-11-03") });
    assert.equal(e.score, 0.4);
    assert.equal(e.direction, "support");
  });
  it("lets speech dominate mixed edges", () => {
    const [e] = deriveEdges(
      [row({ kind: "speech", score: 0.9 }), row({ kind: "cosponsored", score: 0.8 })],
      { now: new Date("2026-11-03") }
    );
    assert.equal(e.score, 0.65); // (0.9 + 0.4) / 2, was 0.85 unweighted
  });
  it("detects flips in speech but not in amendment pairs", () => {
    const speechFlip = deriveEdges(
      [row({ kind: "speech", score: 0.8, direction: "support" }), row({ kind: "speech", score: -0.7, direction: "oppose" })],
      {}
    )[0];
    assert.equal(speechFlip.flip, true);
    const amendmentPair = deriveEdges(
      [
        row({ kind: "vote", direction: "support", score: 0.8, vote_question: "amendment" }),
        row({ kind: "vote", direction: "oppose", score: -0.8, vote_question: "amendment" }),
      ],
      {}
    )[0];
    assert.equal(amendmentPair.flip, false);
    const passagePair = deriveEdges(
      [
        row({ kind: "vote", direction: "support", score: 0.8, vote_question: "final_passage" }),
        row({ kind: "vote", direction: "oppose", score: -0.8, vote_question: "final_passage" }),
      ],
      {}
    )[0];
    assert.equal(passagePair.flip, true);
  });
  it("keeps legacy vote pairs flipping (no question to judge by)", () => {
    const [e] = deriveEdges(
      [
        row({ model: "owl-ingest-rule", score: 0.8, direction: "support" }),
        row({ model: "owl-ingest-rule", score: -0.8, direction: "oppose" }),
      ],
      {}
    );
    assert.equal(e.flip, true);
  });
  it("excludes amendment votes from the score (Kiggans case)", () => {
    const nays = [1, 2, 3].map(() =>
      row({ kind: "vote", direction: "oppose", score: -0.8, vote_question: "amendment" })
    );
    const [e] = deriveEdges(
      [...nays, row({ kind: "vote", direction: "support", score: 0.8, vote_question: "final_passage" })],
      {}
    );
    assert.equal(e.score, 0.8);
    assert.equal(e.direction, "support");
    assert.equal(e.n, 4); // activity still counts every row
  });
  it("scores amendment-only edges neutral without hiding them", () => {
    const [e] = deriveEdges(
      [row({ kind: "vote", direction: "oppose", score: -0.8, vote_question: "amendment" })],
      {}
    );
    assert.equal(e.score, 0);
    assert.equal(e.direction, "neutral");
    assert.equal(e.n, 1);
  });
});

describe("matchRank", () => {
  // two bills; p1 agrees twice, p2 splits, p3 has no score on bill2
  const legsByBill = {
    b1: [{ id: "p1", score: 0.8 }, { id: "p2", score: -0.8 }, { id: "p3", score: 0.8 }],
    b2: [{ id: "p1", score: 0.6 }, { id: "p2", score: 0.7 }, { id: "p3", score: null }],
  };
  const answers = { b1: "support", b2: "support" };
  it("ranks by agreement rate over answered bills with a score", () => {
    const ranked = matchRank(legsByBill, answers, { minAnswers: 1 });
    assert.deepEqual(ranked.map((r) => r.id), ["p1", "p3", "p2"]);
    assert.deepEqual(ranked[0], { id: "p1", answered: 2, agreed: 2, rate: 1 });
    assert.deepEqual(ranked[1], { id: "p3", answered: 1, agreed: 1, rate: 1 });
    assert.deepEqual(ranked[2], { id: "p2", answered: 2, agreed: 1, rate: 0.5 });
  });
  it("enforces the minimum-answers floor", () => {
    const ranked = matchRank(legsByBill, answers, { minAnswers: 2 });
    assert.deepEqual(ranked.map((r) => r.id), ["p1", "p2"]);
  });
  it("counts neutral scores as answered but not agreed", () => {
    const ranked = matchRank({ b1: [{ id: "p1", score: 0.05 }] }, { b1: "support" }, { minAnswers: 1 });
    assert.deepEqual(ranked, [{ id: "p1", answered: 1, agreed: 0, rate: 0 }]);
  });
  it("returns nothing without answers", () => {
    assert.deepEqual(matchRank(legsByBill, {}, { minAnswers: 1 }), []);
  });
});
