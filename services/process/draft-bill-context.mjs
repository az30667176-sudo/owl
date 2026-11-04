#!/usr/bin/env node
// Draft bill match attributes (#32): short_context (<=30 words, neutral) +
// binary_question (exactly one support + one oppose option) per bill.
//
//   node services/process/draft-bill-context.mjs <data-dir> [--top 20] [--only hr1-119,...]
//     [--csv <csv-drop>] [--out <draft-file>] [--merge [--merge-all]] [--redo]
//     [--concurrency 3] [--dry-run] [--model m] [--base-url u] [--max-tokens N]
//
// Draft mode (default) writes a staging file (default <data-dir>/bill_context.draft.json)
// WITHOUT touching bills.json. A human reviews every draft; --merge applies only
// approved entries (approved:true, or everything with --merge-all). --csv points at
// the ingest drop for policy-area/subject context behind vague titles ("SCORE Act").
// Zero dependencies (Node >= 18). Auth: MUSE_API_KEY (or MODEL_API_KEY), from <repo>/.env.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

// ---------- pure helpers (tested) ----------

export const wordCount = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

export function buildPrompt(bill, issueNames, subjects) {
  const system = `You write neutral voter-guide entries for U.S. House bills for ordinary readers: short everyday words, one idea per clause, no jargon without explanation. A non-expert must get it on first read. For the bill below, produce:
1. short_context: ONE sentence, at most 30 words, plain language, strictly neutral. Say what the bill would DO (mechanism + target), never whether it is good or bad. Banned adjectives: common-sense, radical, wasteful, critical, bipartisan, historic, landmark.
2. Either binary_question: one question a voter can answer from the context, plus exactly two options: one {"stance":"support"} and one {"stance":"oppose"}. Both labels must be fair descriptions of that side's position (no strawmen, no loaded verbs). Labels at most 15 words each.
   Or, when the bill genuinely cannot be reduced to one fair question (omnibus, many unrelated titles, pure procedural vehicle): {"complex_bill":true} with a short_context of up to 50 words and NO binary_question. Use this escape hatch honestly but sparingly: most bills have one clear thrust.
Return ONLY the JSON object: no markdown fences, no commentary.
{"short_context":"...","binary_question":{"question":"...","options":[{"stance":"support","label":"..."},{"stance":"oppose","label":"..."}]}} or {"complex_bill":true,"short_context":"...","binary_question":null}`;
  const lines = [`Number: ${bill.number}`, `Title: ${bill.title || "unknown"}`];
  if (bill.status) lines.push(`Status: ${bill.status}`);
  if (bill.last_action?.text) lines.push(`Latest action: ${bill.last_action.text}`);
  if (subjects) lines.push(`Subjects: ${subjects}`);
  if (issueNames?.length) lines.push(`Issues: ${issueNames.join("; ")}`);
  return { system, user: lines.join("\n") + "\n\nDraft the entry now." };
}

// Contract-shape validation for one draft. Returns a list of problems (empty = valid).
// Mirrors validate.mjs: 30-word cap (50 for complex bills), complex bills carry
// no question, simple bills must carry a balanced one.
export function validateDraft(d) {
  const problems = [];
  if (!d || typeof d !== "object") return ["not an object"];
  const cap = d.complex_bill ? 50 : 30;
  if (!d.short_context || typeof d.short_context !== "string") problems.push("short_context missing");
  else {
    if (wordCount(d.short_context) > cap) problems.push(`short_context exceeds ${cap} words (${wordCount(d.short_context)})`);
    if (d.short_context.length > 350) problems.push("short_context exceeds 350 chars");
  }
  if (d.complex_bill && d.binary_question != null) problems.push("complex bills must not carry binary_question");
  const q = d.binary_question;
  if (!q || typeof q !== "object") {
    if (!d.complex_bill) problems.push("binary_question missing");
    return problems;
  } else {
    if (!q.question || typeof q.question !== "string") problems.push("binary_question.question missing");
    else if (q.question.length > 200) problems.push("question exceeds 200 chars");
    if (!Array.isArray(q.options) || q.options.length !== 2) problems.push("options must be exactly 2");
    else {
      for (const o of q.options) {
        if (!o || (o.stance !== "support" && o.stance !== "oppose")) problems.push("option stance must be support|oppose");
        if (!o || typeof o.label !== "string" || !o.label.trim()) problems.push("option label missing");
        else if (o.label.length > 120) problems.push("option label exceeds 120 chars");
      }
      const sorted = q.options.map((o) => o && o.stance).sort().join(",");
      if (sorted !== "oppose,support") problems.push("options must be exactly one support and one oppose");
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
  const TOP = parseInt(opt("--top", "20"), 10);
  const ONLY = opt("--only") ? new Set(opt("--only").split(",").map((s) => s.trim()).filter(Boolean)) : null;
  const CSV = opt("--csv") ? resolve(opt("--csv")) : null;
  const OUT = resolve(opt("--out", join(dataDir, "bill_context.draft.json")));
  const MERGE = flag("--merge"), MERGE_ALL = flag("--merge-all"), REDO = flag("--redo");
  const CONC = Math.max(1, parseInt(opt("--concurrency", "3"), 10));
  const DRY = flag("--dry-run");
  const MODEL = opt("--model", "muse-spark-1.3");
  const BASE_URL = opt("--base-url", process.env.MODEL_BASE_URL || "https://api.meta.ai/v1");
  const MAX_TOK = parseInt(opt("--max-tokens", "3000"), 10);

  const load = (f) => JSON.parse(readFileSync(join(dataDir, f), "utf8"));
  const billsFile = load("bills.json");
  const bills = billsFile.bills;
  const issueName = Object.fromEntries(load("issues.json").issues.map((i) => [i.id, i.name]));
  const stances = load("stances.json").stances;

  // Optional CSV enrichment: policy area + legislative subjects per bill.
  let csvInfo = new Map();
  if (CSV) {
    const { parseCsv } = await import("../ingest/csv-to-json.mjs");
    for (const r of parseCsv(readFileSync(join(CSV, "bills.csv"), "utf8"))) {
      const subj = [r.policy_area, ...(r.legislative_subjects || "").split("|").slice(0, 6)].filter(Boolean).join("; ");
      csvInfo.set(r.bill_id, subj);
    }
  }

  // ---- merge mode: apply reviewed drafts, no API calls ----
  if (MERGE) {
    if (!existsSync(OUT)) { console.error(`draft file missing: ${OUT}`); process.exit(1); }
    const drafts = JSON.parse(readFileSync(OUT, "utf8")).drafts || [];
    const byId = Object.fromEntries(bills.map((b) => [b.bill_id, b]));
    let applied = 0, skipped = 0;
    for (const d of drafts) {
      const b = byId[d.bill_id];
      if (!b) { console.log(`  ! ${d.bill_id}: no such bill, skipped`); skipped++; continue; }
      if (!MERGE_ALL && !d.approved) { skipped++; continue; }
      const problems = validateDraft(d);
      if (problems.length || d.error) { console.log(`  ! ${d.bill_id}: invalid (${d.error || problems.join("; ")}), skipped`); skipped++; continue; }
      if (d.complex_bill) {
        b.complex_bill = true;
        delete b.binary_question;
      } else {
        delete b.complex_bill;
        b.binary_question = d.binary_question;
      }
      b.short_context = d.short_context.trim();
      applied++;
    }
    writeFileSync(join(dataDir, "bills.json"), JSON.stringify(billsFile, null, 2) + "\n");
    console.log(`merged ${applied} bill(s) into bills.json, skipped ${skipped}`);
    process.exit(0);
  }

  // ---- draft mode: pick target bills ----
  const counts = new Map();
  for (const s of stances) if (s.bill_id) counts.set(s.bill_id, (counts.get(s.bill_id) || 0) + 1);
  let targets = [...bills]
    .sort((a, b) => (counts.get(b.bill_id) || 0) - (counts.get(a.bill_id) || 0))
    .slice(0, ONLY ? bills.length : TOP)
    .filter((b) => !ONLY || ONLY.has(b.bill_id))
    .filter((b) => REDO || !(b.short_context && (b.binary_question || b.complex_bill)));
  // resume: keep already-drafted entries from a previous run
  const prev = new Map();
  if (existsSync(OUT) && !REDO) {
    for (const d of JSON.parse(readFileSync(OUT, "utf8")).drafts || []) prev.set(d.bill_id, d);
  }
  const fresh = targets.filter((b) => !prev.has(b.bill_id) || prev.get(b.bill_id).error);
  console.log(`target: ${targets.length} bill(s) (${fresh.length} to draft, ${targets.length - fresh.length} resumed)`);

  if (DRY) {
    for (const b of fresh.slice(0, 2)) {
      const { system, user } = buildPrompt(b, (b.issue_ids || []).map((i) => issueName[i]).filter(Boolean), csvInfo.get(b.bill_id));
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
    const names = (b.issue_ids || []).map((i) => issueName[i]).filter(Boolean);
    const { system, user } = buildPrompt(b, names, csvInfo.get(b.bill_id));
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
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const j = await r.json();
    const raw = j.choices?.[0]?.message?.content || "";
    let parsed = null;
    const s0 = raw.indexOf("{");
    if (s0 >= 0) try { parsed = JSON.parse(raw.slice(s0, raw.lastIndexOf("}") + 1)); } catch { /* fallthrough */ }
    if (!parsed) {
      if (attempt <= 2) return draftOne(b, attempt + 1);
      return { error: `unparseable (finish=${j.choices?.[0]?.finish_reason}, raw=${JSON.stringify(raw.slice(0, 100))})` };
    }
    const problems = validateDraft(parsed);
    if (problems.length) {
      if (attempt <= 2) return draftOne(b, attempt + 1);
      return { error: problems.join("; ") };
    }
    return {
      short_context: parsed.short_context.trim(),
      binary_question: parsed.binary_question ?? null,
      ...(parsed.complex_bill ? { complex_bill: true } : {}),
      error: null,
    };
  }

  // Keep EVERY previously good draft, not just the current targets: a scoped
  // re-run (--only) must not discard the rest of the staging file.
  const kept = [...prev.values()].filter((d) => !d.error);
  const all = [...kept];
  const meta = {
    description: "Staging: LLM-drafted bill match attributes. Human review required; merge only approved entries.",
    model: MODEL, at: new Date().toISOString().slice(0, 10),
    prompt_sha: createHash("sha256").update(buildPrompt({ number: "", title: "" }).system).digest("hex").slice(0, 12),
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
