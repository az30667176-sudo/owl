#!/usr/bin/env node
// Draft per-option tradeoffs for bill binary questions (#37): each option gains
// a <=25-word plain-language "what you give up by choosing THAT option" string.
//
//   node services/process/draft-tradeoffs.mjs <data-dir> [--top 765] [--only hr1-119,...]
//     [--out <draft-file>] [--merge [--merge-all]] [--redo]
//     [--concurrency 10] [--dry-run] [--model m] [--base-url u] [--max-tokens N]
//
// Draft mode (default) writes a staging file (default <data-dir>/tradeoffs.draft.json)
// WITHOUT touching bills.json. A human reviews every draft; --merge applies only
// approved entries (approved:true, or everything with --merge-all).
// Zero dependencies (Node >= 18). Auth: MUSE_API_KEY (or MODEL_API_KEY), from <repo>/.env.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

// ---------- pure helpers (tested) ----------

export const wordCount = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

export function buildTradeoffPrompt(bill) {
  const q = bill.binary_question;
  const system = `You are helping compile a neutral voter guide to bills before the U.S. Congress: a civic reference describing what legislation would do, written for ordinary readers. You are describing legislation and its policy tradeoffs, not providing instructions, advice, or advocacy about any underlying substance, product, or activity. Write tradeoff lines with short everyday words, no jargon, no party framing. For the bill context and binary question below, write ONE tradeoff line per option: what the voter gives up by choosing THAT option (the cost of their own side, not an attack on the other side). Each tradeoff: ONE sentence, at most 25 words, plain language, strictly neutral. Banned adjectives: common-sense, radical, wasteful, critical, bipartisan, historic, landmark.
Return ONLY the JSON object: no markdown fences, no commentary.
{"tradeoffs":{"support":"...","oppose":"..."}}`;
  const opts = q.options.map((o) => `[${o.stance}] ${o.label}`).join("\n");
  const user = `Context: ${bill.short_context}\nQuestion: ${q.question}\nOptions:\n${opts}\n\nDraft the tradeoffs now.`;
  return { system, user };
}

// Contract-shape validation for one draft. Returns a list of problems (empty = valid).
// Mirrors validate.mjs: each tradeoff <= 25 words and <= 200 chars.
export function validateTradeoffDraft(d) {
  const problems = [];
  if (!d || typeof d !== "object") return ["not an object"];
  const t = d.tradeoffs;
  if (!t || typeof t !== "object") return ["tradeoffs missing"];
  for (const stance of ["support", "oppose"]) {
    const s = t[stance];
    if (!s || typeof s !== "string" || !s.trim()) problems.push(`${stance} tradeoff missing`);
    else {
      if (wordCount(s) > 25) problems.push(`${stance} tradeoff exceeds 25 words (${wordCount(s)})`);
      if (s.length > 200) problems.push(`${stance} tradeoff exceeds 200 chars`);
    }
  }
  return problems;
}

// ---------- live run (main only) ----------

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (n, d = null) => {
    const i = args.indexOf(n);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : d;
  };
  const flag = (n) => args.includes(n);
  const dataDir = resolve(args.find((a) => !a.startsWith("--")) || join(ROOT, "data"));
  const TOP = parseInt(opt("--top", "765"), 10);
  const ONLY = opt("--only") ? new Set(opt("--only").split(",").map((s) => s.trim()).filter(Boolean)) : null;
  const OUT = resolve(opt("--out", join(dataDir, "tradeoffs.draft.json")));
  const MERGE = flag("--merge"), MERGE_ALL = flag("--merge-all"), REDO = flag("--redo");
  const CONC = Math.max(1, parseInt(opt("--concurrency", "10"), 10));
  const DRY = flag("--dry-run");
  const MODEL = opt("--model", "muse-spark-1.3");
  const BASE_URL = opt("--base-url", process.env.MODEL_BASE_URL || "https://api.meta.ai/v1");
  const MAX_TOK = parseInt(opt("--max-tokens", "1000"), 10);

  const load = (f) => JSON.parse(readFileSync(join(dataDir, f), "utf8"));
  const billsFile = load("bills.json");
  const bills = billsFile.bills;

  // ---- merge mode: apply reviewed drafts, no API calls ----
  if (MERGE) {
    if (!existsSync(OUT)) { console.error(`draft file missing: ${OUT}`); process.exit(1); }
    const drafts = JSON.parse(readFileSync(OUT, "utf8")).drafts || [];
    const byId = Object.fromEntries(bills.map((b) => [b.bill_id, b]));
    let applied = 0, skipped = 0;
    for (const d of drafts) {
      const b = byId[d.bill_id];
      if (!b || !b.binary_question) { console.log(`  ! ${d.bill_id}: no such bill/question, skipped`); skipped++; continue; }
      if (!MERGE_ALL && !d.approved) { skipped++; continue; }
      const problems = validateTradeoffDraft(d);
      if (problems.length || d.error) { console.log(`  ! ${d.bill_id}: invalid (${d.error || problems.join("; ")}), skipped`); skipped++; continue; }
      for (const o of b.binary_question.options) {
        if (d.tradeoffs[o.stance]) o.tradeoff = d.tradeoffs[o.stance].trim();
      }
      applied++;
    }
    writeFileSync(join(dataDir, "bills.json"), JSON.stringify(billsFile, null, 2) + "\n");
    console.log(`merged ${applied} bill(s) into bills.json, skipped ${skipped}`);
    process.exit(0);
  }

  // ---- draft mode: bills with a question but missing tradeoffs ----
  const missing = (b) => b.binary_question && b.binary_question.options.some((o) => !o.tradeoff);
  let targets = bills.filter((b) => (!ONLY || ONLY.has(b.bill_id)) && (REDO ? !!b.binary_question : missing(b)));
  targets = targets.slice(0, ONLY ? targets.length : TOP);
  // resume: keep already-drafted entries from a previous run
  const prev = new Map();
  if (existsSync(OUT) && !REDO) {
    for (const d of JSON.parse(readFileSync(OUT, "utf8")).drafts || []) prev.set(d.bill_id, d);
  }
  const fresh = targets.filter((b) => !prev.has(b.bill_id) || prev.get(b.bill_id).error);
  console.log(`target: ${targets.length} bill(s) (${fresh.length} to draft, ${targets.length - fresh.length} resumed)`);

  if (DRY) {
    for (const b of fresh.slice(0, 2)) {
      const { system, user } = buildTradeoffPrompt(b);
      console.log(`--- ${b.bill_id} (${b.number}) ---\nsystem[${system.length}] user[${user.length}]\n${user}\n`);
    }
    console.log(`dry run: ${fresh.length} draft(s) ready, no API calls made`);
    process.exit(0);
  }

  try {
    for (const line of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch { /* no .env; environment must provide the key */ }
  const KEY = process.env.MUSE_API_KEY || process.env.MODEL_API_KEY;
  if (!KEY) { console.error("MUSE_API_KEY missing"); process.exit(1); }

  async function draftOne(b, attempt = 1) {
    const { system, user } = buildTradeoffPrompt(b);
    let r;
    try {
      r = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }],
          max_tokens: MAX_TOK, temperature: 0.2, reasoning_effort: "low", response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(120000),
      });
    } catch (e) {
      return { error: `fetch: ${e.message}` };
    }
    if ((r.status === 429 || r.status >= 500) && attempt <= 2) {
      await new Promise((res) => setTimeout(res, 5000));
      return draftOne(b, attempt + 1);
    }
    if (!r.ok) {
      let detail = "";
      try { detail = ` ${(await r.text()).slice(0, 200)}`; } catch { /* ignore */ }
      return { error: `HTTP ${r.status}${detail}` };
    }
    const j = await r.json();
    const raw = j.choices?.[0]?.message?.content || "";
    let parsed = null;
    const s0 = raw.indexOf("{");
    if (s0 >= 0) try { parsed = JSON.parse(raw.slice(s0, raw.lastIndexOf("}") + 1)); } catch { /* fallthrough */ }
    if (!parsed) {
      if (attempt <= 2) return draftOne(b, attempt + 1);
      return { error: `unparseable (finish=${j.choices?.[0]?.finish_reason}, raw=${JSON.stringify(raw.slice(0, 100))})` };
    }
    const problems = validateTradeoffDraft(parsed);
    if (problems.length) {
      if (attempt <= 2) return draftOne(b, attempt + 1);
      return { error: problems.join("; ") };
    }
    return { tradeoffs: { support: parsed.tradeoffs.support.trim(), oppose: parsed.tradeoffs.oppose.trim() }, error: null };
  }

  // Keep EVERY previously good draft, not just the current targets: a scoped
  // re-run (--only) must not discard the rest of the staging file.
  const kept = [...prev.values()].filter((d) => !d.error);
  const all = [...kept];
  const meta = {
    description: "Staging: LLM-drafted per-option tradeoffs. Human review required; merge only approved entries.",
    model: MODEL, at: new Date().toISOString().slice(0, 10),
    prompt_sha: createHash("sha256").update(buildTradeoffPrompt({ short_context: "", binary_question: { question: "", options: [] } }).system).digest("hex").slice(0, 12),
  };
  mkdirSync(dirname(OUT), { recursive: true });
  const writeOut = () => writeFileSync(OUT, JSON.stringify({ _meta: meta, drafts: all }, null, 2) + "\n");
  for (let i = 0; i < fresh.length; i += CONC) {
    const chunk = fresh.slice(i, i + CONC);
    const results = await Promise.all(chunk.map((b) => draftOne(b)));
    results.forEach((r, k) => {
      const b = chunk[k];
      all.push({ bill_id: b.bill_id, number: b.number, approved: false, ...r });
      console.log(`  ${r.error ? "✗" : "✓"} ${b.bill_id} ${b.number}${r.error ? ` (${r.error.slice(0, 80)})` : ""}`);
    });
    writeOut(); // checkpoint every chunk: kills and crashes lose at most one chunk
    console.log(`  -- ${Math.min(i + CONC, fresh.length)}/${fresh.length} --`);
  }
  const ok = all.filter((d) => !d.error).length;
  console.log(`wrote ${OUT}: ${ok}/${all.length} valid drafts (review, set approved, re-run with --merge)`);
}
