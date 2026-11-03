// Focused tests for draft-bill-context.mjs. Zero dependencies: node:test + node:assert only.
//   node --test services/process/draft-bill-context.test.mjs
// Covers the pure helpers (prompt building, draft validation). Live model calls
// are exercised by --dry-run (no API) and real runs, not by unit tests.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, validateDraft, wordCount } from "./draft-bill-context.mjs";

const bill = {
  bill_id: "hr1262-119",
  number: "H.R. 1262",
  title: "Mikaela Naylon Give Kids a Chance Act",
  status: "passed_house",
};

describe("wordCount", () => {
  it("counts whitespace-separated tokens like the validator", () => {
    assert.equal(wordCount("one two  three"), 3);
    assert.equal(wordCount("  padded  "), 1);
  });
});

describe("buildPrompt", () => {
  it("includes the bill facts the model may use", () => {
    const { system, user } = buildPrompt(bill, ["Education"], "Education and Labor");
    assert.match(system, /neutral/i);
    assert.match(system, /30 words/);
    assert.match(user, /H\.R\. 1262/);
    assert.match(user, /Mikaela Naylon Give Kids a Chance Act/);
    assert.match(user, /Education/);
  });
});

describe("validateDraft", () => {
  const good = {
    short_context: "Expands federal vouchers for low-income students to attend private schools.",
    binary_question: {
      question: "Should federal funds follow students to private schools?",
      options: [
        { stance: "support", label: "Yes, fund students" },
        { stance: "oppose", label: "No, fund public schools" },
      ],
    },
  };
  it("accepts a well-formed neutral draft", () => {
    assert.deepEqual(validateDraft(good), []);
  });
  it("rejects long context, unbalanced stances, and bad shapes", () => {
    assert.match(validateDraft({ ...good, short_context: Array(31).fill("word").join(" ") }).join(";"), /30 words/);
    const unbal = structuredClone(good);
    unbal.binary_question.options[1].stance = "support";
    assert.match(validateDraft(unbal).join(";"), /support.*oppose|oppose.*support/);
    const one = structuredClone(good);
    one.binary_question.options = [one.binary_question.options[0]];
    assert.ok(validateDraft(one).length > 0);
    assert.ok(validateDraft({}).length > 0);
    assert.ok(validateDraft(null).length > 0);
    assert.ok(validateDraft({ short_context: "Fine context here." }).length > 0);
  });
  it("accepts complex bills with longer context and no question", () => {
    assert.deepEqual(validateDraft({ complex_bill: true, short_context: Array(45).fill("word").join(" "), binary_question: null }), []);
  });
  it("rejects complex bills that break the complex rules", () => {
    assert.ok(validateDraft({ complex_bill: true, short_context: Array(55).fill("word").join(" "), binary_question: null }).length > 0);
    assert.match(
      validateDraft({ complex_bill: true, short_context: "Fine context here.", binary_question: good.binary_question }).join(";"),
      /must not carry/
    );
  });
});
