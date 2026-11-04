// Focused tests for validate-csv.mjs. Zero dependencies: node:test + node:assert only.
//   node --test services/ingest/validate-csv.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { validateCsvDrop } from "./validate-csv.mjs";

// Minimal convertible drop: one person, one committee, one issue, one bill,
// one record, one sponsorship. Every fixture starts from a copy of this.
// Rows are built from arrays so columns cannot drift out of alignment.
const csv = (header, ...rows) => [header.join(","), ...rows.map((r) => r.join(","))].join("\n") + "\n";
const GOOD = {
  "people.csv": csv(
    ["bioguide_id", "name", "state", "district", "party", "gender", "since", "status", "left_date", "committee_codes"],
    ["A000001", "Ann Member", "VA", "1", "D", "F", "2020", "sitting", "", ""],
  ),
  "committees.csv": csv(
    ["committee_code", "committee_name", "web_taxonomy_id", "in_graph"],
    ["HSBA", "House Committee on the Budget", "hsba", "True"],
  ),
  "issues.csv": csv(
    ["issue_id", "name", "parent_subcommittee_id", "committee_id", "n_bills"],
    ["budget-taxes", "Budget and taxes", "hsba", "hsba", "1"],
  ),
  "bills.csv": csv(
    ["bill_id", "label", "title", "congress_url", "introduced_date", "policy_area", "legislative_subjects", "sponsor_bioguide", "sponsor_name", "reporting_committees", "committee_system_codes", "seed_issue_ids", "issue_mapping_method", "latest_action_date", "latest_action_text", "report_citations"],
    ["hr1-119", "H.R. 1", "A bill.", "https://www.congress.gov/bill/119th-congress/house-bill/1", "2025-01-03", "Taxation", "", "A000001", "Ann Member", "", "", "budget-taxes", "", "2025-01-03", "Introduced in House.", ""],
  ),
  "records.csv": csv(
    ["record_id", "kind", "views_type", "part", "parts", "report_citation", "date", "committee_code", "committee_name", "bill_id", "bill_label", "bill_title", "source_url", "parse_status", "n_votes", "n_quotable_vote_lines", "n_tokens_est", "n_persons", "person_bioguides", "bill_urls", "content"],
    ["rec1", "floor", "", "", "", "", "2025-01-03", "", "", "", "", "", "https://example.gov/rec1", "ok", "", "", "", "", "A000001", "", "<other>: some content here"],
  ),
  "evidence.csv": csv(
    ["evidence_id", "person_bioguide", "person_name", "party", "state", "district", "bill_id", "bill_label", "action", "vote", "vote_question", "views_type", "stance_toward_bill", "event_date", "committee_code", "committee_name", "source_report", "source_id", "record_id", "section_heading", "quote_line", "extraction_method", "confidence", "linkage", "source_url"],
    ["ev1", "A000001", "Ann Member", "D", "VA", "1", "hr1-119", "H.R. 1", "sponsored", "", "", "", "for", "2025-01-03", "", "", "", "", "", "", "", "rule", "", "high", ""],
  ),
};

function writeDrop(files) {
  const dir = mkdtempSync(join(tmpdir(), "owl-csv-"));
  const manifest = ["file,rows,bytes,sha256"];
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text);
    const buf = Buffer.from(text, "utf8");
    const rows = text.trim().split("\n").length - 1;
    manifest.push(`${name},${rows},${buf.length},${createHash("sha256").update(buf).digest("hex")}`);
  }
  writeFileSync(join(dir, "MANIFEST.csv"), manifest.join("\n") + "\n");
  return dir;
}

function check(files) {
  const dir = writeDrop(files);
  try {
    return validateCsvDrop(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const withFiles = (overrides, drop = []) => {
  const files = { ...GOOD, ...overrides };
  for (const d of drop) delete files[d];
  return files;
};

describe("validateCsvDrop fixtures", () => {
  it("accepts a minimal convertible drop", () => {
    const res = check(GOOD);
    assert.equal(res.ok, true);
    assert.deepEqual(res.errors, []);
  });

  it("errors on a missing file", () => {
    const res = check(withFiles({}, ["records.csv"]));
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.file === "records.csv" && /missing file/.test(e.message)));
  });

  it("errors on a missing column", () => {
    const bad = GOOD["people.csv"].replace("bioguide_id,", "person_id,");
    const res = check(withFiles({ "people.csv": bad }));
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.file === "people.csv" && e.col === "bioguide_id"));
  });

  it("errors on duplicate keys", () => {
    const dup = GOOD["bills.csv"] + GOOD["bills.csv"].split("\n")[1] + "\n";
    const res = check(withFiles({ "bills.csv": dup }));
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.file === "bills.csv" && /duplicate key hr1-119/.test(e.message)));
  });

  it("errors on malformed dates and urls", () => {
    const bad = GOOD["records.csv"].replace("2025-01-03", "01/03/2025").replace("https://example.gov/rec1", "not a url");
    const res = check(withFiles({ "records.csv": bad }));
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.col === "date"));
    assert.ok(res.errors.some((e) => e.col === "source_url"));
  });

  it("errors on unknown enum values", () => {
    const bad = GOOD["evidence.csv"].replace("sponsored,", "championed,");
    const res = check(withFiles({ "evidence.csv": bad }));
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.col === "action" && /unknown action championed/.test(e.message)));
  });

  it("errors on dangling cross-file references", () => {
    const bad = GOOD["evidence.csv"].replace("hr1-119,H.R. 1,sponsored", "hr9999-119,H.R. 9999,sponsored");
    const res = check(withFiles({ "evidence.csv": bad }));
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.col === "bill_id" && /unknown bill hr9999-119/.test(e.message)));
  });

  it("errors when MANIFEST does not match file bytes", () => {
    const dir = writeDrop(GOOD);
    try {
      writeFileSync(join(dir, "people.csv"), GOOD["people.csv"] + "X000001,Extra,VA,2,R,M,2021,sitting,,\n");
      const res = validateCsvDrop(dir);
      assert.equal(res.ok, false);
      assert.ok(res.errors.some((e) => e.file === "people.csv" && /sha256 mismatch/.test(e.message)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a committee_vote without a record or quote", () => {
    const row = ["ev2", "A000001", "Ann Member", "D", "VA", "1", "hr1-119", "H.R. 1", "committee_vote", "yea", "", "", "for", "2025-01-03", "", "", "", "", "rec-missing", "", "", "rule", "", "high", ""].join(",") + "\n";
    const bad = GOOD["evidence.csv"] + row;
    const res = check(withFiles({ "evidence.csv": bad }));
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.col === "record_id" && /unknown record rec-missing/.test(e.message)));
  });

  it("warns (not errors) on lossy-but-tolerated rows", () => {
    const badIssues = GOOD["issues.csv"] + "orphan,Orphan issue,,hsba,0\n";
    const res = check(withFiles({ "issues.csv": badIssues }));
    assert.equal(res.ok, true);
    assert.ok(res.warnings.some((w) => w.file === "issues.csv" && /empty parent/.test(w.message)));
  });
});

describe("validateCsvDrop real drop", () => {
  it("the committed drop converts with zero errors", () => {
    const res = validateCsvDrop(new URL("../../owl-ingest-csv-2026-10-30", import.meta.url).pathname);
    assert.equal(res.ok, true);
    assert.deepEqual(res.errors, []);
  });
});
