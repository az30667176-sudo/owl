// Focused tests for csv-to-json.mjs. Zero dependencies: node:test + node:assert only.
//   node --test services/ingest/csv-to-json.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, shortCommitteeName, resolveQuote, resolveSubName } from "./csv-to-json.mjs";

describe("parseCsv", () => {
  it("handles multiline quoted fields, escaped quotes, CRLF", () => {
    const rows = parseCsv('a,b\r\n"line1\nline2","say ""hi"""\r\nx,y\r\n');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].a, "line1\nline2");
    assert.equal(rows[0].b, 'say "hi"');
    assert.equal(rows[1].a, "x");
  });
});

describe("shortCommitteeName", () => {
  it("strips the House prefix", () => {
    assert.equal(shortCommitteeName("House Committee on the Judiciary"), "Judiciary");
    assert.equal(shortCommitteeName("House Committee on Ways and Means"), "Ways and Means");
  });
  it("handles select committees and falls back to the full name", () => {
    assert.equal(
      shortCommitteeName("House Permanent Select Committee on Intelligence"),
      "Intelligence"
    );
    assert.equal(shortCommitteeName("Something Else"), "Something Else");
  });
});

describe("resolveSubName", () => {
  it("prefers the reference name, falls back to the slug", () => {
    const ref = new Map([["hsap-cjs", "Commerce, Justice, Science"]]);
    assert.equal(resolveSubName("hsap-cjs", ref), "Commerce, Justice, Science");
    assert.equal(resolveSubName("hsgo-doge", ref), "Doge");
    assert.equal(resolveSubName("hsgo-doge", null), "Doge");
  });
});

describe("resolveQuote", () => {
  const record = (content) => ({ content });
  const views = record(
    `<Rep. Brendan F. Boyle, Rep. Lloyd Doggett>: INTRODUCTION\nBody text here.\nBrendan F. Boyle\nLloyd Doggett`
  );
  const votes = record(`<other>: On the question.\nMr. Kelly: not voting\nMr. Neal: yea`);

  it("accepts a signer name found in the speaker tag", () => {
    assert.equal(resolveQuote(views, "Brendan F. Boyle"), "Brendan F. Boyle");
  });
  it("resolves not_voting to the record's own line", () => {
    assert.equal(resolveQuote(votes, "Mr. Kelly: not_voting"), "Mr. Kelly: not voting");
  });
  it("repairs backtick quotes to the record's straight quotes", () => {
    const r = record(`<Rep. Robert C. "Bobby" Scott>: text`);
    assert.equal(resolveQuote(r, "Robert C. ``Bobby'' Scott"), 'Robert C. "Bobby" Scott');
  });
  it("returns null when the line is absent or unusable", () => {
    assert.equal(resolveQuote(views, "Nobody Here"), null);
    assert.equal(resolveQuote(views, ""), null);
    assert.equal(resolveQuote(views, "x"), null);
    assert.equal(resolveQuote(views, "y".repeat(601)), null);
  });
});
