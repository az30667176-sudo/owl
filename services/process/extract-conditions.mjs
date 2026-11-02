#!/usr/bin/env node
// Conditional-stance extraction with Muse Spark: contract-A records -> contract-B conditions.
//
//   node services/process/extract-conditions.mjs <data-dir> [options]
//
// Reads taxonomy/issues/people/stances from <data-dir> and contract-A records from
// --records (default <data-dir>/records). Only records matching a conditional-
// language prefilter are sent to the model (override with --no-prefilter).
// Each call extracts condition rows (person states support/opposition contingent
// on a demand); per-record output goes to <data-dir>/extracted/cond-<id>.extracted.json.
// With --merge, demand proposals are consolidated into a registry and rows are
// written to conditions.json (idempotent).
//
// Options mirror extract-batch.mjs: --limit N, --max-input-tokens N, --dry-run,
// --concurrency N (default 3), --include/--exclude <substr>, --only id[,id...],
// --sort longest|id, --redo, --merge, --model, --base-url, --max-tokens,
// --reasoning-effort, --no-prefilter.
//
// Auth: MUSE_API_KEY (or MODEL_API_KEY), optionally from <repo>/.env (gitignored).
// Zero dependencies (Node >= 18).

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
const REASONING = opt("--reasoning-effort", "low");
const ONLY = opt("--only") ? new Set(opt("--only").split(",").map((s) => s.trim()).filter(Boolean)) : null;
const SORT = opt("--sort", "longest");
const DRY = flag("--dry-run"), MERGE = flag("--merge"), REDO = flag("--redo"), PREFILTER = !flag("--no-prefilter");

if (existsSync(join(ROOT, ".env"))) {
  for (const line of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const KEY = process.env.MUSE_API_KEY || process.env.MODEL_API_KEY;
if (!KEY && !DRY) { console.error("MUSE_API_KEY missing (put it in .env, which is gitignored)"); process.exit(1); }

const load = (f) => JSON.parse(readFileSync(join(DATA, f), "utf8"));
const issuesFile = load("issues.json");
const peopleFile = load("people.json");
const stancesFile = load("stances.json");
const byId = Object.fromEntries(peopleFile.people.map((p) => [p.id, p]));
const issueIds = new Set(issuesFile.issues.map((i) => i.id));
const issueById = Object.fromEntries(issuesFile.issues.map((i) => [i.id, i]));

// statement_id linkage: exact (person, normalized quote) match, else null.
const norm = (s) => String(s || "").normalize("NFKC")
  .replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
const stmtByQuote = new Map();
for (const s of stancesFile.stances) {
  if (s.statement_id) stmtByQuote.set(`${s.person}${norm(s.quote)}`, s.statement_id);
}

const CONF = new Set(["low", "mid", "high", "super_high"]);
const TYPES = new Set(["amendment", "funding", "timeline", "oversight", "exemption", "study", "procedure", "other"]);
const estTokens = (chars) => Math.ceil(chars / 4);
const COND_RX = /\b(would (support|oppose|vote)|will (support|oppose|vote)|unless|provided that|on the condition|contingent|only if|threaten[a-z]* to (oppose|withhold)|withhold[a-z]* (the |my |our )?(vote|support)|cannot support|no vote|without .* (amendment|change|provision|protection))\b/i;

const SYSTEM = `You extract CONDITIONAL stances from U.S. congressional committee-report views sections for an evidence-anchored public database.
A condition exists ONLY when a listed legislator states that their support or opposition DEPENDS on something: "would support if X", "cannot vote for this unless Y", "will oppose final passage without Z". Unconditional support/opposition is NOT a condition — skip it.
Rules:
- Only legislators from the provided list, by id.
- Map each condition to an existing issue id (no new issues).
- stance_if_met: support or oppose — the stance the legislator takes IF the demand is met.
- scope: "final_passage" only when the legislator explicitly threatens the final floor vote; otherwise "vote" (the committee vote / the bill as written).
- condition: one-sentence paraphrase (<= 300 chars) of what is demanded.
- quote: a VERBATIM contiguous excerpt (<= 400 chars) copied exactly from the text that states the condition. Never paraphrase. Never quote the speaker tag.
- demand: propose the shared demand {name (short display name, <= 80 chars), type} where type is one of: amendment, funding, timeline, oversight, exemption, study, procedure, other. Same demand across passages must use the SAME name.
- bill: the bill named in or around the passage (label first, e.g. "H.R. 1382 ..."), else null.
- If no passage states a condition attributable to a listed legislator, return {"conditions": []}.
Return ONLY the JSON object: no markdown fences, no commentary, no analysis text.
{"conditions":[{"person":"<id>","issue":"<issue-id>","bill":"H.R. 1382 ..."|null,"stance_if_met":"support","scope":"vote","condition":"...","quote":"...","demand":{"name":"...","type":"amendment"}}]}`;

function buildPrompt(record, persons) {
  const userMsg = `Issues (id: name):\n${issuesFile.issues.map((i) => `${i.id}: ${i.name}`).join("\n")}\n\nLegislators (id: name, district, party):\n${persons.map((p) => `${p.id}: ${p.name}, ${p.district}, ${p.party}`).join("\n")}\n\nRecord ${record.id}, date ${record.hints?.date || "unknown"}, source ${record.source?.url_link}.\nText:\n${record.content}\n\nExtract the conditions now.`;
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

function validateConditions(parsed, record, persons) {
  const CONTENT = norm(record.content);
  const personIds = new Set(persons.map((p) => p.id));
  const accepted = [], rejected = [], demands = [];
  for (const c of parsed.conditions || []) {
    const why = [];
    if (!personIds.has(c.person)) why.push(`person ${c.person} not a signer of this record`);
    if (!c.issue || !issueIds.has(c.issue)) why.push(`unknown issue ${c.issue}`);
    if (c.stance_if_met !== "support" && c.stance_if_met !== "oppose") why.push("bad stance_if_met");
    if (c.scope !== "vote" && c.scope !== "final_passage") why.push("bad scope");
    const cond = String(c.condition || "").trim().replace(/\s+/g, " ");
    if (!cond || cond.length > 300) why.push("condition empty/too long");
    const q = String(c.quote || "").trim();
    if (!q || q.length > 400) why.push("quote empty/too long");
    else if (!CONTENT.includes(norm(q))) why.push("quote not verbatim in text");
    else if (/^<Rep\. .+>:/.test(q)) why.push("quote is the speaker tag");
    const d = c.demand || {};
    const dname = String(d.name || "").trim().replace(/\s+/g, " ");
    if (!dname || dname.length > 80) why.push("bad demand name");
    if (!TYPES.has(d.type)) why.push(`bad demand type ${d.type}`);
    if (why.length) { rejected.push({ c, why }); continue; }
    const bill = c.bill ? String(c.bill).trim().slice(0, 120) : null;
    accepted.push({
      person: c.person, issue: c.issue, bill, stance_if_met: c.stance_if_met, scope: c.scope,
      condition: cond, quote: q, statement_id: stmtByQuote.get(`${c.person}${norm(q)}`) || null,
      record_id: record.id, model: MODEL, _demand: { name: dname, type: d.type },
    });
    if (!demands.some((x) => x.name === dname && x.type === d.type)) demands.push({ name: dname, type: d.type });
  }
  return { accepted, rejected, demands };
}

// Demand registry consolidation: same-type proposals merge when one name token
// set contains the other or Jaccard (stopwords dropped) >= 0.5. Star topology,
// shortest name wins. Returns { demands: [{id,name,type}], remap: Map("name|type"->id) }.
const STOPWORDS = new Set(["and", "or", "of", "the", "a", "an", "for", "to", "in", "on"]);
const toks = (s, stop = false) =>
  String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && (!stop || !STOPWORDS.has(t)));
const slug = (s) => toks(s).join("-").slice(0, 60) || "demand";
function consolidateDemands(proposals) {
  const canon = [];
  const remap = new Map();
  const key = (p) => `${p.name}${p.type}`;
  const ordered = [...new Map(proposals.map((p) => [key(p), p])).values()].sort((a, b) => a.name.length - b.name.length);
  const similar = (a, b) => {
    const A = new Set(toks(a)), B = new Set(toks(b));
    if ([...A].every((t) => B.has(t)) || [...B].every((t) => A.has(t))) return true;
    const As = new Set(toks(a, true)), Bs = new Set(toks(b, true));
    const inter = [...As].filter((t) => Bs.has(t)).length;
    return inter / new Set([...As, ...Bs]).size >= 0.5;
  };
  for (const p of ordered) {
    const hit = canon.find((c) => c.type === p.type && similar(c.name, p.name));
    if (hit) { remap.set(key(p), hit.id); continue; }
    let id = slug(p.name), n = 2;
    while (canon.some((c) => c.id === id)) id = `${slug(p.name)}-${n++}`;
    canon.push({ id, name: p.name, type: p.type });
    remap.set(key(p), id);
  }
  return { demands: canon, remap };
}

// ---------- record selection ----------
const extractedDir = join(DATA, "extracted");
mkdirSync(extractedDir, { recursive: true });
let files = readdirSync(RECORDS).filter((f) => f.endsWith(".json"));
files = files.filter((f) => (!INCLUDE || f.includes(INCLUDE)) && (!EXCLUDE || !f.includes(EXCLUDE)));
let selected = [], prefiltered = 0;
for (const f of files) {
  const id = f.replace(/\.json$/, "");
  if (ONLY && !ONLY.has(id)) continue;
  const donePath = join(extractedDir, `cond-${id}.extracted.json`);
  if (!REDO && existsSync(donePath)) continue;
  if (PREFILTER && !ONLY) {
    try {
      const content = JSON.parse(readFileSync(join(RECORDS, f), "utf8")).content || "";
      if (!COND_RX.test(content)) { prefiltered++; continue; }
    } catch { /* unreadable -> let it fail in processing */ }
  }
  selected.push({ file: join(RECORDS, f), id, donePath });
}
if (SORT === "longest") {
  const sizeOf = (s) => { try { return JSON.parse(readFileSync(s.file, "utf8")).content?.length || 0; } catch { return 0; } };
  selected.sort((a, b) => sizeOf(b) - sizeOf(a));
} else selected.sort((a, b) => (a.id < b.id ? -1 : 1));
selected = selected.slice(0, LIMIT);

if (!selected.length) { console.log("nothing to do (all selected records already extracted; use --redo to rerun)"); process.exit(0); }

if (DRY) {
  let chars = 0;
  for (const s of selected.slice(0, 10)) {
    const record = JSON.parse(readFileSync(s.file, "utf8"));
    const persons = (record.hints?.persons || []).map((id) => byId[id]).filter(Boolean);
    const { system, user } = buildPrompt(record, persons);
    chars += system.length + user.length;
    console.log(`  ${s.id}: persons=${persons.length} prompt_chars=${system.length + user.length} est_in_tok=${estTokens(system.length + user.length)}`);
  }
  const avg = chars / Math.min(10, selected.length);
  console.log(`selected ${selected.length} record(s) [prefilter dropped ${prefiltered}]`);
  console.log(`prompt estimate: avg ${estTokens(avg)} in-tokens/record -> ~${estTokens(avg) * selected.length} in-tokens for all ${selected.length}`);
  process.exit(0);
}

// ---------- run ----------
const totals = { accepted: 0, rejected: 0, failed: 0, inTok: 0, outTok: 0 };
const allAccepted = [], allDemands = [];
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
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.conditions)) {
    totals.failed++;
    writeFileSync(s.donePath, JSON.stringify({ record_id: s.id, model: j.model || MODEL, extracted_at: new Date().toISOString(), error: "unparseable", finish_reason: finishReason, raw: raw.slice(0, 2000), usage: j.usage }, null, 2) + "\n");
    console.log(`  ! ${s.id}: unparseable output (finish_reason=${finishReason})`);
    return;
  }
  const { accepted, rejected, demands } = validateConditions(parsed, record, persons);
  allDemands.push(...demands);
  const inTok = j.usage?.prompt_tokens || 0, outTok = j.usage?.completion_tokens || 0;
  totals.inTok += inTok; totals.outTok += outTok;
  totals.accepted += accepted.length; totals.rejected += rejected.length;
  const out = { record_id: s.id, model: j.model || MODEL, extracted_at: new Date().toISOString(), accepted, rejected, demands, usage: j.usage, finish_reason: finishReason };
  if (!accepted.length && !rejected.length) out.raw_excerpt = raw.slice(0, 2000);
  writeFileSync(s.donePath, JSON.stringify(out, null, 2) + "\n");
  console.log(`  + ${s.id}: accepted ${accepted.length}, rejected ${rejected.length} · ${inTok}/${outTok} tok${finishReason && finishReason !== "stop" ? ` (finish_reason=${finishReason})` : ""}`);
  for (const x of rejected) console.log(`      ✗ ${x.c.person}: ${x.why.join("; ")}`);
  return accepted;
}

const queue = [...selected];
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

// ---------- merge ----------
if (MERGE && allAccepted.length) {
  const outPath = join(DATA, "conditions.json");
  const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : null;
  const { demands, remap } = consolidateDemands([
    ...(existing?.demands || []).map((d) => ({ name: d.name, type: d.type })),
    ...allDemands,
  ]);
  // Keep pre-existing demand ids stable.
  const byNameType = new Map((existing?.demands || []).map((d) => [`${d.name}${d.type}`, d.id]));
  for (const d of demands) {
    const old = byNameType.get(`${d.name}${d.type}`);
    if (old) { remap.set(`${d.name}${d.type}`, old); d.id = old; }
  }
  const have = new Set((existing?.conditions || []).map((c) => `${c.person}${norm(c.quote)}${c.record_id}`));
  const rows = [];
  let dupes = 0;
  for (const a of allAccepted) {
    if (have.has(`${a.person}${norm(a.quote)}${a.record_id}`)) { dupes++; continue; }
    const { _demand, ...rest } = a;
    rows.push({ ...rest, demand: remap.get(`${_demand.name}${_demand.type}`) });
  }
  let nextId = Math.max(0, ...(existing?.conditions || []).map((c) => +String(c.condition_id || "").replace(/\D/g, "") || 0)) + 1;
  const width = Math.max(5, String(nextId + rows.length).length);
  for (const r of rows) r.condition_id = `cd${String(nextId++).padStart(width, "0")}`;
  for (const r of rows) {
    const { condition_id, ...rest } = r;
    Object.keys(r).forEach((k) => delete r[k]);
    Object.assign(r, { condition_id, ...rest });
  }
  const file = {
    _meta: { description: "Conditions ledger (contract B, optional). One row per condition a legislator states for supporting or opposing a bill. Extracted by extract-conditions.mjs; demand registry consolidated deterministically.", source: "owl-ingest CSV drop" },
    demands: demands.map(({ id, name, type }) => ({ id, name, type })),
    conditions: [...(existing?.conditions || []), ...rows],
  };
  writeFileSync(outPath, JSON.stringify(file, null, 2) + "\n");
  console.log(`merged ${rows.length} condition(s), ${demands.length} demand(s) into conditions.json (${dupes} already-merged skipped)`);
}

console.log(`BATCH: ${selected.length - queue.length} record(s), accepted ${totals.accepted}, rejected ${totals.rejected}, failed ${totals.failed}`);
console.log(`TOKENS: in=${totals.inTok} out=${totals.outTok} total=${totals.inTok + totals.outTok} (model ${MODEL})`);
