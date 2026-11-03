#!/usr/bin/env node
// Blind scoring audit (#30): re-score a sample of speech rows with the speaker's
// name and party hidden, then compare blind vs published scores. Measures whether
// the scorer reads what the member said rather than what it expects of their party.
//
//   node services/process/audit/blind-scoring.mjs <data-dir> [--n 100] [--seed 30] [--limit K]
//     [--party R,D] [--concurrency 3] [--dry-run] [--out <path>] [--model m] [--base-url u]
//
// Writes <data-dir>/audit/blind-scoring.json (seeded sample => reproducible) and
// prints a short report. Pure helpers are exported for tests; the live run needs
// model access. Auth: MUSE_API_KEY (or MODEL_API_KEY), optionally from <repo>/.env.
// Zero dependencies (Node >= 18).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { resolveScore } from "../scoring.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const dirOf = (s) => (s > 0.15 ? "support" : s < -0.15 ? "oppose" : "neutral");
const round4 = (x) => Math.round(x * 10000) / 10000;

// ---------- pure helpers (tested) ----------

// Deterministic PRNG (mulberry32) + without-replacement sample.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function seededSample(rows, n, seed) {
  const rand = mulberry32(seed);
  const pool = [...rows];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(n, pool.length));
}

// Replace the speaker's full, first, and last name with [SPEAKER]. Matching is
// word-boundary and case-insensitive, but an all-lowercase match is kept: it is
// an ordinary word ("banks"), not the proper noun ("Banks"). Over-blinding a
// sentence-initial lookalike is accepted; under-blinding is not.
export function scrubSpeaker(text, fullName) {
  const parts = String(fullName || "").replace(/^\s*Rep\.\s+/i, "").trim().split(/\s+/).filter(Boolean);
  const variants = [...new Set([parts.join(" "), parts[0], parts[parts.length - 1]])].filter((v) => v && v.length > 1);
  let out = String(text || "");
  for (const v of variants.sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    out = out.replace(re, (m) => (m === m.toLowerCase() ? m : "[SPEAKER]"));
  }
  return out;
}

// One-quote blind re-score prompt. Same scoring convention as the production prompt
// that generated the published scores (raw -1..1 number), but no legislator list
// and no speaker attribution: the model sees only the words. The toward-issue rule
// is spelled out because it is the convention the published data follows: without
// it the model scores toward the bill instead and the audit measures prompt
// ambiguity rather than bias (verified: agreement 0/3 before, see trial notes).
export function blindPrompt(quote, issueName, bill) {
  const system = `You re-score single quoted utterances from U.S. congressional transcripts to audit an evidence-anchored public database. The speaker's identity is deliberately withheld: score only what the words say, never what you might expect of any party or person.\nRules:\n- Score the speaker's stance TOWARD THE NAMED ISSUE, not toward any bill. A speaker who attacks a bill for harming the issue SUPPORTS the issue (positive score); a speaker who praises a bill for advancing the issue also SUPPORTS it. Direction follows the issue.\n- score in [-1, 1]: +1 strong support, -1 strong opposition, near 0 neutral/undecided. direction must match the score.\n- First write one neutral sentence (rationale) on why the score, then the score.\nReturn ONLY the JSON object: no markdown fences, no commentary.\n{"rationale":"...","direction":"support"|"oppose"|"neutral","score":0.0}`;
  const user = `Issue: ${issueName}\nBill: ${bill || "unknown"}\nQuote:\n${quote}\n\nScore this quote now.`;
  return { system, user };
}

// Summarise scored rows [{statement_id, party, published, blind}]; blind null =
// failed call, excluded from all means. Means rounded to 4dp for reporting.
export function summarize(rows) {
  const scored = rows.filter((r) => r.blind !== null && r.blind !== undefined);
  const withDiff = scored.map((r) => ({
    ...r,
    abs_diff: Math.abs(r.blind - r.published),
    signed_diff: r.blind - r.published,
    agree: dirOf(r.blind) === dirOf(r.published),
  }));
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const byParty = {};
  for (const r of withDiff) {
    (byParty[r.party || "?"] ||= []).push(r);
  }
  const partySummary = {};
  for (const [p, rs] of Object.entries(byParty)) {
    partySummary[p] = {
      n: rs.length,
      mean_abs_diff: round4(mean(rs.map((r) => r.abs_diff))),
      mean_signed_diff: round4(mean(rs.map((r) => r.signed_diff))),
      direction_agreement: round4(mean(rs.map((r) => (r.agree ? 1 : 0)))),
    };
  }
  return {
    n: scored.length,
    failed: rows.length - scored.length,
    mean_abs_diff: round4(mean(withDiff.map((r) => r.abs_diff))),
    mean_signed_diff: round4(mean(withDiff.map((r) => r.signed_diff))),
    direction_agreement: round4(mean(withDiff.map((r) => (r.agree ? 1 : 0)))),
    by_party: partySummary,
    top10: [...withDiff].sort((a, b) => b.abs_diff - a.abs_diff).slice(0, 10),
  };
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
  const N = parseInt(opt("--n", "100"), 10);
  const SEED = parseInt(opt("--seed", "30"), 10);
  const PARTIES = opt("--party") ? new Set(opt("--party").split(",").map((s) => s.trim()).filter(Boolean)) : null;
  const LIMIT = opt("--limit") ? parseInt(opt("--limit"), 10) : Infinity;
  const CONC = Math.max(1, parseInt(opt("--concurrency", "3"), 10));
  const DRY = flag("--dry-run");
  const MODEL = opt("--model", "muse-spark-1.3");
  const BASE_URL = opt("--base-url", process.env.MODEL_BASE_URL || "https://api.meta.ai/v1");
  const MAX_TOK = parseInt(opt("--max-tokens", "4000"), 10);
  const REASONING = opt("--reasoning-effort", "low");
  const OUT = resolve(opt("--out", join(dataDir, "audit", "blind-scoring.json")));

  const load = (f) => JSON.parse(readFileSync(join(dataDir, f), "utf8"));
  const people = Object.fromEntries(load("people.json").people.map((p) => [p.id, p]));
  const issueName = Object.fromEntries(load("issues.json").issues.map((i) => [i.id, i.name]));
  const speech = load("stances.json").stances.filter(
    (s) => s.kind === "speech" || (!s.kind && String(s.model || "").startsWith("muse-spark"))
  ).filter((s) => !PARTIES || PARTIES.has(people[s.person]?.party));
  const sample = seededSample(speech, N, SEED).slice(0, LIMIT);
  console.log(`sample: ${sample.length} of ${speech.length} speech rows (n=${N}, seed=${SEED}${Number.isFinite(LIMIT) ? `, limit=${LIMIT}` : ""})`);

  if (DRY) {
    for (const s of sample.slice(0, 2)) {
      const { system, user } = blindPrompt(scrubSpeaker(s.quote, people[s.person]?.name), issueName[s.issue], s.bill);
      console.log(`--- ${s.statement_id} (${people[s.person]?.name}, ${people[s.person]?.party}) ---`);
      console.log(`system[${system.length} chars] user[${user.length} chars]\n${user}\n`);
    }
    console.log(`dry run: ${sample.length} prompt(s) ready, no API calls made`);
    process.exit(0);
  }

  try {
    const envPath = join(ROOT, ".env");
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch { /* no .env; environment must provide the key */ }
  const KEY = process.env.MUSE_API_KEY || process.env.MODEL_API_KEY;
  if (!KEY) { console.error("MUSE_API_KEY missing"); process.exit(1); }

  async function rescore(s, attempt = 1) {
    const quote = scrubSpeaker(s.quote, people[s.person]?.name);
    const { system, user } = blindPrompt(quote, issueName[s.issue] || s.issue, s.bill);
    let r;
    try {
      r = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }],
          max_tokens: MAX_TOK, temperature: 0.1, reasoning_effort: REASONING, response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(120000),
      });
    } catch (e) {
      return { blind: null, error: `fetch: ${e.message}` };
    }
    if ((r.status === 429 || r.status >= 500) && attempt <= 2) {
      await new Promise((res) => setTimeout(res, 5000));
      return rescore(s, attempt + 1);
    }
    if (!r.ok) return { blind: null, error: `HTTP ${r.status}` };
    const j = await r.json();
    const raw = j.choices?.[0]?.message?.content || "";
    const finish = j.choices?.[0]?.finish_reason || "?";
    let parsed = null;
    const s0 = raw.indexOf("{");
    if (s0 >= 0) try { parsed = JSON.parse(raw.slice(s0, raw.lastIndexOf("}") + 1)); } catch { /* fallthrough */ }
    if (!parsed) return { blind: null, error: `unparseable model output (finish=${finish}, raw=${JSON.stringify(raw.slice(0, 120))})` };
    const blind = resolveScore(parsed);
    if (blind === null) return { blind: null, error: `score unresolvable (raw=${JSON.stringify(raw.slice(0, 120))})` };
    return { blind: +blind.toFixed(4), error: null };
  }

  const rows = [];
  for (let i = 0; i < sample.length; i += CONC) {
    const chunk = sample.slice(i, i + CONC);
    const results = await Promise.all(chunk.map((s) => rescore(s)));
    results.forEach(({ blind, error }, k) => {
      const s = chunk[k];
      rows.push({
        statement_id: s.statement_id, person: s.person, party: people[s.person]?.party || "?",
        issue: s.issue, quote: s.quote, published: s.score, blind, error,
      });
    });
    console.log(`  scored ${Math.min(i + CONC, sample.length)}/${sample.length}`);
  }

  const summary = summarize(rows.map((r) => ({ statement_id: r.statement_id, party: r.party, published: r.published, blind: r.blind })));
  const out = {
    _meta: {
      description: "Blind scoring audit: the same rubric re-scores sampled quotes with speaker name/party hidden.",
      model: MODEL, seed: SEED, n: N, at: new Date().toISOString().slice(0, 10),
      prompt_sha: createHash("sha256").update(blindPrompt("", "", "").system).digest("hex").slice(0, 12),
    },
    summary,
    rows,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

  console.log(`\n# Blind scoring audit (model=${MODEL}, seed=${SEED})`);
  console.log(`- scored ${summary.n}, failed ${summary.failed}`);
  console.log(`- mean |blind - published|: ${summary.mean_abs_diff} (signed: ${summary.mean_signed_diff})`);
  console.log(`- direction agreement: ${summary.direction_agreement}`);
  for (const [p, g] of Object.entries(summary.by_party)) {
    console.log(`- party ${p}: n=${g.n} mean_abs_diff=${g.mean_abs_diff} signed=${g.mean_signed_diff} agreement=${g.direction_agreement}`);
  }
  console.log(`- largest disagreements:`);
  for (const t of summary.top10) {
    console.log(`  ${t.statement_id} (${t.party}): published ${t.published} -> blind ${t.blind}`);
  }
  console.log(`wrote ${OUT}`);
}
