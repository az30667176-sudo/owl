// Focused tests for csv-to-json.mjs. Zero dependencies: node:test + node:assert only.
//   node --test services/ingest/csv-to-json.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, shortCommitteeName, resolveQuote, resolveSubName, kindOfAction, classifyVoteQuestion, classifyBillStatus, buildBillRecord, voteQuestionOf } from "./csv-to-json.mjs";

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

describe("kindOfAction", () => {
  it("maps evidence actions to statement kinds", () => {
    assert.equal(kindOfAction("sponsored"), "sponsored");
    assert.equal(kindOfAction("cosponsored"), "cosponsored");
    assert.equal(kindOfAction("committee_vote"), "vote");
    assert.equal(kindOfAction("signed_views"), "views");
    assert.equal(kindOfAction("offered_amendment"), null);
  });
});

describe("classifyVoteQuestion", () => {
  it("recognises final passage", () => {
    assert.equal(classifyVoteQuestion("final passage, as amended"), "final_passage");
    assert.equal(classifyVoteQuestion("Final passage: H.R. 9497, as amended"), "final_passage");
    assert.equal(classifyVoteQuestion("H.R. 1155 was ordered favorably reported to the House as amended by a roll call vote of 41 yeas to 0 nays"), "final_passage");
    assert.equal(classifyVoteQuestion("On Motion to Report the Bill Favorably to the House as Amended."), "final_passage");
  });
  it("recognises amendments", () => {
    assert.equal(classifyVoteQuestion("No. 327, offered by Mr. Perry"), "amendment");
    assert.equal(classifyVoteQuestion("No. 061, amdt to ANS offered by Mr. Carbajal"), "amendment");
    assert.equal(classifyVoteQuestion("052, an amdt to the ANS offered by Mr. Figures"), "amendment");
    assert.equal(classifyVoteQuestion("On Jacobs Log 5225r1--Requires the establishment of human rights offices."), "amendment");
  });
  it("recognises procedural votes", () => {
    assert.equal(classifyVoteQuestion("The vote on Mr. Buchanan's motion to table Ms. Moore's (WI) appeal of the ruling of the chair was agreed to"), "procedural");
  });
  it("returns null for boilerplate and unknown questions instead of guessing", () => {
    assert.equal(classifyVoteQuestion("In compliance with the Rules of the House of Representatives, the following statement is made concerning the vote"), null);
    assert.equal(classifyVoteQuestion("Pursuant to clause 3(b) of rule XIII of the Rules of the House of Representatives"), null);
    assert.equal(classifyVoteQuestion(""), null);
    assert.equal(classifyVoteQuestion(null), null);
  });
});

describe("classifyBillStatus", () => {
  it("recognises terminal and passage signals", () => {
    assert.equal(classifyBillStatus("Signed by President.", "H.R. 1"), "enacted");
    assert.equal(classifyBillStatus("Became Public Law No: 119-12.", "H.R. 1"), "enacted");
    assert.equal(classifyBillStatus("Passed Senate with an amendment.", "H.R. 1"), "passed_senate");
    assert.equal(classifyBillStatus("Passed House.", "H.R. 1"), "passed_house");
  });
  it("treats a House bill received in the Senate as passed_house", () => {
    assert.equal(classifyBillStatus("Received in the Senate and Read twice and referred to the Committee on Finance.", "H.R. 1"), "passed_house");
    assert.equal(classifyBillStatus("Received in the Senate.", "H.R. 1"), "passed_house");
    assert.equal(classifyBillStatus("Read twice. Placed on Senate Legislative Calendar under General Orders. Calendar No. 468.", "H.R. 1"), "passed_house");
  });
  it("recognises failure, committee activity, and introduction", () => {
    assert.equal(classifyBillStatus("On motion to suspend the rules and pass the resolution Failed by the Yeas and Nays: 212 - 206.", "H.R. 1"), "failed");
    assert.equal(classifyBillStatus("Referred to the House Committee on Ways and Means.", "H.R. 1"), "committee");
    assert.equal(classifyBillStatus("Committee on Energy and Natural Resources. Hearings held.", "H.R. 1"), "committee");
    assert.equal(classifyBillStatus("Introduced in House.", "H.R. 1"), "introduced");
  });
  it("returns null for ambiguous actions instead of guessing", () => {
    assert.equal(classifyBillStatus("Motion to reconsider laid on the table Agreed to without objection.", "H.R. 1"), null);
    assert.equal(classifyBillStatus("Message on Senate action sent to the House.", "H.R. 1"), null);
    assert.equal(classifyBillStatus("", "H.R. 1"), null);
  });
});

describe("buildBillRecord", () => {
  const row = {
    bill_id: "hr1382-119", label: "H.R. 1382", title: "A bill to do things.",
    congress_url: "https://www.congress.gov/bill/119th-congress/house-bill/1382",
    introduced_date: "2025-02-25", sponsor_bioguide: "A000375",
    seed_issue_ids: "good-issue|bad-issue",
    latest_action_date: "2025-03-04", latest_action_text: "Passed House.",
  };
  it("builds the contract record, filtering unknown issues", () => {
    assert.deepEqual(buildBillRecord(row, new Set(["good-issue"])), {
      bill_id: "hr1382-119",
      number: "H.R. 1382",
      congress: 119,
      title: "A bill to do things.",
      status: "passed_house",
      introduced_date: "2025-02-25",
      last_action: { date: "2025-03-04", text: "Passed House." },
      sponsor_id: "A000375",
      issue_ids: ["good-issue"],
      url: "https://www.congress.gov/bill/119th-congress/house-bill/1382",
    });
  });
  it("omits status and url when unrecognised or invalid", () => {
    const r = buildBillRecord({ ...row, latest_action_text: "Motion to reconsider laid on the table.", congress_url: "not a url" }, new Set());
    assert.ok(!("status" in r));
    assert.ok(!("url" in r));
    assert.deepEqual(r.issue_ids, []);
  });
  it("prefers the producer status column when valid, else classifies (#35)", () => {
    assert.equal(buildBillRecord({ ...row, status: "enacted" }, new Set(["good-issue"])).status, "enacted");
    assert.equal(buildBillRecord({ ...row, status: "bogus" }, new Set(["good-issue"])).status, "passed_house");
  });
});

describe("voteQuestionOf", () => {
  it("treats ordered adversely reported as final passage", () => {
    assert.equal(classifyVoteQuestion("H.R. 1 was ordered adversely reported to the House"), "final_passage");
    assert.equal(voteQuestionOf({ vote_question: "H.R. 1 was ordered adversely reported to the House" }), "final_passage");
  });
  it("prefers the producer vote_kind column when valid, else classifies (#35)", () => {
    assert.equal(voteQuestionOf({ vote_kind: "amendment", vote_question: "final passage" }), "amendment");
    assert.equal(voteQuestionOf({ vote_kind: "unknown", vote_question: "final passage" }), "final_passage");
    assert.equal(voteQuestionOf({ vote_kind: "bogus", vote_question: "final passage" }), "final_passage");
    assert.equal(voteQuestionOf({ vote_question: "final passage" }), "final_passage");
  });
});
