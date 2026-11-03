// Contract tests for the bill match attributes (#32). Zero dependencies:
// node:test + node:assert + child_process only.
//   node --test packages/contract/validate.test.mjs
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "owl-contract-"));
  const write = (f, o) => writeFileSync(join(dir, f), JSON.stringify(o));
  write("taxonomy.json", { committees: [{ id: "hsag", name: "Agriculture", subcommittees: [] }] });
  write("issues.json", { issues: [{ id: "farm-subsidies", name: "Farm Subsidies", parent: "hsag" }] });
  write("people.json", { people: [{ id: "A000001", bioguide_id: "A000001", name: "Rep. Test", chamber: "house", state: "TX", district: "TX-1", party: "D", gender: "F", since: 2020 }] });
  write("stances.json", { stances: [] });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const billsFile = (bills) => writeFileSync(join(dir, "bills.json"), JSON.stringify({ bills }));
const goodBill = () => ({
  bill_id: "hr1-119",
  number: "H.R. 1",
  short_context: "Expands federal vouchers for low-income students to attend private schools.",
  binary_question: {
    question: "Should federal funds follow students to private schools?",
    options: [
      { stance: "support", label: "Yes, fund students" },
      { stance: "oppose", label: "No, fund public schools" },
    ],
  },
});
const validate = () => {
  try {
    const out = execFileSync("node", [join(HERE, "validate.mjs"), dir], { encoding: "utf8" });
    return { status: 0, out };
  } catch (e) {
    return { status: e.status, out: String(e.stdout || "") };
  }
};

describe("bill match attributes", () => {
  it("accepts a bill with short context and a balanced binary question", () => {
    billsFile([goodBill()]);
    const r = validate();
    assert.equal(r.status, 0);
    assert.match(r.out, /OK/);
  });
  it("accepts bills without the new fields (backward compatible)", () => {
    billsFile([{ bill_id: "hr1-119", number: "H.R. 1" }]);
    assert.equal(validate().status, 0);
  });
  it("rejects a short context over 30 words", () => {
    const b = goodBill();
    b.short_context = Array(31).fill("word").join(" ");
    billsFile([b]);
    const r = validate();
    assert.equal(r.status, 1);
    assert.match(r.out, /30 words/);
  });
  it("rejects unbalanced binary options", () => {
    const b = goodBill();
    b.binary_question.options[1].stance = "support";
    billsFile([b]);
    const r = validate();
    assert.equal(r.status, 1);
    assert.match(r.out, /support.*oppose|oppose.*support/);
  });
  it("rejects a question without exactly two options", () => {
    const b = goodBill();
    b.binary_question.options = [{ stance: "support", label: "Yes" }];
    billsFile([b]);
    assert.equal(validate().status, 1);
  });
  it("accepts complex bills with longer context and no question", () => {
    billsFile([{ bill_id: "hr1-119", number: "H.R. 1", complex_bill: true, short_context: Array(45).fill("word").join(" ") }]);
    assert.equal(validate().status, 0);
  });
  it("rejects complex bills that break the complex rules", () => {
    billsFile([{ bill_id: "hr1-119", number: "H.R. 1", complex_bill: true, short_context: Array(55).fill("word").join(" ") }]);
    assert.equal(validate().status, 1);
    const b = goodBill();
    b.complex_bill = true;
    billsFile([b]);
    const r = validate();
    assert.equal(r.status, 1);
    assert.match(r.out, /must not carry/);
  });
});
