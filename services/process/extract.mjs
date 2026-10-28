#!/usr/bin/env node
// Stance extraction with Muse Spark: contract-A record -> contract-B statements.
//
//   node services/process/extract.mjs <record.json> [--merge] [--model muse-spark-1.3]
//
// Reads taxonomy/issues/people from apps/web/prototype/data. Writes
// apps/web/prototype/data/extracted/<record id>.json; with --merge also appends the
// validated statements to stances.json and any new issues to issues.json.
//
// Hard validation (a statement that fails any check is dropped and reported):
//   - person id exists in people.json
//   - issue id exists, or new_issue.parent is a real subcommittee id
//   - quote is a verbatim substring of the record content (whitespace/quote-normalised)
//   - direction agrees with score (> .15 support, < -.15 oppose, else neutral)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA = resolve(ROOT, "apps/web/prototype/data");
const args = process.argv.slice(2);
const recordPath = args.find(a => !a.startsWith("--"));
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const MODEL = opt("--model", "muse-spark-1.3"), MERGE = args.includes("--merge");
if (!recordPath) { console.error("usage: extract.mjs <record.json> [--merge]"); process.exit(1); }
if (existsSync(resolve(ROOT, ".env"))) for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split(/\r?\n/)) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const KEY = process.env.MODEL_API_KEY; if (!KEY) { console.error("MODEL_API_KEY missing"); process.exit(1); }

const load = f => JSON.parse(readFileSync(resolve(DATA, f), "utf8"));
const taxonomy = load("taxonomy.json").committees, issuesFile = load("issues.json"), peopleFile = load("people.json"), stancesFile = load("stances.json");
const record = JSON.parse(readFileSync(resolve(recordPath), "utf8"));
const subs = taxonomy.flatMap(c => (c.subcommittees.length ? c.subcommittees : [{ id: c.id, name: "(committee)" }]).map(s => ({ id: s.id, label: `${c.name} › ${s.name}` })));
const subIds = new Set(subs.map(s => s.id));
const people = peopleFile.people, byId = Object.fromEntries(people.map(p => [p.id, p]));
const issues = issuesFile.issues, issueIds = new Set(issues.map(i => i.id));

const norm = s => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
const CONTENT = norm(record.content);
const dirOf = s => s > 0.15 ? "support" : s < -0.15 ? "oppose" : "neutral";
const CONF = new Set(["low", "mid", "high", "super_high"]);

const SYSTEM = `You extract legislators' stances from U.S. congressional transcripts for an evidence-anchored public database.
For every passage where a known legislator takes a position on a policy issue, emit one statement.
Rules:
- Only legislators from the provided list, by id. Ignore the chair/clerk/witnesses ("<other>").
- Map each statement to an existing issue id when one fits. If none fits, propose new_issue {name, parent} where parent is a subcommittee id from the taxonomy.
- score in [-1, 1]: +1 strong support, -1 strong opposition, near 0 neutral/undecided. direction must match the score.
- linkage (how directly the quote addresses the issue) and llm_confidence (how sure you are of the reading) in: low, mid, high, super_high.
- quote: a VERBATIM contiguous excerpt (<= 60 words) copied exactly from the transcript. Never paraphrase. The quote must by itself justify the score.
- bill: the bill named in or around the passage, else null. rationale: one neutral sentence on why the score.
- A legislator may produce several statements if they address several issues. Do not merge different issues into one statement.
Return ONLY JSON: {"statements":[{"person":"p01","issue":"gun-policy"|null,"new_issue":{"name":"...","parent":"hsju-crime"}|null,"score":0.8,"direction":"support","linkage":"high","llm_confidence":"high","quote":"...","bill":"H.R. 4410","rationale":"..."}]}`;

const userMsg = `Taxonomy (subcommittee id: committee › subcommittee):\n${subs.map(s => `${s.id}: ${s.label}`).join("\n")}\n\nExisting issues (id: name, parent):\n${issues.map(i => `${i.id}: ${i.name} (${i.parent})`).join("\n")}\n\nLegislators (id: name, district, party):\n${people.map(p => `${p.id}: ${p.name}, ${p.district}, ${p.party}`).join("\n")}\n\nRecord ${record.id}, date ${record.hints?.date || "unknown"}, source ${record.source?.url_link}.\nTranscript:\n${record.content}\n\nExtract the statements now.`;

const r = await fetch("https://api.meta.ai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userMsg }], max_tokens: 6000, temperature: 0.1, response_format: { type: "json_object" } }) });
if (!r.ok) { console.error("HTTP", r.status, (await r.text()).slice(0, 300)); process.exit(1); }
const j = await r.json(); const raw = j.choices?.[0]?.message?.content || "";
const s0 = raw.indexOf("{"), parsed = s0 >= 0 ? (() => { try { return JSON.parse(raw.slice(s0, raw.lastIndexOf("}") + 1)); } catch { return null; } })() : null;
if (!parsed) { console.error("unparseable:", raw.slice(0, 300)); process.exit(1); }

let nextId = Math.max(0, ...stancesFile.stances.map(s => +String(s.statement_id || "").replace(/\D/g, "") || 0)) + 1;
const accepted = [], rejected = [], newIssues = [];
for (const st of parsed.statements || []) {
  const why = [];
  if (!byId[st.person]) why.push(`unknown person ${st.person}`);
  let issueId = st.issue;
  if (!issueId || !issueIds.has(issueId)) {
    if (st.new_issue && subIds.has(st.new_issue.parent) && st.new_issue.name) {
      issueId = st.new_issue.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      if (!issueIds.has(issueId)) { newIssues.push({ id: issueId, name: st.new_issue.name, parent: st.new_issue.parent }); issueIds.add(issueId); }
    } else why.push(`unknown issue ${st.issue} / bad new_issue`);
  }
  const score = Number(st.score); if (!(score >= -1 && score <= 1)) why.push("score out of range");
  // direction is DERIVED from score (the contract's rule); the model's label is advisory only
  const direction = dirOf(score), modelDir = String(st.direction || "").toLowerCase().replace(/^(opposition|opposed|opposes)$/, "oppose").replace(/^(supports|supportive)$/, "support");
  if (modelDir && modelDir !== direction) console.warn(`  ! ${st.person}: model said "${st.direction}" but score ${score} ⇒ ${direction}; using score`);
  if (!CONF.has(st.linkage) || !CONF.has(st.llm_confidence)) why.push("bad linkage/confidence");
  const q = String(st.quote || ""); if (!q || !CONTENT.includes(norm(q))) why.push("quote not verbatim in transcript");
  if (why.length) { rejected.push({ st, why }); continue; }
  accepted.push({ statement_id: `st${String(nextId++).padStart(3, "0")}`, person: st.person, issue: issueId, date: record.hints?.date || null, score: +score.toFixed(2), direction, linkage: st.linkage, llm_confidence: st.llm_confidence, quote: q.trim(), bill: st.bill || null, source: record.source?.url_link || null, record_id: record.id, model: j.model || MODEL, rationale: st.rationale || null });
}

mkdirSync(resolve(DATA, "extracted"), { recursive: true });
const outPath = resolve(DATA, "extracted", basename(recordPath).replace(/\.json$/, "") + ".extracted.json");
writeFileSync(outPath, JSON.stringify({ record_id: record.id, model: j.model || MODEL, extracted_at: new Date().toISOString(), accepted, rejected, new_issues: newIssues, usage: j.usage }, null, 2) + "\n");
console.log(`accepted ${accepted.length}, rejected ${rejected.length}, new issues ${newIssues.length} · ${j.usage?.prompt_tokens}/${j.usage?.completion_tokens} tok · ${outPath}`);
for (const a of accepted) console.log(`  ✓ ${a.statement_id} ${byId[a.person].name} → ${a.issue} ${a.direction} ${a.score} (${a.llm_confidence}) "${a.quote.slice(0, 70)}…"`);
for (const x of rejected) console.log(`  ✗ ${x.st.person} → ${x.st.issue || x.st.new_issue?.name}: ${x.why.join("; ")}`);
if (MERGE && accepted.length) {
  if (newIssues.length) { issuesFile.issues.push(...newIssues); writeFileSync(resolve(DATA, "issues.json"), JSON.stringify(issuesFile, null, 2) + "\n"); }
  stancesFile.stances.push(...accepted.map(({ rationale, ...s }) => s));
  writeFileSync(resolve(DATA, "stances.json"), JSON.stringify(stancesFile, null, 2) + "\n");
  console.log(`merged into stances.json (+${accepted.length}) and issues.json (+${newIssues.length})`);
}
