// Focused tests for blind-scoring.mjs. Zero dependencies: node:test + node:assert only.
//   node --test services/process/audit/blind-scoring.test.mjs
// These cover the pure helpers (sampling, scrubbing, summarising). Live model
// calls are exercised by --dry-run (no API) and real runs, not by unit tests.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { seededSample, scrubSpeaker, summarize } from "./blind-scoring.mjs";

describe("seededSample", () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ statement_id: `st${i}` }));
  it("is deterministic for a seed and draws from the input", () => {
    const a = seededSample(rows, 10, 30);
    const b = seededSample(rows, 10, 30);
    assert.deepEqual(a, b);
    assert.equal(a.length, 10);
    assert.equal(new Set(a.map((r) => r.statement_id)).size, 10);
  });
  it("caps at the input size", () => {
    assert.equal(seededSample(rows, 500, 30).length, 50);
  });
});

describe("scrubSpeaker", () => {
  it("replaces full, first, and last names", () => {
    assert.equal(scrubSpeaker("As Brendan Boyle said, Boyle agrees.", "Brendan F. Boyle"), "As [SPEAKER] [SPEAKER] said, [SPEAKER] agrees.");
    assert.equal(scrubSpeaker("BOYLE voted yes.", "Brendan F. Boyle"), "[SPEAKER] voted yes.");
    assert.equal(scrubSpeaker("Fields said no.", "Rep. Cleo Fields"), "[SPEAKER] said no.");
  });
  it("keeps lowercase lookalikes but scrubs capitalised names", () => {
    assert.equal(scrubSpeaker("The banks failed.", "Jim Banks"), "The banks failed.");
    assert.equal(scrubSpeaker("Banks spoke first.", "Jim Banks"), "[SPEAKER] spoke first.");
    assert.equal(scrubSpeaker("The bill is bold.", "Brendan F. Boyle"), "The bill is bold.");
    assert.equal(scrubSpeaker("Boyle Heights is a place.", "Someone Else"), "Boyle Heights is a place.");
  });
});

describe("summarize", () => {
  // published/blind pairs: (0.8, 0.6) D agree, (-0.8, -0.7) D agree, (0.5, -0.5) R flip, (0.1, 0.0) R agree-neutral
  const rows = [
    { statement_id: "st1", party: "D", published: 0.8, blind: 0.6 },
    { statement_id: "st2", party: "D", published: -0.8, blind: -0.7 },
    { statement_id: "st3", party: "R", published: 0.5, blind: -0.5 },
    { statement_id: "st4", party: "R", published: 0.1, blind: 0.0 },
    { statement_id: "st5", party: "D", published: 0.8, blind: null, error: "HTTP 500" },
  ];
  it("computes means and agreement over scored rows only", () => {
    const s = summarize(rows);
    const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ~= ${b}`);
    assert.equal(s.n, 4);
    assert.equal(s.failed, 1);
    close(s.mean_abs_diff, (0.2 + 0.1 + 1.0 + 0.1) / 4);
    close(s.mean_signed_diff, (-0.2 + 0.1 - 1.0 - 0.1) / 4);
    close(s.direction_agreement, 0.75);
  });
  it("splits by party and ranks the largest disagreements", () => {
    const s = summarize(rows);
    const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ~= ${b}`);
    assert.equal(s.by_party.D.n, 2);
    close(s.by_party.D.mean_abs_diff, 0.15);
    close(s.by_party.D.mean_signed_diff, -0.05);
    close(s.by_party.R.mean_signed_diff, -0.55);
    close(s.by_party.R.direction_agreement, 0.5);
    assert.deepEqual(s.top10.map((r) => r.statement_id), ["st3", "st1", "st2", "st4"]);
  });
});
