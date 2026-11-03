// Focused tests for scoring.mjs. Zero dependencies: node:test + node:assert only.
//   node --test services/process/scoring.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { INTENSITY_BANDS, bandScore, dirSign, resolveScore } from "./scoring.mjs";

describe("INTENSITY_BANDS", () => {
  it("covers the full 0..1 magnitude range without gaps", () => {
    const edges = ["neutral", "lean", "qualified", "clear", "strong"].map((b) => INTENSITY_BANDS[b]);
    assert.equal(edges[0][0], 0);
    assert.equal(edges[edges.length - 1][1], 1);
    for (let i = 1; i < edges.length; i++) assert.equal(edges[i][0], edges[i - 1][1]);
  });
});

describe("bandScore", () => {
  it("interpolates position inside the band", () => {
    assert.equal(bandScore("strong", 0, 1), 0.85);
    assert.equal(bandScore("strong", 1, 1), 1);
    assert.equal(bandScore("qualified", 0.5, -1), -0.525);
    assert.equal(bandScore("lean", 0, 1), 0.15);
  });
  it("clamps out-of-range positions and defaults missing ones to mid-band", () => {
    assert.equal(bandScore("clear", 2, 1), 0.85);
    assert.equal(bandScore("clear", -1, 1), 0.65);
    assert.equal(bandScore("clear", undefined, 1), 0.75);
    assert.equal(bandScore("clear", "junk", 1), 0.75);
  });
  it("returns 0 for neutral direction and null for unknown bands", () => {
    assert.equal(bandScore("strong", 1, 0), 0);
    assert.equal(bandScore("emphatic", 0.5, 1), null);
  });
});

describe("dirSign", () => {
  it("normalises direction variants", () => {
    assert.equal(dirSign("support"), 1);
    assert.equal(dirSign("Supportive"), 1);
    assert.equal(dirSign("oppose"), -1);
    assert.equal(dirSign("Opposed"), -1);
    assert.equal(dirSign("opposition"), -1);
    assert.equal(dirSign("neutral"), 0);
    assert.equal(dirSign(""), 0);
    assert.equal(dirSign(null), 0);
  });
});

describe("resolveScore", () => {
  it("prefers the intensity band over any raw score", () => {
    assert.equal(resolveScore({ intensity: "qualified", position: 0.5, direction: "support", score: 0.99 }), 0.525);
  });
  it("accepts legacy raw scores when no band is given", () => {
    assert.equal(resolveScore({ score: 0.8 }), 0.8);
    assert.equal(resolveScore({ score: -0.3 }), -0.3);
    assert.equal(resolveScore({ score: 2 }), null);
    assert.equal(resolveScore({}), null);
  });
  it("rejects unknown bands", () => {
    assert.equal(resolveScore({ intensity: "emphatic", position: 0.5, direction: "support" }), null);
  });
});
