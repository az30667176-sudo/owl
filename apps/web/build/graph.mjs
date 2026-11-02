#!/usr/bin/env node
// Derived graph cache builder (explore-redesign, section 1).
//
// Usage: node apps/web/build/graph.mjs <dataDir> <outFile>
//
// Reads the contract-B files from <dataDir>, derives legislator-issue edges
// with the shared aggregation in ../lib/derive.mjs (the same numbers the
// browser computes today), and writes the compact graph.json cache:
//
//   { meta: { statements, maxDate, builtAt, contract: "B→C cache" },
//     committees: [{ id, name }],            // only committees that have issues, taxonomy order
//     issues: [[name, comIdx, id]],          // comIdx = committees.findIndex(...)
//     people: [[name, party, state, district, id]],
//     edges: [[pIdx, iIdx, score, heat, flip?1:0, n, kind]],
//     bills: [[iIdx, billString, statementCount]] }
//
// graph.json is a cache, never hand-edited, regenerated every deploy; it is
// not a contract file. Scoring rules: packages/contract/derived.md.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { deriveEdges } from "../lib/derive.mjs";

// Bill id: lower-case letters+digits of the leading bill number
// ("H.R. 6110 …" -> "hr6110"; null for null). Same rule as the app.
const billId = (s) => {
  if (s == null) return null;
  const m = /^\s*([A-Za-z.][A-Za-z.\s]*?\d+)/.exec(s);
  return m ? m[1].replace(/[^A-Za-z0-9]/g, "").toLowerCase() : null;
};

const read = (dir, f) => JSON.parse(readFileSync(join(dir, f), "utf8"));

const [dataDir, outFile] = process.argv.slice(2);
if (!dataDir || !outFile) {
  console.error("usage: node apps/web/build/graph.mjs <dataDir> <outFile>");
  process.exit(1);
}

const taxonomy = read(dataDir, "taxonomy.json");
const issuesRaw = read(dataDir, "issues.json");
const peopleRaw = read(dataDir, "people.json");
const stancesRaw = read(dataDir, "stances.json");
try {
  read(dataDir, "conditions.json");
} catch {
  console.warn("warning: conditions.json unreadable, continuing without it");
}

// Issue -> owning committee through taxonomy subcommittee ids: an issue's
// parent may be a committee id or a subcommittee id.
const committeeOf = (parent) => {
  const direct = taxonomy.committees.find((c) => c.id === parent);
  if (direct) return direct.id;
  const owner = taxonomy.committees.find((c) =>
    (c.subcommittees || []).some((s) => s.id === parent),
  );
  return owner ? owner.id : null;
};

const keptIssues = [];
for (const i of issuesRaw.issues) {
  const com = committeeOf(i.parent);
  if (!com) {
    console.warn("issue with unknown parent dropped:", i.id);
    continue;
  }
  keptIssues.push({ ...i, com });
}
// Only committees that have issues, in taxonomy order.
const committees = taxonomy.committees.filter((c) => keptIssues.some((i) => i.com === c.id));

const byPerson = new Map(peopleRaw.people.map((p) => [p.id, p]));
const byIssue = new Map(keptIssues.map((i) => [i.id, i]));

let dropped = 0;
const statements = stancesRaw.stances.filter((s) => {
  const ok = byPerson.has(s.person) && byIssue.has(s.issue);
  if (!ok) dropped += 1;
  return ok;
});
if (dropped) console.warn(`statements with unknown person/issue dropped: ${dropped}`);

// Mock data anchors salience decay at the newest statement date so the demo is
// stable; real data uses today. Same rule as the app.
const maxDate = statements
  .map((s) => s.date || "")
  .filter(Boolean)
  .sort()
  .pop();
const now = stancesRaw._meta?.mock && maxDate ? new Date(maxDate) : new Date();

const edges = deriveEdges(statements, { now });

const people = peopleRaw.people;
const issues = keptIssues;
const pIdx = new Map(people.map((p, k) => [p.id, k]));
const iIdx = new Map(issues.map((i, k) => [i.id, k]));

const outEdges = edges.map((e) => [
  pIdx.get(e.from),
  iIdx.get(e.to),
  e.score,
  e.heat,
  e.flip ? 1 : 0,
  e.n,
  e.kind,
]);

// Bills discovered from statement bill strings, grouped by normalized bill id;
// display string from the latest statement, issue by majority of statements.
const billGroups = new Map();
for (const s of statements) {
  if (!s.bill) continue;
  const id = billId(s.bill);
  if (!id) continue;
  if (!billGroups.has(id)) billGroups.set(id, []);
  billGroups.get(id).push(s);
}
const byDate = (a, b) => String(a.date || "").localeCompare(String(b.date || ""));
const outBills = [...billGroups.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, rows]) => {
    const sorted = rows.slice().sort(byDate);
    const latest = sorted[sorted.length - 1];
    const counts = new Map();
    for (const s of rows) counts.set(s.issue, (counts.get(s.issue) || 0) + 1);
    const issue = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return [iIdx.get(issue), latest.bill, rows.length];
  });

const graph = {
  meta: {
    statements: statements.length,
    maxDate: maxDate || null,
    builtAt: new Date().toISOString(),
    contract: "B→C cache",
  },
  committees: committees.map((c) => ({ id: c.id, name: c.name })),
  issues: issues.map((i) => [
    i.name,
    committees.findIndex((c) => c.id === i.com),
    i.id,
  ]),
  people: people.map((p) => [p.name, p.party, p.state, p.district, p.id]),
  edges: outEdges,
  bills: outBills,
};

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(graph));
console.log(
  `edges ${outEdges.length} · people ${people.length} · issues ${issues.length} · ` +
    `bills ${outBills.length} · statements ${statements.length} → ${outFile}`,
);
