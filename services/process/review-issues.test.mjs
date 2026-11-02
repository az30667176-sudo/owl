// Focused tests for review-issues.mjs. Zero dependencies: node:test + node:assert only.
//   node --test services/process/review-issues.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reviewNewIssues } from "./review-issues.mjs";

const P = (id, name, parent) => ({ id, name, parent });

describe("reviewNewIssues", () => {
  it("merges subset duplicates, shortest id wins", () => {
    const r = reviewNewIssues([], [
      P("supplemental-nutrition-assistance-program-snap", "Supplemental Nutrition Assistance Program (SNAP)", "hsag-farm"),
      P("nutrition-assistance-snap", "Nutrition Assistance (SNAP)", "hsag-farm"),
    ]);
    assert.equal(r.create.length, 1);
    assert.equal(r.create[0].id, "nutrition-assistance-snap");
    assert.equal(r.remap.get("supplemental-nutrition-assistance-program-snap"), "nutrition-assistance-snap");
  });
  it("merges same-parent high-overlap pairs", () => {
    const r = reviewNewIssues([], [
      P("clean-energy-deployment", "Clean Energy Deployment", "hsif-energy"),
      P("clean-energy-development", "Clean Energy Development", "hsif-energy"),
    ]);
    assert.equal(r.create.length, 1);
  });
  it("keeps distinct facets and cross-parent pairs separate", () => {
    const r = reviewNewIssues([], [
      P("a", "College Athlete Compensation and Legal Protections", "hsed-higher"),
      P("b", "College Athletics Compensation Framework", "hsed-higher"),
      P("c", "Africa Trade and AGOA", "hswm-tax"),
      P("d", "Africa Trade and AGOA Reauthorization", "hsfa"),
    ]);
    assert.equal(r.create.length, 4);
    assert.equal(r.remap.size, 0);
  });
  it("never merges transitively through another proposal", () => {
    // bb resembles both aa and cc, but aa and cc do not resemble each other.
    const r = reviewNewIssues([], [
      P("aa", "Clean Energy Deployment", "hsif-energy"),
      P("bb", "Clean Energy Development", "hsif-energy"),
      P("cc", "Energy Development Bank", "hsif-energy"),
    ]);
    assert.deepEqual(r.create.map((c) => c.id).sort(), ["aa", "cc"]);
    assert.equal(r.remap.get("bb"), "aa");
  });
  it("maps proposals onto existing issues instead of duplicating", () => {
    const r = reviewNewIssues(
      [P("gun-policy", "Gun Policy", "hsju-crime")],
      [P("gun-policy-reform", "Gun Policy Reform", "hsju-crime")]
    );
    assert.equal(r.create.length, 0);
    assert.equal(r.remap.get("gun-policy-reform"), "gun-policy");
  });
  it("requires subset (not just Jaccard) to merge into a curated seed", () => {
    const r = reviewNewIssues(
      [P("higher-education-and-student-aid", "Higher Education and Student Aid", "hsed-higher")],
      [P("transgender-student-rights-in-higher-education", "Transgender Student Rights in Higher Education", "hsed-higher")]
    );
    assert.equal(r.create.length, 1);
    assert.equal(r.remap.size, 0);
  });
});
