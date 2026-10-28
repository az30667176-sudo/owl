#!/usr/bin/env node
// Generate per-legislator AI summaries with Muse Spark (Meta Model API).
//
//   node services/process/summarize.mjs [--only p09,p04] [--model muse-spark-1.3] [--dry]
//
// Reads  data/{people,issues,taxonomy,stances}.json
// Writes data/summaries.json  (merging with existing entries)
//
// Contract (see data/README.md): 2-4 neutral sentences, every sentence
// cites >= 1 statement_id that belongs to this legislator. Sentences whose citations fail
// validation are dropped; a legislator with zero valid sentences is skipped and reported.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA = resolve(ROOT, "data");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const ONLY = opt("--only", "") ? opt("--only").split(",") : null;
const MODEL = opt("--model", "muse-spark-1.3");
const DRY = args.includes("--dry");

// .env loader (no dependency)
if (existsSync(resolve(ROOT, ".env"))) for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.MODEL_API_KEY;
if (!KEY) { console.error("MODEL_API_KEY missing (put it in .env)"); process.exit(1); }

const load = f => JSON.parse(readFileSync(resolve(DATA, f), "utf8"));
const people = load("people.json").people, issues = load("issues.json").issues, taxonomy = load("taxonomy.json").committees, stances = load("stances.json").stances;
const subName = {}; for (const c of taxonomy) { subName[c.id] = c.name; for (const s of c.subcommittees) subName[s.id] = `${c.name} › ${s.name}`; }
const issueById = Object.fromEntries(issues.map(i => [i.id, i]));
const outPath = resolve(DATA, "summaries.json");
const out = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : { _meta: {}, summaries: {} };
out._meta = { ...out._meta, description: out._meta.description || "Per-legislator AI summaries generated offline by Muse Spark.", mock: false, generator: "services/process/summarize.mjs" };

const SYSTEM = `You write neutral, evidence-bound profiles of U.S. legislators for a public accountability tool.
Rules:
- Output 2 to 4 sentences. Each sentence must be grounded ONLY in the statements provided and must cite the statement ids it relies on.
- Describe the stance pattern (which issues, which direction), consistency over time (note any change of direction and when), and where the legislator diverges from their party if that is visible in the data.
- Neutral newsroom register. No adjectives of praise or blame ("brave", "flip-flopper", "extreme"). Say "moved from opposing to supporting", not "reversed course".
- Never infer motives or facts not in the statements.
- Return ONLY JSON: {"sentences":[{"text":"...","cites":["st001","st002"]}]}`;

// First balanced {...} object in the text (models sometimes wrap JSON in prose or fences).
function extractJson(text) {
  const s = text.indexOf("{"); if (s < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = s; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === "{") depth++; else if (ch === "}") { depth--; if (depth === 0) { try { return JSON.parse(text.slice(s, i + 1)); } catch { return null; } } }
  }
  return null;
}

async function summarize(p) {
  const mine = stances.filter(s => s.person === p.id).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!mine.length) return { skip: "no statements" };
  const partyMean = {}; for (const s of stances) { if (s.person === p.id) continue; const q = people.find(x => x.id === s.person); if (!q || q.party !== p.party) continue; (partyMean[s.issue] ??= []).push(s.score); }
  const lines = mine.map(s => `[${s.statement_id}] ${s.date} | issue: ${issueById[s.issue].name} (${subName[issueById[s.issue].parent]}) | score ${s.score.toFixed(2)} (${s.direction}, confidence ${s.llm_confidence}) | bill: ${s.bill || "-"} | quote: "${s.quote}"`);
  const party = p.party === "D" ? "Democrat" : p.party === "R" ? "Republican" : "Independent";
  const pm = Object.entries(partyMean).map(([i, xs]) => `${issueById[i].name}: ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)}`).join("; ");
  const user = `Legislator: ${p.name} (${p.district}, ${party}, in office since ${p.since}).\n\nStatements (chronological):\n${lines.join("\n")}\n\nAverage score of other ${party}s in this dataset on the same issues: ${pm || "n/a"}.\n\nWrite the profile JSON now.`;
  if (DRY) { console.log(`--- ${p.id} prompt (${user.length} chars)`); return { skip: "dry" }; }
  const r = await fetch("https://api.meta.ai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }], max_tokens: 4000, temperature: 0.2, response_format: { type: "json_object" } }) });
  if (!r.ok) throw new Error(`${p.id}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json(); const raw = j.choices?.[0]?.message?.content || "", finish = j.choices?.[0]?.finish_reason;
  const parsed = extractJson(raw);
  if (!parsed) return { skip: `unparseable (finish=${finish}, ${raw.length} chars): ${raw.slice(0, 160)}…${raw.slice(-60)}` };
  const valid = new Set(mine.map(s => s.statement_id));
  const sentences = (parsed.sentences || []).map(s => ({ text: String(s.text || "").trim(), cites: (s.cites || []).filter(c => valid.has(c)) })).filter(s => s.text && s.cites.length);
  const dropped = (parsed.sentences || []).length - sentences.length;
  if (!sentences.length) return { skip: "no sentence survived citation validation" };
  return { ok: { model: j.model || MODEL, generated_at: new Date().toISOString().slice(0, 10), sentences }, dropped, usage: j.usage };
}

let spent = 0;
for (const p of people) {
  if (ONLY && !ONLY.includes(p.id)) continue;
  try {
    const res = await summarize(p);
    if (res.skip) { console.log(`skip ${p.id} (${p.name}): ${res.skip}`); continue; }
    out.summaries[p.id] = res.ok;
    const u = res.usage || {}; spent += (u.prompt_tokens || 0) * 1.25e-6 + (u.completion_tokens || 0) * 4.25e-6;
    console.log(`ok   ${p.id} (${p.name}): ${res.ok.sentences.length} sentences${res.dropped ? `, ${res.dropped} dropped for bad citations` : ""} · ${u.prompt_tokens}/${u.completion_tokens} tok`);
  } catch (e) { console.error(`fail ${p.id}: ${e.message}`); }
}
if (!DRY) { writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n"); console.log(`wrote ${outPath} · est. cost $${spent.toFixed(3)}`); }
