#!/usr/bin/env node
// OWL ingest: CSV drop -> contract-A records + contract-B data files.
//
//   node services/ingest/csv-to-json.mjs <csv-dir> <out-dir> [--records <dir>] [--drop <label>] [--sub-names <taxonomy.json>] [--skip-manifest]
//
// Input:  an owl-ingest-csv-* drop (records/people/bills/issues/evidence/...csv + MANIFEST.csv).
// Output: <out-dir>/{taxonomy,issues,people,stances,bills}.json and <records dir>/*.json
//         (records dir defaults to <out-dir>/records).
// summaries.json and conditions.json are LLM-owned and intentionally not emitted;
// the frontend treats their absence as "not generated yet".
//
// Deterministic, zero dependencies (Node >= 18). Same input -> same bytes out.
//
// Mapping (see services/ingest/README.md for rationale):
//   people.csv  -> people.json      (id = bioguide)
//   committees.csv + issues.csv parents -> taxonomy.json (subcommittee names from
//     --sub-names <reference taxonomy.json> when given, else provisional
//     title-cased slugs; the CSV itself has no names)
//   issues.csv  -> issues.json
//   records.csv -> one contract-A record JSON per row
//   evidence.csv -> stances.json, one row per fact on the bill's primary issue:
//     sponsored/cosponsored -> +/-1.0/0.8, kind sponsored/cosponsored, anchored to
//                                synthetic per-(bill,date) BILLSTATUS transcription
//                                records (rec-billstatus-*)
//     committee_vote yea/nay   -> +/-0.8, kind vote, vote_question when recognised,
//                                quote = the record's own vote line
//     committee_vote present   -> 0.0 neutral, kind vote
//     committee_vote not_voting -> skipped (absence is not a stance)
//     signed_views             -> skipped (tracks party membership, not opposition)
//     offered_amendment        -> skipped (no exported record to anchor a quote)
//   Rows whose bill has no seed issues, whose quote line is not found in the
//   record, or that duplicate an identical statement are skipped and reported.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { createHash } from "node:crypto";

// ---------- tiny RFC 4180 parser (handles quoted fields with newlines) ----------
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false, i = 0;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { rows.push(row); row = []; };
  // Strip BOM; normalise CRLF/CR.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; }
        else { quoted = false; i++; }
      } else { field += c; i++; }
    } else if (c === '"') { quoted = true; i++; }
    else if (c === ",") { pushField(); i++; }
    else if (c === "\n") { pushField(); pushRow(); i++; }
    else { field += c; i++; }
  }
  pushField();
  if (row.length > 1 || row[0] !== "") pushRow();
  const header = rows.shift() || [];
  return rows.map((r) => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ""])));
}

// ---------- normalisation ----------
// Validator's verbatim norm (must match validate.mjs exactly).
export const normStrict = (s) =>
  s.normalize("NFKC").replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
// Tolerant norm for FINDING the record line behind a quote_line:
// evidence uses not_voting (record: "not voting") and ``...'' (record: "...").
const normLoose = (s) =>
  s.normalize("NFKC").replace(/[`‘’‚]/g, "'").replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-").replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

const dirOf = (s) => (s > 0.15 ? "support" : s < -0.15 ? "oppose" : "neutral");
const splitPipe = (s) => (s || "").split("|").map((x) => x.trim()).filter(Boolean);
const isUri = (s) => { try { new URL(s); return true; } catch { return false; } };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !Number.isNaN(Date.parse(s));
const CONF_DOWN = { high: "mid", mid: "low", low: "low", super_high: "high" };

// "House Committee on the Judiciary" -> "Judiciary". Falls back to full name.
export function shortCommitteeName(full) {
  const m = /^House\s+(?:Permanent\s+Select\s+|Select\s+)?(?:Committee|Subcommittee)\s+on\s+(?:the\s+)?(.+)$/i.exec((full || "").trim());
  const s = (m ? m[1] : full || "").trim();
  return s || full;
}

// "hsba-natsec" -> "Natsec" (provisional: the CSV carries no subcommittee names).
export const subNameFromId = (id) =>
  id.split("-").slice(1).join(" ").replace(/\b\w/g, (c) => c.toUpperCase()) || id;
// Real name from a reference taxonomy (e.g. the previously committed one),
// falling back to the provisional slug-derived name.
export function resolveSubName(id, refMap) {
  return (refMap && refMap.get(id)) || subNameFromId(id);
}

const SCORE = { sponsored: 1.0, cosponsored: 0.8, committee_vote: 0.8 };

// Evidence action -> contract-B statement kind (#25). Conceptual mapping; whether
// the action currently emits a row is decided in the loop (signed_views is skipped, #26).
export function kindOfAction(action) {
  return { sponsored: "sponsored", cosponsored: "cosponsored", committee_vote: "vote", signed_views: "views" }[action] || null;
}

// Vote question -> final_passage | amendment | procedural, or null when the question
// is report boilerplate ("In compliance with the Rules...") or otherwise unrecognised.
// Null means "omit the field, never guess" (#25).
export function classifyVoteQuestion(q) {
  const t = (q || "").trim();
  if (!t) return null;
  if (/final passage/i.test(t)) return "final_passage";
  if (/ordered favorably reported|motion to report .* favorably/i.test(t)) return "final_passage";
  if (/\bamdt\b|amendment|offered by/i.test(t)) return "amendment";
  if (/^no\.\s*\d/i.test(t)) return "amendment";
  if (/^on [a-z][a-z'. -]* log \d/i.test(t)) return "amendment";
  if (/motion to table|appeal of the ruling|point of order/i.test(t)) return "procedural";
  return null;
}

// Latest action text -> bill status, or null when the action is ambiguous.
// Conservative by design: only high-confidence signals map; a missing status
// (field omitted) beats a wrong one (#28).
export function classifyBillStatus(actionText, label) {
  const t = (actionText || "").trim();
  if (!t) return null;
  const house = !/^\s*s\.?\s/i.test((label || "").trim());
  if (/signed by (the )?president|became public law|became private law/i.test(t)) return "enacted";
  if (/passed senate|agreed to in (the )?senate/i.test(t)) return "passed_senate";
  if (/passed (the )?house|agreed to in (the )?house/i.test(t)) return "passed_house";
  if (house && /received in the senate|placed on senate legislative calendar/i.test(t)) return "passed_house";
  if (!house && /received in the house/i.test(t)) return "passed_senate";
  if (/failed by the yeas and nays|failed of passage/i.test(t)) return "failed";
  if (/referred to|hearings held|ordered to be reported|markup|subcommittee/i.test(t)) return "committee";
  if (/introduced in/i.test(t)) return "introduced";
  return null;
}

// One bills.csv row -> contract-B bill record (#28). Unknown seed issues are
// dropped; unrecognised status / bad dates / bad urls are omitted, never guessed.
export function buildBillRecord(b, issueIds) {
  const rec = { bill_id: (b.bill_id || "").trim(), number: (b.label || "").trim() };
  const congress = /-(\d+)$/.exec(rec.bill_id)?.[1];
  if (congress) rec.congress = parseInt(congress, 10);
  if ((b.title || "").trim()) rec.title = b.title.trim();
  const status = classifyBillStatus(b.latest_action_text, rec.number);
  if (status) rec.status = status;
  if (isDate((b.introduced_date || "").trim())) rec.introduced_date = b.introduced_date.trim();
  const lastDate = (b.latest_action_date || "").trim(), lastText = (b.latest_action_text || "").trim().replace(/\s+/g, " ");
  if (isDate(lastDate) && lastText) rec.last_action = { date: lastDate, text: lastText };
  if ((b.sponsor_bioguide || "").trim()) rec.sponsor_id = b.sponsor_bioguide.trim();
  rec.issue_ids = splitPipe(b.seed_issue_ids).filter((id) => issueIds.has(id));
  if (isUri((b.congress_url || "").trim())) rec.url = b.congress_url.trim();
  return rec;
}

// Resolve an evidence quote_line to the verbatim quote to store, or null.
// Tries, in order: the line as-is (signer names are substrings of the speaker
// tag), the line with ``...'' repaired to straight quotes (an ingest artifact),
// then the record's own line under tolerant matching (not_voting vs "not voting").
// Every candidate must pass the validator's verbatim check.
export function buildLineIndex(content) {
  const m = new Map();
  for (const line of content.split("\n")) {
    const k = normLoose(line);
    if (k && !m.has(k)) m.set(k, line.trim());
  }
  return m;
}
export function resolveQuote(record, quoteLine) {
  const verbatim = (q) =>
    q && q.length >= 2 && q.length <= 600 &&
    normStrict(record.content).includes(normStrict(q));
  const raw = (quoteLine || "").trim();
  if (verbatim(raw)) return raw;
  const debackticked = raw.replace(/``/g, '"').replace(/''/g, '"');
  if (debackticked !== raw && verbatim(debackticked)) return debackticked;
  if (!record.lineIndex) record.lineIndex = buildLineIndex(record.content);
  const line = record.lineIndex.get(normLoose(raw));
  if (verbatim(line)) return line;
  return null;
}

// ---------- main conversion ----------
export function convertCsvDrop(csvDir, outDir, opts = {}) {
  const recordsDir = opts.recordsDir || join(outDir, "records");
  const drop = opts.dropLabel || basename(csvDir.replace(/\/$/, ""));
  const report = { drop, warnings: [], skips: {}, counts: {} };
  const skip = (reason) => { report.skips[reason] = (report.skips[reason] || 0) + 1; };
  const readCsv = (f) => parseCsv(readFileSync(join(csvDir, f), "utf8"));

  // 0. integrity: every file must match MANIFEST.csv (unless skipped).
  const manifestPath = join(csvDir, "MANIFEST.csv");
  let manifest = null;
  try { manifest = readCsv("MANIFEST.csv"); } catch { /* older drop without one */ }
  if (manifest && !opts.skipManifest) {
    for (const m of manifest) {
      if (m.file === "MANIFEST.csv" || !m.file) continue;
      const hash = createHash("sha256").update(readFileSync(join(csvDir, m.file))).digest("hex");
      if (hash !== m.sha256) throw new Error(`MANIFEST mismatch: ${m.file} (use --skip-manifest to override)`);
    }
    report.counts.manifest = `verified ${manifest.length - 1} file(s)`;
  } else if (!manifest) {
    report.warnings.push("no MANIFEST.csv; integrity not verified");
  }

  const peopleCsv = readCsv("people.csv");
  const committeesCsv = readCsv("committees.csv");
  const issuesCsv = readCsv("issues.csv");
  const billsCsv = readCsv("bills.csv");
  const recordsCsv = readCsv("records.csv");
  const evidenceCsv = readCsv("evidence.csv");
  report.counts.csvRows = {
    people: peopleCsv.length, committees: committeesCsv.length, issues: issuesCsv.length,
    bills: billsCsv.length, records: recordsCsv.length, evidence: evidenceCsv.length,
  };

  const bills = new Map(billsCsv.map((b) => [b.bill_id, b]));
  const billIssues = new Map(billsCsv.map((b) => [b.bill_id, splitPipe(b.seed_issue_ids)]));

  // Optional reference taxonomy for real subcommittee names (ids match by id).
  const subNameRef = new Map();
  if (opts.subNamesPath) {
    const ref = JSON.parse(readFileSync(opts.subNamesPath, "utf8"));
    for (const c of ref.committees || []) for (const s of c.subcommittees || []) {
      if (s.id && s.name && !subNameRef.has(s.id)) subNameRef.set(s.id, s.name);
    }
  }

  // 1. taxonomy.json: committees.csv + subcommittee stubs from issue parents.
  const issueParents = new Map(); // committee id -> Set(sub id)
  for (const i of issuesCsv) {
    const parent = i.parent_subcommittee_id.trim(), comm = (i.committee_id || "").trim().toLowerCase();
    if (!parent) { skip("issue-without-parent"); continue; }
    if (!parent.startsWith(comm + "-") && parent !== comm) {
      report.warnings.push(`issue ${i.issue_id}: parent ${parent} not under committee ${comm}; skipped`);
      skip("issue-parent-mismatch");
      continue;
    }
    if (parent !== comm) {
      if (!issueParents.has(comm)) issueParents.set(comm, new Set());
      issueParents.get(comm).add(parent);
    }
  }
  const committees = [];
  const leaf = new Set();
  for (const c of committeesCsv) {
    const id = (c.web_taxonomy_id || "").trim().toLowerCase();
    if (!/^hs[a-z]{2}$/.test(id)) { skip("committee-no-valid-id"); continue; } // e.g. HLIG select committee
    const needed = issueParents.has(id);
    if (c.in_graph !== "True" && !needed) { skip("committee-out-of-graph"); continue; }
    if (c.in_graph !== "True" && needed) {
      report.warnings.push(`committee ${id} has in_graph=false but owns issues; included anyway`);
    }
    const subs = [...(issueParents.get(id) || [])].sort().map((sid) => {
      if (!subNameRef.has(sid)) report.counts.subFallback = (report.counts.subFallback || 0) + 1;
      return { id: sid, name: resolveSubName(sid, subNameRef) };
    });
    committees.push({ id, name: shortCommitteeName(c.committee_name), subcommittees: subs });
    if (!subs.length) leaf.add(id);
    subs.forEach((s) => leaf.add(s.id));
  }
  committees.sort((a, b) => (a.id < b.id ? -1 : 1));

  // 2. issues.json
  const issues = [];
  for (const i of issuesCsv) {
    const parent = i.parent_subcommittee_id.trim();
    if (!leaf.has(parent)) { skip("issue-parent-not-leaf"); continue; }
    issues.push({ id: i.issue_id.trim(), name: i.name.trim(), parent });
  }
  const issueIds = new Set(issues.map((i) => i.id));

  // 2b. bills.json (#28): one record per bill in the drop.
  const billsOut = [];
  for (const b of billsCsv) {
    const rec = buildBillRecord(b, issueIds);
    if (!rec.bill_id || !rec.number) { skip("bill-without-id"); continue; }
    billsOut.push(rec);
  }
  billsOut.sort((a, b) => (a.bill_id < b.bill_id ? -1 : 1));

  // 3. people.json (sitting + departed: all are real 119th members).
  const people = peopleCsv.map((p) => ({
    id: p.bioguide_id.trim(), bioguide_id: p.bioguide_id.trim(), name: p.name.trim(),
    chamber: "house", state: p.state.trim(), district: p.district.trim(),
    party: p.party.trim(), gender: p.gender.trim(), since: parseInt(p.since, 10),
  }));
  const personIds = new Set(people.map((p) => p.id));

  // 4. contract-A records from records.csv.
  const records = new Map(); // id -> { content, date, url, checksumFailed, lineIndex }
  for (const r of recordsCsv) {
    const persons = splitPipe(r.person_bioguides);
    const billUrls = splitPipe(r.bill_urls).filter(isUri);
    records.set(r.record_id, {
      id: r.record_id,
      content: r.content, date: r.date.trim(), url: r.source_url.trim(),
      checksumFailed: r.parse_status === "checksum_failed",
      lineIndex: null, persons, billUrls,
    });
  }


  // 5. stances.json from evidence.csv.
  // Synthetic BILLSTATUS records, one per (bill, event_date) with sponsorship rows.
  const sponsorGroups = new Map(); // "bill_id|date" -> rows
  for (const e of evidenceCsv) {
    if ((e.action === "sponsored" || e.action === "cosponsored") && isDate(e.event_date)) {
      const k = `${e.bill_id}|${e.event_date}`;
      if (!sponsorGroups.has(k)) sponsorGroups.set(k, []);
      sponsorGroups.get(k).push(e);
    }
  }
  const billstatusRecordId = (billId, date) => `rec-billstatus-${billId}-${date.replace(/-/g, "")}`;
  for (const [key, rows] of sponsorGroups) {
    const [billId, date] = key.split("|");
    const bill = bills.get(billId);
    if (!bill) { rows.forEach(() => skip("sponsorship-unknown-bill")); sponsorGroups.delete(key); continue; }
    const lines = [`<other>: ${bill.label} (119th Congress): ${bill.title}`];
    for (const r of rows) lines.push(`${r.action === "sponsored" ? "Sponsor" : "Cosponsor"}: ${r.person_name.trim()}`);
    lines.push(`Transcribed from congress.gov BILLSTATUS data; see ${bill.congress_url}`);
    const content = lines.join("\n");
    if (content.length < 50) throw new Error(`synthetic record too short for ${key}`);
    records.set(billstatusRecordId(billId, date), {
      id: billstatusRecordId(billId, date),
      content, date, url: bill.congress_url, checksumFailed: false, lineIndex: null,
      persons: rows.map((r) => r.person_bioguide), billUrls: [bill.congress_url], synthetic: true,
    });
  }

  const stances = [];
  const seen = new Set();
  let downgraded = 0;
  for (const e of evidenceCsv) {
    const action = e.action;
    if (action === "offered_amendment") { skip("amendment-no-record"); continue; }
    // #26: views signatures track minority-party membership, not issue opposition — no stance row.
    if (action === "signed_views") { skip("views-no-stance-row"); continue; }
    // #26: absence is not a neutral stance — no row (a cast "present" vote still emits one).
    if (action === "committee_vote" && (e.vote || "").trim() === "not_voting") { skip("not-voting-no-row"); continue; }
    if (!(action in SCORE)) { skip(`unknown-action-${action}`); continue; }
    if (!personIds.has(e.person_bioguide)) { skip("unknown-person"); continue; }
    const bill = bills.get(e.bill_id);
    if (!bill) { skip("unknown-bill"); continue; }
    // #26: one action -> one row on the bill's primary (first seed) issue, never fanned out.
    const targets = (billIssues.get(e.bill_id) || []).filter((id) => issueIds.has(id)).slice(0, 1);
    if (!targets.length) { skip("bill-without-issues"); continue; }

    // Anchor: the record's own line (guaranteed verbatim) or a synthetic sponsor line.
    let record, quote;
    if (action === "sponsored" || action === "cosponsored") {
      if (!isDate(e.event_date)) { skip("sponsorship-bad-date"); continue; }
      record = records.get(billstatusRecordId(e.bill_id, e.event_date));
      if (!record) { skip("sponsorship-no-record"); continue; }
      quote = `${action === "sponsored" ? "Sponsor" : "Cosponsor"}: ${e.person_name.trim()}`;
    } else {
      record = records.get(e.record_id);
      if (!record || !(e.quote_line || "").trim()) { skip("vote-or-views-no-record"); continue; }
      quote = resolveQuote(record, e.quote_line);
      if (!quote) { skip("quote-line-not-in-record"); continue; }
    }
    // Belt and braces: the quote must pass the validator's verbatim check.
    if (!normStrict(record.content).includes(normStrict(quote))) { skip("quote-not-verbatim"); continue; }

    const stance = e.stance_toward_bill;
    const sign = stance === "for" ? 1 : stance === "against" ? -1 : 0;
    const score = sign * SCORE[action];
    const direction = dirOf(score);
    if ((stance === "for") !== (direction === "support") && stance !== "unknown" && stance !== "neutral") {
      skip("stance-direction-mismatch");
      continue;
    }
    let linkage = (e.linkage || "").trim();
    if (!["low", "mid", "high", "super_high"].includes(linkage)) linkage = "high";
    let confidence = action === "signed_views" ? "mid" : stance === "unknown" ? "low" : "high";
    if (record.checksumFailed) { confidence = CONF_DOWN[confidence]; downgraded++; }
    const billStr = `${bill.label} ${bill.title}`.trim().slice(0, 120);
    const rationale = makeRationale(e, bill, record);

    for (const issue of targets) {
      const dedupKey = [e.person_bioguide, issue, record.date, score, quote, billStr, record.id].join("\u0001");
      if (seen.has(dedupKey)) { skip("duplicate-statement"); continue; }
      seen.add(dedupKey);
      const row = {
        person: e.person_bioguide, issue, date: record.date, score, direction,
        linkage, llm_confidence: confidence, quote, bill: billStr, source: record.url,
        model: `owl-ingest-${(e.extraction_method || "rule").trim()}`,
        record_id: record.id,
        rationale,
        kind: kindOfAction(action),
      };
      if (action === "committee_vote") {
        const vq = classifyVoteQuestion(e.vote_question);
        if (vq) row.vote_question = vq;
      }
      stances.push(row);
    }
  }
  // Deterministic order -> stable numbering for the same input.
  stances.sort((a, b) =>
    (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
    (a.person < b.person ? -1 : a.person > b.person ? 1 : 0) ||
    (a.bill < b.bill ? -1 : a.bill > b.bill ? 1 : 0) ||
    (a.issue < b.issue ? -1 : a.issue > b.issue ? 1 : 0) ||
    (a.quote < b.quote ? -1 : a.quote > b.quote ? 1 : 0));
  stances.forEach((s, i) => { s.statement_id = `st${String(i + 1).padStart(5, "0")}`; });
  // statement_id first, matching the mock files' key order.
  for (const s of stances) {
    const { statement_id, ...rest } = s;
    Object.keys(s).forEach((k) => delete s[k]);
    Object.assign(s, { statement_id, ...rest });
  }

  // 6. write everything.
  mkdirSync(outDir, { recursive: true });
  mkdirSync(recordsDir, { recursive: true });
  const meta = (description) => ({ _meta: { description, source: `owl-ingest CSV drop ${drop}`, drop } });
  writeFileSync(join(outDir, "taxonomy.json"), JSON.stringify({ ...meta(`House committees (level 1) and subcommittees (level 2) owning the seed issues.${report.counts.subFallback ? " Subcommittee names are provisional title-cased slugs: the CSV drop carries ids but no names." : " Subcommittee names carried over from the reference taxonomy."}`), committees }, null, 2) + "\n");
  writeFileSync(join(outDir, "issues.json"), JSON.stringify({ ...meta("Seed level-3 issues from bill metadata (issues.csv). The model may propose more."), issues }, null, 2) + "\n");
  writeFileSync(join(outDir, "people.json"), JSON.stringify({ ...meta("Every House member with a 119th-Congress term (sitting + departed). id = bioguide id."), people }, null, 2) + "\n");
  writeFileSync(join(outDir, "stances.json"), JSON.stringify({ ...meta("One row per (evidence fact x bill issue). Deterministic readings of sponsorships, committee votes and signed views; quotes are verbatim record lines."), stances }, null, 2) + "\n");
  writeFileSync(join(outDir, "bills.json"), JSON.stringify({ ...meta("One record per bill: number, title, status, last action, sponsor, issues."), bills: billsOut }, null, 2) + "\n");
  let nSynthetic = 0;
  for (const [id, r] of records) {
    const rec = {
      id, content: r.content,
      source: { url_link: r.url, media_type: "gov", media_name: "usgov", transcript: "official_transcript" },
      hints: { date: r.date, persons: r.persons, bill_urls: r.billUrls },
    };
    if (r.synthetic) {
      nSynthetic++;
      rec._meta = { description: "Deterministic transcription of congress.gov BILLSTATUS sponsorship data (not report prose). The process stage should skip rec-billstatus-* records: their facts are already in stances.json." };
    }
    writeFileSync(join(recordsDir, `${id}.json`), JSON.stringify(rec, null, 2) + "\n");
  }

  report.counts.output = {
    committees: committees.length, issues: issues.length, people: people.length,
    statements: stances.length, bills: billsOut.length, records: records.size, syntheticRecords: nSynthetic,
    checksumDowngraded: downgraded,
  };
  return { outDir, recordsDir, report };
}

function makeRationale(e, bill, record) {
  const label = bill.label;
  if (e.action === "sponsored") return `Sponsored ${label}.`;
  if (e.action === "cosponsored") return `Cosponsored ${label}.`;
  if (e.action === "signed_views") {
    const kind = (e.views_type || "").trim();
    return `Signed ${kind && kind !== "views" ? kind + " " : ""}views on ${label}.`;
  }
  // committee_vote
  const vote = (e.vote || "").trim();
  const verb = vote === "yea" ? "Voted yea" : vote === "nay" ? "Voted nay"
    : vote === "present" ? "Voted present" : "Did not vote";
  const comm = shortCommitteeName(e.committee_name || "");
  let r = `${verb} on ${label}${comm ? ` in the ${comm}` : ""}.`;
  const q = (e.vote_question || "").trim().replace(/\s+/g, " ");
  if (q && r.length + q.length + 11 <= 400) r += ` Question: ${q}`;
  return r.slice(0, 400);
}

export function formatReport(report) {
  const L = [`drop: ${report.drop}`];
  if (report.counts.manifest) L.push(`manifest: ${report.counts.manifest}`);
  const c = report.counts.csvRows || {};
  L.push(`csv rows: evidence=${c.evidence} records=${c.records} people=${c.people} bills=${c.bills} issues=${c.issues} committees=${c.committees}`);
  const o = report.counts.output || {};
  L.push(`output: ${o.statements} statements, ${o.bills} bills, ${o.people} people, ${o.issues} issues, ${o.committees} committees, ${o.records} records (${o.syntheticRecords} synthetic BILLSTATUS)`);
  if (report.counts.subFallback) L.push(`subcommittee names falling back to provisional slugs: ${report.counts.subFallback} (pass --sub-names <taxonomy.json>)`);
  const skips = Object.entries(report.skips).sort((a, b) => b[1] - a[1]);
  if (skips.length) L.push(`skipped evidence rows: ${skips.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  if (o.checksumDowngraded) L.push(`confidence downgraded on checksum_failed records: ${o.checksumDowngraded}`);
  for (const w of report.warnings) L.push(`warn: ${w}`);
  return L.join("\n");
}

// ---------- CLI ----------
const isMain = process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const args = process.argv.slice(2);
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--records" || a === "--drop" || a === "--sub-names") { i++; continue; }
    if (a.startsWith("--")) continue;
    positional.push(a);
  }
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const [csvDir, outDir] = positional;
  if (!csvDir || !outDir) {
    console.error("usage: csv-to-json.mjs <csv-dir> <out-dir> [--records <dir>] [--drop <label>] [--sub-names <taxonomy.json>] [--skip-manifest]");
    process.exit(2);
  }
  try {
    const { report } = convertCsvDrop(resolve(csvDir), resolve(outDir), {
      recordsDir: opt("--records") ? resolve(opt("--records")) : undefined,
      dropLabel: opt("--drop") || undefined,
      subNamesPath: opt("--sub-names") ? resolve(opt("--sub-names")) : undefined,
      skipManifest: args.includes("--skip-manifest"),
    });
    console.log(formatReport(report));
  } catch (err) {
    console.error(`ERROR ${err.message}`);
    process.exit(1);
  }
}
