#!/usr/bin/env node
// Batch stance extraction with Muse Spark: contract-A records -> contract-B statements.
//
//   node services/process/extract-batch.mjs <data-dir> [options]
//
// Reads taxonomy/issues/people/stances from <data-dir> and contract-A records from
// --records (default <data-dir>/records). For each selected record it calls the model
// once with a slim prompt (only the record's hinted persons + the issue list), hard-
// validates every returned statement, and writes <data-dir>/extracted/<id>.extracted.json.
// With --merge, accepted statements are appended to stances.json. --merge-only
// merges previously extracted files without any API calls (idempotent: already-
// merged statements are skipped, so it is safe to re-run after human review).
//
// Budget controls (a full 119th-Congress views backfill is ~600 calls):
//   --limit N            process at most N records (trial mode; longest-first)
//   --max-input-tokens N stop scheduling new calls once spent input tokens exceed N
//   --dry-run            select records and report prompt sizes without calling the API
//   --concurrency N      parallel calls (default 3)
//   --only id[,id...]    process only these record ids (comma-separated)
// Every call's usage is logged; totals print at the end.
//
// Safety:
//   - resume by default: records with an extracted file are skipped (unless --redo)
//   - new_issue proposals are STAGED in extracted/_new-issues.json, never auto-merged
//     (unless --merge-new-issues); statements on staged issues are held, not merged
//   - person must be one of the record's hinted persons (stricter than extract.mjs)
//   - direction is derived from score; the model's label is advisory only
//   - --supersede-signatures drops deterministic "Signed ... views" rows for a
//     (person, record, issue) once the model covers that triple with real speech quotes
//
// Auth: MUSE_API_KEY (or MODEL_API_KEY), optionally from <repo>/.env (gitignored).
// Zero dependencies (Node >= 18).

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewNewIssues } from "./review-issues.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const flag = (n) => args.includes(n);
const positional = args.filter((a, i) => !a.startsWith("--") && !["--records", "--model", "--limit", "--concurrency", "--include", "--exclude", "--max-input-tokens", "--base-url", "--sort", "--max-tokens", "--reasoning-effort", "--only"].includes(args[i - 1]));

const DATA = resolve(positional[0] || join(ROOT, "data"));
const RECORDS = resolve(opt("--records", join(DATA, "records")));
const MODEL = opt("--model", "muse-spark-1.3");
const BASE_URL = opt("--base-url", process.env.MODEL_BASE_URL || "https://api.meta.ai/v1");
const LIMIT = opt("--limit") ? parseInt(opt("--limit"), 10) : Infinity;
const CONC = Math.max(1, parseInt(opt("--concurrency", "3"), 10));
const INCLUDE = opt("--include", "-views");
const EXCLUDE = opt("--exclude", "billstatus");
const MAX_IN = opt("--max-input-tokens") ? parseInt(opt("--max-input-tokens"), 10) : Infinity;
const MAX_TOK = parseInt(opt("--max-tokens", "16000"), 10);
const REASONING = opt("--reasoning-effort", "low"); // low | medium | high (ignored if unsupported)
const ONLY = opt("--only") ? new Set(opt("--only").split(",").map((s) => s.trim()).filter(Boolean)) : null;
const SORT = opt("--sort", "longest"); // longest | id
const DRY = flag("--dry-run"), MERGE = flag("--merge") || flag("--merge-only"), REDO = flag("--redo");
const MERGE_ONLY = flag("--merge-only");
const MERGE_NEW = flag("--merge-new-issues"), SUPERSEDE = flag("--supersede-signatures");

if (existsSync(join(ROOT, ".env"))) {
  for (const line of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const KEY = process.env.MUSE_API_KEY || process.env.MODEL_API_KEY;
if (!KEY && !DRY && !MERGE_ONLY) { console.error("MUSE_API_KEY missing (put it in .env, which is gitignored)"); process.exit(1); }

const load = (f) => JSON.parse(readFileSync(join(DATA, f), "utf8"));
const taxonomy = load("taxonomy.json").committees;
const issuesFile = load("issues.json");
const peopleFile = load("people.json");
const stancesFile = load("stances.json");
const byId = Object.fromEntries(peopleFile.people.map((p) => [p.id, p]));
const issueIds = new Set(issuesFile.issues.map((i) => i.id));
const subs = taxonomy.flatMap((c) => (c.subcommittees.length ? c.subcommittees : [{ id: c.id }]).map((s) => s.id));
const subIds = new Set(subs);

const norm = (s) => String(s || "").normalize("NFKC")
  .replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
const dirOf = (s) => (s > 0.15 ? "support" : s < -0.15 ? "oppose" : "neutral");

const CONF = new Set(["low", "mid", "high", "super_high"]);
const estTokens = (chars) => Math.ceil(chars / 4);

const SYSTEM = `You extract legislators' stances from U.S. congressional committee-report views sections for an evidence-anchored public database.
For every passage where a listed legislator takes a position on a policy issue, emit one statement.
Rules:
- Only legislators from the provided list, by id. The speaker tag names the section's signers; attribute shared text to EACH signer only when the passage states a position (do not emit one row per signer for purely procedural sentences).
- Map each statement to an existing issue id when one fits. If none fits, propose new_issue {name, parent} where parent is a subcommittee id from the taxonomy.
- score in [-1, 1]: +1 strong support, -1 strong opposition, near 0 neutral/undecided. direction must match the score.
- linkage (how directly the quote addresses the issue) and llm_confidence (how sure you are of the reading) in: low, mid, high, super_high.
- quote: a VERBATIM contiguous excerpt (<= 60 words, <= 600 chars) copied exactly from the text. Never paraphrase. The quote must by itself justify the score. Never quote the speaker tag.
- bill: the bill named in or around the passage (label first, e.g. "H.R. 1382 ..."), else null. rationale: one neutral sentence on why the score.
- A legislator may produce several statements if they address several issues. Do not merge different issues into one statement.
- If no passage states a position attributable to a listed legislator, return {"statements": []}.
Return ONLY the JSON object: no markdown fences, no commentary, no analysis text.
{"statements":[{"person":"<id>","issue":"<issue-id>"|null,"new_issue":{"name":"...","parent":"<sub-id>"}|null,"score":0.8,"direction":"support","linkage":"high","llm_confidence":"high","quote":"...","bill":"H.R. 1382 ..."|null,"rationale":"..."}]}`;

function buildPrompt(record, persons) {
  const userMsg = `Taxonomy subcommittee ids:\n${subs.join(", ")}\n\nExisting issues (id: name, parent):\n${issuesFile.issues.map((i) => `${i.id}: ${i.name} (${i.parent})`).join("\n")}\n\nLegislators (id: name, district, party):\n${persons.map((p) => `${p.id}: ${p.name}, ${p.district}, ${p.party}`).join("\n")}\n\nRecord ${record.id}, date ${record.hints?.date || "unknown"}, source ${record.source?.url_link}.\nText:\n${record.content}\n\nExtract the statements now.`;
  return { system: SYSTEM, user: userMsg };
}

async function callModel(messages, attempt = 1) {
  const r = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: MAX_TOK, temperature: 0.1, reasoning_effort: REASONING, response_format: { type: "json_object" } }),
    signal: AbortSignal.timeout(180000),
  });
  if ((r.status === 429 || r.status >= 500) && attempt <= 3) {
    const wait = [2000, 8000, 30000][attempt - 1];
    await new Promise((res) => setTimeout(res, wait));
    return callModel(messages, attempt + 1);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

function validateStatements(parsed, record, persons) {
  const CONTENT = norm(record.content);
  const personIds = new Set(persons.map((p) => p.id));
  const accepted = [], rejected = [], newIssues = [];
  for (const st of parsed.statements || []) {
    const why = [];
    if (!personIds.has(st.person)) why.push(`person ${st.person} not a signer of this record`);
    let issueId = st.issue;
    if (!issueId || !issueIds.has(issueId)) {
      if (st.new_issue && subIds.has(st.new_issue.parent) && st.new_issue.name) {
        issueId = st.new_issue.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        if (!issueIds.has(issueId) && !newIssues.some((n) => n.id === issueId)) {
          newIssues.push({ id: issueId, name: st.new_issue.name, parent: st.new_issue.parent });
        }
      } else why.push(`unknown issue ${st.issue} / bad new_issue`);
    }
    const score = Number(st.score);
    if (!(score >= -1 && score <= 1)) why.push("score out of range");
    const direction = dirOf(score);
    if (!CONF.has(st.linkage) || !CONF.has(st.llm_confidence)) why.push("bad linkage/confidence");
    const q = String(st.quote || "").trim();
    if (!q || q.length > 600) why.push("quote empty/too long");
    else if (!CONTENT.includes(norm(q))) why.push("quote not verbatim in text");
    else if (/^<Rep\. .+>:/.test(q)) why.push("quote is the speaker tag");
    const bill = st.bill ? String(st.bill).trim().slice(0, 120) : null;
    if (why.length) { rejected.push({ st, why }); continue; }
    accepted.push({
      person: st.person, issue: issueId, date: record.hints?.date || null, score: +score.toFixed(2),
      direction, linkage: st.linkage, llm_confidence: st.llm_confidence, quote: q, bill,
      source: record.source?.url_link || null, record_id: record.id,
      model: MODEL, rationale: st.rationale ? String(st.rationale).slice(0, 400) : null,
    });
  }
  return { accepted, rejected, newIssues };
}

// ---------- record selection ----------
const extractedDir = join(DATA, "extracted");
mkdirSync(extractedDir, { recursive: true });
let files = readdirSync(RECORDS).filter((f) => f.endsWith(".json"));
files = files.filter((f) => (!INCLUDE || f.includes(INCLUDE)) && (!EXCLUDE || !f.includes(EXCLUDE)));
let selected = [];
for (const f of files) {
  const id = f.replace(/\.json$/, "");
  if (ONLY && !ONLY.has(id)) continue;
  const donePath = join(extractedDir, `${id}.extracted.json`);
  if (!REDO && existsSync(donePath)) continue;
  selected.push({ file: join(RECORDS, f), id, donePath });
}
if (SORT === "longest") {
  const sizeOf = (s) => { try { return JSON.parse(readFileSync(s.file, "utf8")).content?.length || 0; } catch { return 0; } };
  selected.sort((a, b) => sizeOf(b) - sizeOf(a));
} else selected.sort((a, b) => (a.id < b.id ? -1 : 1));
selected = selected.slice(0, LIMIT);

if (MERGE_ONLY) selected = [];
if (!selected.length && !MERGE_ONLY) { console.log("nothing to do (all selected records already extracted; use --redo to rerun)"); process.exit(0); }

// ---------- dry run ----------
if (DRY && !MERGE_ONLY) {
  let chars = 0;
  for (const s of selected.slice(0, 10)) {
    const record = JSON.parse(readFileSync(s.file, "utf8"));
    const persons = (record.hints?.persons || []).map((id) => byId[id]).filter(Boolean);
    const { system, user } = buildPrompt(record, persons);
    chars += system.length + user.length;
    console.log(`  ${s.id}: persons=${persons.length} prompt_chars=${system.length + user.length} est_in_tok=${estTokens(system.length + user.length)}`);
  }
  const avg = chars / Math.min(10, selected.length);
  console.log(`selected ${selected.length} record(s) [include="${INCLUDE}" exclude="${EXCLUDE}"]`);
  console.log(`prompt estimate from first ${Math.min(10, selected.length)}: avg ${estTokens(avg)} in-tokens/record -> ~${estTokens(avg) * selected.length} in-tokens for all ${selected.length}`);
  process.exit(0);
}

// ---------- run ----------
const totals = { accepted: 0, rejected: 0, held: 0, newIssues: 0, inTok: 0, outTok: 0, failed: 0 };
const allNewIssues = new Map();
const covered = new Set(); // person|record with >= 1 accepted (for supersede)
const mergedStmts = [];
let stopped = false;

async function processOne(s) {
  const record = JSON.parse(readFileSync(s.file, "utf8"));
  const persons = (record.hints?.persons || []).map((id) => byId[id]).filter(Boolean);
  if (!persons.length) {
    writeFileSync(s.donePath, JSON.stringify({ record_id: s.id, skipped: "no hinted persons in people.json", extracted_at: new Date().toISOString() }, null, 2) + "\n");
    console.log(`  - ${s.id}: skipped (no hinted persons)`);
    return;
  }
  const { system, user } = buildPrompt(record, persons);
  let j;
  try {
    j = await callModel([{ role: "system", content: system }, { role: "user", content: user }]);
  } catch (e) {
    totals.failed++;
    console.log(`  ! ${s.id}: FAILED ${e.message}`);
    return;
  }
  const raw = j.choices?.[0]?.message?.content || "";
  const finishReason = j.choices?.[0]?.finish_reason || null;
  const s0 = raw.indexOf("{");
  let parsed = null;
  try { parsed = s0 >= 0 ? JSON.parse(raw.slice(s0, raw.lastIndexOf("}") + 1)) : null; } catch { parsed = null; }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.statements)) {
    totals.failed++;
    writeFileSync(s.donePath, JSON.stringify({ record_id: s.id, model: j.model || MODEL, extracted_at: new Date().toISOString(), error: "unparseable", finish_reason: finishReason, raw: raw.slice(0, 2000), usage: j.usage }, null, 2) + "\n");
    console.log(`  ! ${s.id}: unparseable output (finish_reason=${finishReason})`);
    return;
  }
  const { accepted, rejected, newIssues } = validateStatements(parsed, record, persons);
  for (const n of newIssues) if (!allNewIssues.has(n.id)) allNewIssues.set(n.id, { ...n, from: s.id });
  const inTok = j.usage?.prompt_tokens || 0, outTok = j.usage?.completion_tokens || 0;
  totals.inTok += inTok; totals.outTok += outTok;
  totals.accepted += accepted.length; totals.rejected += rejected.length;
  for (const a of accepted) covered.add(`${a.person}|${a.record_id}|${a.issue}`);
  const out = { record_id: s.id, model: j.model || MODEL, extracted_at: new Date().toISOString(), accepted, rejected, new_issues: newIssues, usage: j.usage, finish_reason: finishReason };
  if (!accepted.length && !rejected.length) out.raw_excerpt = raw.slice(0, 2000); // diagnose empty verdicts
  writeFileSync(s.donePath, JSON.stringify(out, null, 2) + "\n");
  console.log(`  + ${s.id}: accepted ${accepted.length}, rejected ${rejected.length} · ${inTok}/${outTok} tok${finishReason && finishReason !== "stop" ? ` (finish_reason=${finishReason})` : ""}`);
  for (const x of rejected) console.log(`      ✗ ${x.st.person} → ${x.st.issue || x.st.new_issue?.name}: ${x.why.join("; ")}`);
  return accepted;
}

// Simple worker pool with a token-budget stop.
const queue = [...selected];
const allAccepted = [];
async function worker() {
  while (queue.length && !stopped) {
    if (totals.inTok >= MAX_IN) { stopped = true; break; }
    const s = queue.shift();
    const acc = await processOne(s);
    if (acc) allAccepted.push(...acc);
  }
}
await Promise.all(Array.from({ length: Math.min(CONC, queue.length) }, worker));
if (stopped) console.log(`STOPPED: input token budget ${MAX_IN} reached (${queue.length} record(s) left)`);

if (MERGE_ONLY) {
  // Merge previously extracted files: no API calls. Skips stale fixtures
  // (e.g. mock-era files referencing persons absent from current data).
  let files = 0, stale = 0;
  for (const f of readdirSync(extractedDir).filter((x) => x.endsWith(".extracted.json"))) {
    const e = JSON.parse(readFileSync(join(extractedDir, f), "utf8"));
    if (!e.accepted) continue;
    files++;
    for (const n of e.new_issues || []) if (!allNewIssues.has(n.id)) allNewIssues.set(n.id, n);
    for (const a of e.accepted) {
      if (!byId[a.person]) { stale++; continue; }
      allAccepted.push(a);
      covered.add(`${a.person}|${a.record_id}|${a.issue}`);
    }
  }
  totals.accepted = allAccepted.length;
  console.log(`merge-only: ${allAccepted.length} statement(s) from ${files} file(s), ${stale} stale skipped`);
}

if (allNewIssues.size) {
  writeFileSync(join(extractedDir, "_new-issues.json"), JSON.stringify({ generated_at: new Date().toISOString(), staged: "human review required before merging into issues.json", issues: [...allNewIssues.values()] }, null, 2) + "\n");
}
totals.newIssues = allNewIssues.size;

// ---------- merge ----------
if (MERGE && allAccepted.length) {
  let newIssueIds = new Set();
  if (MERGE_NEW && allNewIssues.size) {
    const review = reviewNewIssues(issuesFile.issues, [...allNewIssues.values()]);
    for (const c of review.create) {
      if (!subIds.has(c.parent)) { console.log(`  ! new issue ${c.id}: bad parent ${c.parent}, skipped`); continue; }
      issuesFile.issues.push(c); issueIds.add(c.id);
    }
    writeFileSync(join(DATA, "issues.json"), JSON.stringify(issuesFile, null, 2) + "\n");
    for (const a of allAccepted) if (review.remap.has(a.issue)) a.issue = review.remap.get(a.issue);
    newIssueIds = new Set(review.create.map((c) => c.id));
    writeFileSync(join(extractedDir, "_new-issues.json"), JSON.stringify({ reviewed_at: new Date().toISOString(), mode: "deterministic-review", created: review.create, remapped: Object.fromEntries(review.remap), audit: review.audit }, null, 2) + "\n");
    console.log(`reviewed ${allNewIssues.size} proposal(s): ${review.create.length} created, ${review.remap.size} remapped`);
    for (const line of review.audit) console.log(`  ~ ${line}`);
  }
  const mergeable = allAccepted.filter((a) => issueIds.has(a.issue) || newIssueIds.has(a.issue));
  totals.held = allAccepted.length - mergeable.length;
  // Idempotent merge: skip statements already in stances.json (same fact key).
  const factKey = (s) => [s.person, s.issue, s.date, s.score, s.quote, s.bill, s.record_id, s.model].join("");
  const have = new Set(stancesFile.stances.map(factKey));
  const fresh = mergeable.filter((a) => !have.has(factKey(a)));
  const dupes = mergeable.length - fresh.length;
  let nextId = Math.max(0, ...stancesFile.stances.map((s) => +String(s.statement_id || "").replace(/\D/g, "") || 0)) + 1;
  const width = Math.max(5, String(nextId + fresh.length).length);
  for (const a of fresh) {
    a.statement_id = `st${String(nextId++).padStart(width, "0")}`;
  }
  let superseded = 0;
  if (SUPERSEDE) {
    const keep = stancesFile.stances.filter((s) => {
      const isSig = String(s.model || "").startsWith("owl-ingest-") && /^Signed .* views on /.test(String(s.rationale || ""));
      if (isSig && covered.has(`${s.person}|${s.record_id}|${s.issue}`)) { superseded++; return false; }
      return true;
    });
    stancesFile.stances = keep;
  }
  // Keep deterministic key order: statement_id first.
  for (const a of fresh) {
    const { statement_id, ...rest } = a;
    fresh[fresh.indexOf(a)] = { statement_id, ...rest };
  }
  stancesFile.stances.push(...fresh);
  writeFileSync(join(DATA, "stances.json"), JSON.stringify(stancesFile, null, 2) + "\n");
  console.log(`merged ${fresh.length} statement(s) into stances.json (held ${totals.held} on staged issues, ${dupes} already-merged skipped, superseded ${superseded} signature rows)`);
}

console.log(`BATCH: ${selected.length - queue.length} record(s), accepted ${totals.accepted}, rejected ${totals.rejected}, failed ${totals.failed}, new issues staged ${totals.newIssues}`);
console.log(`TOKENS: in=${totals.inTok} out=${totals.outTok} total=${totals.inTok + totals.outTok} (model ${MODEL})`);
