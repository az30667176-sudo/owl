#!/usr/bin/env node
// OWL ingest: producer-side source-data validation for a CSV drop.
//
//   node services/ingest/validate-csv.mjs <csv-dir> [--skip-manifest]
//
// Checks the six consumed CSVs (people/committees/issues/bills/records/
// evidence) for the structural problems that would crash csv-to-json.mjs or
// silently drop rows: missing files/columns, duplicate keys, malformed dates
// and URLs, unknown enum values, and dangling cross-file references. Exits 0
// when the drop is convertible, 1 otherwise. Reads only, never writes.
//
// The converter runs this first and refuses to convert a drop with errors,
// so producers can self-certify with the same gate before handing a drop off.

import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { parseCsv } from "./csv-to-json.mjs";

export const REQUIRED_FILES = [
  "people.csv", "committees.csv", "issues.csv",
  "bills.csv", "records.csv", "evidence.csv",
];

// Columns csv-to-json.mjs actually reads. A missing column crashes the
// converter (`.trim()` on undefined), so each one is an error.
export const REQUIRED_COLS = {
  "people.csv": ["bioguide_id", "name", "state", "district", "party", "gender", "since"],
  "committees.csv": ["committee_name", "web_taxonomy_id", "in_graph"],
  "issues.csv": ["issue_id", "name", "parent_subcommittee_id", "committee_id"],
  "bills.csv": ["bill_id", "label", "title", "congress_url", "introduced_date",
    "latest_action_date", "latest_action_text", "sponsor_bioguide", "seed_issue_ids"],
  "records.csv": ["record_id", "content", "date", "source_url", "parse_status",
    "person_bioguides", "bill_urls"],
  "evidence.csv": ["evidence_id", "person_bioguide", "person_name", "bill_id", "action",
    "vote", "vote_question", "views_type", "stance_toward_bill", "event_date",
    "committee_name", "linkage", "extraction_method", "record_id", "quote_line"],
};

const KEY_OF = {
  "people.csv": "bioguide_id", "issues.csv": "issue_id", "bills.csv": "bill_id",
  "records.csv": "record_id", "evidence.csv": "evidence_id",
};

const ACTIONS = new Set(["sponsored", "cosponsored", "committee_vote", "signed_views", "offered_amendment"]);
const VOTES = new Set(["yea", "nay", "present", "not_voting"]);
const STANCES = new Set(["for", "against", "neutral", "unknown"]);
const LINKAGES = new Set(["low", "mid", "high", "super_high"]);
const PARTIES = new Set(["D", "R", "I"]);

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !Number.isNaN(Date.parse(s));
const isUri = (s) => { try { new URL(s); return true; } catch { return false; } };
const splitPipe = (s) => (s || "").split("|").map((x) => x.trim()).filter(Boolean);

const MAX_STORED = 200;

export function validateCsvDrop(csvDir, opts = {}) {
  const errors = [], warnings = [];
  let errorTotal = 0, warningTotal = 0;
  const err = (file, row, col, message) => {
    errorTotal++;
    if (errors.length < MAX_STORED) errors.push({ file, row, col, message });
  };
  const warn = (file, row, col, message) => {
    warningTotal++;
    if (warnings.length < MAX_STORED) warnings.push({ file, row, col, message });
  };
  // row = 1-based data-row index; csvLine = physical line incl. header.
  const csvLine = (i) => i + 2;

  const tables = {};
  for (const f of REQUIRED_FILES) {
    const p = join(csvDir, f);
    if (!existsSync(p)) { err(f, 0, "", "missing file"); continue; }
    let rows;
    try {
      rows = parseCsv(readFileSync(p, "utf8"));
    } catch (e) {
      err(f, 0, "", `unparseable: ${e.message}`);
      continue;
    }
    const cols = new Set(Object.keys(rows[0] || {}));
    // Empty file (header only or blank): still check the header.
    if (!rows.length) {
      const headerLine = (readFileSync(p, "utf8").split("\n")[0] || "").split(",");
      for (const h of headerLine) cols.add(h.trim());
    }
    for (const c of REQUIRED_COLS[f]) {
      if (!cols.has(c)) err(f, 0, c, "missing column");
    }
    tables[f] = rows;
  }

  // MANIFEST.csv: integrity of every listed file (rows = parsed data rows,
  // bytes = exact file size). Absent manifest is tolerated with a warning.
  const manifestPath = join(csvDir, "MANIFEST.csv");
  if (!existsSync(manifestPath)) {
    warn("MANIFEST.csv", 0, "", "missing; integrity not verified");
  } else if (!opts.skipManifest) {
    const manifest = parseCsv(readFileSync(manifestPath, "utf8"));
    for (const m of manifest) {
      if (m.file === "MANIFEST.csv" || !m.file) continue;
      const p = join(csvDir, m.file);
      if (!existsSync(p)) { err("MANIFEST.csv", 0, m.file, "listed file missing"); continue; }
      const buf = readFileSync(p);
      const hash = createHash("sha256").update(buf).digest("hex");
      if (hash !== m.sha256) err(m.file, 0, "", "MANIFEST sha256 mismatch");
      if ((m.bytes || "").trim() && String(buf.length) !== m.bytes.trim()) {
        err(m.file, 0, "", `MANIFEST bytes ${m.bytes.trim()} != actual ${buf.length}`);
      }
      if ((m.rows || "").trim() && m.file.endsWith(".csv")) {
        const n = parseCsv(buf.toString("utf8")).length;
        if (String(n) !== m.rows.trim()) err(m.file, 0, "", `MANIFEST rows ${m.rows.trim()} != actual ${n}`);
      }
    }
  }

  const people = tables["people.csv"] || [], committees = tables["committees.csv"] || [];
  const issues = tables["issues.csv"] || [], bills = tables["bills.csv"] || [];
  const records = tables["records.csv"] || [], evidence = tables["evidence.csv"] || [];

  // Duplicate + empty keys.
  const seenKey = new Map();
  for (const [f, rows] of [["people.csv", people], ["issues.csv", issues], ["bills.csv", bills], ["records.csv", records], ["evidence.csv", evidence]]) {
    const k = KEY_OF[f];
    if (!rows.length || !(k in (rows[0] || {}))) continue; // missing column already reported
    for (let i = 0; i < rows.length; i++) {
      const v = (rows[i][k] || "").trim();
      if (!v) { err(f, csvLine(i), k, "empty key cell"); continue; }
      const jk = `${f}\u0001${v}`;
      if (seenKey.has(jk)) err(f, csvLine(i), k, `duplicate key ${v} (first at line ${seenKey.get(jk)})`);
      else seenKey.set(jk, csvLine(i));
    }
  }
  // Committee taxonomy ids feed the taxonomy keyed by id.
  const seenComm = new Map();
  if (committees.length && "web_taxonomy_id" in committees[0]) {
    for (let i = 0; i < committees.length; i++) {
      const v = (committees[i].web_taxonomy_id || "").trim().toLowerCase();
      if (!v) continue; // flagged below as a format warning
      if (seenComm.has(v)) err("committees.csv", csvLine(i), "web_taxonomy_id", `duplicate id ${v} (first at line ${seenComm.get(v)})`);
      else seenComm.set(v, csvLine(i));
    }
  }

  const personIds = new Set(people.map((p) => (p.bioguide_id || "").trim()).filter(Boolean));
  const issueIds = new Set(issues.map((x) => (x.issue_id || "").trim()).filter(Boolean));
  const billIds = new Set(bills.map((b) => (b.bill_id || "").trim()).filter(Boolean));
  const recordIds = new Set(records.map((r) => (r.record_id || "").trim()).filter(Boolean));
  const committeeIds = new Set(committees.map((c) => (c.web_taxonomy_id || "").trim().toLowerCase()).filter(Boolean));

  // people.csv
  for (let i = 0; i < people.length; i++) {
    const p = people[i], L = csvLine(i);
    if ((p.party || "").trim() && !PARTIES.has(p.party.trim())) err("people.csv", L, "party", `unknown party ${p.party.trim()}`);
    if ((p.state || "").trim() && !/^[A-Z]{2}$/.test(p.state.trim())) warn("people.csv", L, "state", `unexpected state ${p.state.trim()}`);
    if ((p.since || "").trim() && !/^\d{4}$/.test(p.since.trim())) err("people.csv", L, "since", `not a year: ${p.since.trim()}`);
  }

  // committees.csv
  for (let i = 0; i < committees.length; i++) {
    const c = committees[i], L = csvLine(i);
    const id = (c.web_taxonomy_id || "").trim().toLowerCase();
    // Select committees (e.g. HLIG) legitimately fall outside ^hs[a-z]{2}$ and
    // are skipped by the converter — warning, not error.
    if (!/^hs[a-z]{2}$/.test(id)) warn("committees.csv", L, "web_taxonomy_id", `id ${id || "(empty)"} outside the House taxonomy; committee skipped`);
    if ((c.in_graph || "").trim() && !["True", "False"].includes(c.in_graph.trim())) {
      err("committees.csv", L, "in_graph", `must be True/False, got ${c.in_graph.trim()}`);
    }
    if (!(c.committee_name || "").trim()) err("committees.csv", L, "committee_name", "empty committee name");
  }

  // issues.csv
  for (let i = 0; i < issues.length; i++) {
    const x = issues[i], L = csvLine(i);
    if (!(x.name || "").trim()) err("issues.csv", L, "name", "empty issue name");
    const parent = (x.parent_subcommittee_id || "").trim();
    const comm = (x.committee_id || "").trim().toLowerCase();
    if (!parent) warn("issues.csv", L, "parent_subcommittee_id", "empty parent; issue skipped by converter");
    else if (!parent.startsWith(comm + "-") && parent !== comm) {
      warn("issues.csv", L, "parent_subcommittee_id", `parent ${parent} not under committee ${comm || "(empty)"}; issue skipped by converter`);
    }
    if (comm && !committeeIds.has(comm)) warn("issues.csv", L, "committee_id", `unknown committee ${comm}; issue skipped by converter`);
  }

  // bills.csv
  for (let i = 0; i < bills.length; i++) {
    const b = bills[i], L = csvLine(i);
    if (!(b.label || "").trim()) err("bills.csv", L, "label", "empty bill number; row skipped by converter");
    // Synthetic BILLSTATUS records take congress_url verbatim as their source
    // url, so a bad one corrupts contract-A output.
    if (!isUri((b.congress_url || "").trim())) err("bills.csv", L, "congress_url", "not a URL");
    for (const d of ["introduced_date", "latest_action_date"]) {
      if ((b[d] || "").trim() && !isDate(b[d].trim())) err("bills.csv", L, d, `not a YYYY-MM-DD date: ${b[d].trim()}`);
    }
    for (const id of splitPipe(b.seed_issue_ids)) {
      if (!issueIds.has(id)) err("bills.csv", L, "seed_issue_ids", `unknown issue ${id}`);
    }
    const sp = (b.sponsor_bioguide || "").trim();
    if (sp && !personIds.has(sp)) err("bills.csv", L, "sponsor_bioguide", `unknown person ${sp}`);
    // #35: optional producer columns, validated only when present.
    if ("status" in b && (b.status || "").trim() &&
      !["introduced", "committee", "passed_house", "passed_senate", "enacted", "failed"].includes(b.status.trim())) {
      err("bills.csv", L, "status", `unknown status ${b.status.trim()}`);
    }
  }

  // records.csv
  for (let i = 0; i < records.length; i++) {
    const r = records[i], L = csvLine(i);
    if (!(r.content || "").trim()) err("records.csv", L, "content", "empty content");
    if (!isDate((r.date || "").trim())) err("records.csv", L, "date", `not a YYYY-MM-DD date: ${(r.date || "").trim() || "(empty)"}`);
    if (!isUri((r.source_url || "").trim())) err("records.csv", L, "source_url", "not a URL");
    for (const id of splitPipe(r.person_bioguides)) {
      if (!personIds.has(id)) err("records.csv", L, "person_bioguides", `unknown person ${id}`);
    }
    if ("bill_id" in r && (r.bill_id || "").trim() && !billIds.has(r.bill_id.trim())) {
      err("records.csv", L, "bill_id", `unknown bill ${r.bill_id.trim()}`);
    }
    for (const u of splitPipe(r.bill_urls)) {
      if (!isUri(u)) warn("records.csv", L, "bill_urls", `not a URL, dropped by converter: ${u}`);
    }
  }

  // evidence.csv
  for (let i = 0; i < evidence.length; i++) {
    const e = evidence[i], L = csvLine(i);
    const action = (e.action || "").trim();
    if (!ACTIONS.has(action)) { err("evidence.csv", L, "action", `unknown action ${action || "(empty)"}; row skipped by converter`); continue; }
    if (!personIds.has((e.person_bioguide || "").trim())) {
      err("evidence.csv", L, "person_bioguide", `unknown person ${(e.person_bioguide || "").trim() || "(empty)"}; row skipped by converter`);
    }
    if (!billIds.has((e.bill_id || "").trim())) {
      err("evidence.csv", L, "bill_id", `unknown bill ${(e.bill_id || "").trim() || "(empty)"}; row skipped by converter`);
    }
    const vote = (e.vote || "").trim();
    if (action === "committee_vote") {
      if (!VOTES.has(vote)) err("evidence.csv", L, "vote", `vote must be one of yea/nay/present/not_voting, got ${vote || "(empty)"}`);
      if (!recordIds.has((e.record_id || "").trim())) {
        err("evidence.csv", L, "record_id", `unknown record ${(e.record_id || "").trim() || "(empty)"}; row skipped by converter`);
      }
      if (["yea", "nay", "present"].includes(vote) && !(e.quote_line || "").trim()) {
        err("evidence.csv", L, "quote_line", "empty quote_line on a cast vote; row skipped by converter");
      }
    } else if (vote) {
      warn("evidence.csv", L, "vote", `vote ${vote} on a non-vote action; ignored by converter`);
    }
    const stance = (e.stance_toward_bill || "").trim();
    if (!stance) warn("evidence.csv", L, "stance_toward_bill", "empty stance; scored neutral by converter");
    else if (!STANCES.has(stance)) err("evidence.csv", L, "stance_toward_bill", `unknown stance ${stance}`);
    if (action === "sponsored" || action === "cosponsored") {
      if (!isDate((e.event_date || "").trim())) {
        err("evidence.csv", L, "event_date", `not a YYYY-MM-DD date: ${(e.event_date || "").trim() || "(empty)"}; row skipped by converter`);
      }
      if (!(e.person_name || "").trim()) err("evidence.csv", L, "person_name", "empty sponsor name");
    } else if ((e.event_date || "").trim() && !isDate(e.event_date.trim())) {
      warn("evidence.csv", L, "event_date", `not a YYYY-MM-DD date: ${e.event_date.trim()}; ignored by converter`);
    }
    const linkage = (e.linkage || "").trim();
    if (!linkage) warn("evidence.csv", L, "linkage", "empty linkage; defaulted to high by converter");
    else if (!LINKAGES.has(linkage)) err("evidence.csv", L, "linkage", `unknown linkage ${linkage}`);
    if ("vote_kind" in e && (e.vote_kind || "").trim() &&
      !["final_passage", "amendment", "procedural", "unknown"].includes(e.vote_kind.trim())) {
      err("evidence.csv", L, "vote_kind", `unknown vote_kind ${e.vote_kind.trim()}`);
    }
  }

  return {
    ok: errorTotal === 0,
    errors, warnings,
    counts: {
      files: REQUIRED_FILES.length, rows: people.length + committees.length + issues.length + bills.length + records.length + evidence.length,
      errorTotal, warningTotal,
      truncated: errors.length < errorTotal || warnings.length < warningTotal,
    },
  };
}

export function formatCsvReport(res) {
  const L = [];
  const loc = (p) => `${p.file}${p.row ? `:${p.row}` : ""}${p.col ? ` [${p.col}]` : ""}`;
  for (const p of res.errors) L.push(`error  ${loc(p)}: ${p.message}`);
  for (const p of res.warnings) L.push(`warn   ${loc(p)}: ${p.message}`);
  L.push(`checked ${res.counts.rows} rows in ${res.counts.files} files: ${res.counts.errorTotal} error(s), ${res.counts.warningTotal} warning(s)` +
    (res.counts.truncated ? ` (showing first ${MAX_STORED})` : ""));
  L.push(res.ok ? "CSV-OK" : "CSV-INVALID");
  return L.join("\n");
}

// ---------- CLI ----------
const isMain = process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const args = process.argv.slice(2).filter((a) => a !== "--skip-manifest");
  const csvDir = args.find((a) => !a.startsWith("--"));
  if (!csvDir || args.includes("--help") || args.includes("-h")) {
    console.error("usage: validate-csv.mjs <csv-dir> [--skip-manifest]");
    process.exit(2);
  }
  const res = validateCsvDrop(resolve(csvDir), { skipManifest: process.argv.includes("--skip-manifest") });
  console.log(formatCsvReport(res));
  process.exit(res.ok ? 0 : 1);
}
