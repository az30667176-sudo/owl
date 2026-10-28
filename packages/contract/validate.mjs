#!/usr/bin/env node
// OWL contract validator. Zero dependencies (Node >= 18).
//
//   node packages/contract/validate.mjs <data dir>                 contract B: taxonomy/issues/people/stances[/summaries].json
//   node packages/contract/validate.mjs --record <file.json> ...   contract A: one or more records
//   options: --records <dir>   contract-A records used to check quotes verbatim (by record_id)
//            --strict          treat warnings as errors (CI uses this for non-mock data)
//
// Implements the subset of JSON Schema the contracts use (type, enum, const, required,
// additionalProperties, pattern, min/max, minLength/maxLength, minItems/maxItems, items,
// properties, additionalProperties-as-schema, allOf, $ref to #/$defs and <file>#/$defs),
// then the cross-file rules the schemas cannot express.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = { records: null, strict: false, recordFiles: [], dir: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--records") opt.records = args[++i];
  else if (a === "--strict") opt.strict = true;
  else if (a === "--record") opt.recordFiles.push(args[++i]);
  else opt.dir = a;
}
if (!opt.dir && !opt.recordFiles.length) { console.error("usage: validate.mjs <data dir> | --record <file>"); process.exit(2); }

const errors = [], warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// ---------- minimal JSON-Schema evaluator ----------
const schemaCache = {};
const loadSchema = (name) => (schemaCache[name] ??= readJson(join(HERE, name)));
const FORMATS = {
  date: (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)),
  uri: (s) => { try { new URL(s); return true; } catch { return false; } },
};
function resolveRef(ref, root) {
  const [file, ptr] = ref.split("#");
  const base = file ? loadSchema(file) : root;
  return ptr.split("/").filter(Boolean).reduce((o, k) => o[k], base);
}
function typeOf(v) { return v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v; }
function check(v, s, root, path, out) {
  if (s.$ref) { const t = resolveRef(s.$ref, root); const nroot = s.$ref.includes("#") && !s.$ref.startsWith("#") ? loadSchema(s.$ref.split("#")[0]) : root; return check(v, { ...t, ...Object.fromEntries(Object.entries(s).filter(([k]) => k !== "$ref")) }, nroot, path, out); }
  if (s.allOf) for (const sub of s.allOf) check(v, sub, root, path, out);
  if (s.const !== undefined && v !== s.const) return out.push(`${path}: must be ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(v)) return out.push(`${path}: ${JSON.stringify(v)} not in ${JSON.stringify(s.enum)}`);
  if (s.type) {
    const types = [].concat(s.type), t = typeOf(v);
    const ok = types.some((x) => x === t || (x === "number" && t === "integer"));
    if (!ok) return out.push(`${path}: expected ${types.join("|")}, got ${t}`);
  }
  if (typeof v === "string") {
    if (s.minLength != null && v.length < s.minLength) out.push(`${path}: shorter than ${s.minLength}`);
    if (s.maxLength != null && v.length > s.maxLength) out.push(`${path}: longer than ${s.maxLength} (${v.length})`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) out.push(`${path}: ${JSON.stringify(v)} does not match /${s.pattern}/`);
    if (s.format && FORMATS[s.format] && !FORMATS[s.format](v)) out.push(`${path}: ${JSON.stringify(v)} is not a valid ${s.format}`);
  }
  if (typeof v === "number") {
    if (s.minimum != null && v < s.minimum) out.push(`${path}: ${v} < ${s.minimum}`);
    if (s.maximum != null && v > s.maximum) out.push(`${path}: ${v} > ${s.maximum}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems != null && v.length < s.minItems) out.push(`${path}: fewer than ${s.minItems} items`);
    if (s.maxItems != null && v.length > s.maxItems) out.push(`${path}: more than ${s.maxItems} items`);
    if (s.items) v.forEach((x, i) => check(x, s.items, root, `${path}[${i}]`, out));
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const k of s.required || []) if (!(k in v)) out.push(`${path}: missing required "${k}"`);
    for (const [k, x] of Object.entries(v)) {
      if (s.properties && k in s.properties) check(x, s.properties[k], root, `${path}.${k}`, out);
      else if (s.additionalProperties === false) out.push(`${path}: unexpected property "${k}"`);
      else if (s.additionalProperties && typeof s.additionalProperties === "object") check(x, s.additionalProperties, root, `${path}.${k}`, out);
    }
  }
}
function validateAgainst(obj, schemaFile, label) {
  const out = [];
  check(obj, loadSchema(schemaFile), loadSchema(schemaFile), label, out);
  out.forEach(err);
  return out.length === 0;
}

// ---------- normalisation for verbatim-quote check ----------
const norm = (s) => s.normalize("NFKC").replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
const dirOf = (x) => (x > 0.15 ? "support" : x < -0.15 ? "oppose" : "neutral");

// ---------- contract A ----------
function loadRecords() {
  const map = new Map();
  const files = [...opt.recordFiles];
  if (opt.records && existsSync(opt.records)) for (const f of readdirSync(opt.records)) if (f.endsWith(".json")) files.push(join(opt.records, f));
  for (const f of files) {
    let r; try { r = readJson(f); } catch (e) { err(`${f}: not JSON (${e.message})`); continue; }
    const label = `record ${basename(f)}`;
    if (!validateAgainst(r, "record.schema.json", label)) continue;
    if (!/^<(Rep\. [^>]+|other)>: /m.test(r.content)) err(`${label}: content has no speaker tags (<Rep. Name>: / <other>:)`);
    const bad = [...r.content.matchAll(/^<([^>]+)>:/gm)].map((m) => m[1]).filter((t) => t !== "other" && !t.startsWith("Rep. "));
    if (bad.length) warn(`${label}: speaker tags not in the <Rep. Name>/<other> form: ${[...new Set(bad)].join(", ")}`);
    if (map.has(r.id)) err(`${label}: duplicate record id ${r.id}`);
    map.set(r.id, r);
  }
  return map;
}

// ---------- contract B ----------
function validateDir(dir) {
  const need = ["taxonomy.json", "issues.json", "people.json", "stances.json"];
  for (const f of need) if (!existsSync(join(dir, f))) err(`${f}: missing`);
  if (errors.length) return;
  const taxonomy = readJson(join(dir, "taxonomy.json"));
  const issues = readJson(join(dir, "issues.json"));
  const people = readJson(join(dir, "people.json"));
  const stances = readJson(join(dir, "stances.json"));
  const summaries = existsSync(join(dir, "summaries.json")) ? readJson(join(dir, "summaries.json")) : null;

  const okT = validateAgainst(taxonomy, "taxonomy.schema.json", "taxonomy.json");
  const okI = validateAgainst(issues, "issues.schema.json", "issues.json");
  const okP = validateAgainst(people, "people.schema.json", "people.json");
  const okS = validateAgainst(stances, "statements.schema.json", "stances.json");
  const okSum = summaries ? validateAgainst(summaries, "summaries.schema.json", "summaries.json") : true;
  if (!(okT && okI && okP && okS && okSum)) return;

  const mock = !!(people._meta?.mock || stances._meta?.mock);

  // taxonomy: unique ids, leaf set
  const leaf = new Set(), seen = new Set();
  for (const c of taxonomy.committees) {
    if (seen.has(c.id)) err(`taxonomy.json: duplicate committee id ${c.id}`); seen.add(c.id);
    if (!c.subcommittees.length) leaf.add(c.id);
    for (const s of c.subcommittees) {
      if (!s.id.startsWith(c.id + "-")) err(`taxonomy.json: subcommittee ${s.id} must start with ${c.id}-`);
      if (seen.has(s.id)) err(`taxonomy.json: duplicate subcommittee id ${s.id}`); seen.add(s.id); leaf.add(s.id);
    }
  }
  // issues
  const issueIds = new Set();
  for (const i of issues.issues) {
    if (issueIds.has(i.id)) err(`issues.json: duplicate issue id ${i.id}`); issueIds.add(i.id);
    if (!leaf.has(i.parent)) err(`issues.json: issue ${i.id} parent ${i.parent} is not a subcommittee or leaf committee`);
  }
  // people
  const personIds = new Set(), bioguides = new Set();
  for (const p of people.people) {
    if (personIds.has(p.id)) err(`people.json: duplicate person id ${p.id}`); personIds.add(p.id);
    if (p.bioguide_id === null && !mock) err(`people.json: ${p.id} has null bioguide_id on non-mock data`);
    if (p.bioguide_id) { if (bioguides.has(p.bioguide_id)) err(`people.json: duplicate bioguide_id ${p.bioguide_id}`); bioguides.add(p.bioguide_id); }
    if (!p.district.startsWith(p.state + "-")) err(`people.json: ${p.id} district ${p.district} does not match state ${p.state}`);
  }
  // statements
  const records = loadRecords();
  const stIds = new Set(), stOwner = new Map();
  let quoteChecked = 0, quoteSkipped = 0;
  for (const s of stances.stances) {
    const L = `stances.json ${s.statement_id}`;
    if (stIds.has(s.statement_id)) err(`${L}: duplicate statement_id`); stIds.add(s.statement_id); stOwner.set(s.statement_id, s.person);
    if (!personIds.has(s.person)) err(`${L}: unknown person ${s.person}`);
    if (!issueIds.has(s.issue)) err(`${L}: unknown issue ${s.issue}`);
    if (s.direction !== dirOf(s.score)) err(`${L}: direction ${s.direction} inconsistent with score ${s.score} (expected ${dirOf(s.score)})`);
    if (!s.record_id && !mock) err(`${L}: record_id required on non-mock data`);
    if (s.record_id) {
      const r = records.get(s.record_id);
      if (!r) { quoteSkipped++; (opt.records || opt.recordFiles.length ? warn : () => {})(`${L}: record ${s.record_id} not found, quote not checked`); }
      else {
        quoteChecked++;
        if (!norm(r.content).includes(norm(s.quote))) err(`${L}: quote is not a verbatim substring of record ${s.record_id}`);
        if (s.source !== r.source.url_link) err(`${L}: source ${s.source} differs from record source ${r.source.url_link}`);
        if (s.date !== r.hints.date) warn(`${L}: date ${s.date} differs from record date ${r.hints.date}`);
      }
    } else quoteSkipped++;
  }
  // summaries
  if (summaries) for (const [pid, sum] of Object.entries(summaries.summaries)) {
    if (!personIds.has(pid)) { err(`summaries.json: unknown person ${pid}`); continue; }
    sum.sentences.forEach((sen, i) => sen.cites.forEach((c) => {
      if (!stIds.has(c)) err(`summaries.json ${pid} sentence ${i}: cites unknown statement ${c}`);
      else if (stOwner.get(c) !== pid) err(`summaries.json ${pid} sentence ${i}: cites ${c} which belongs to ${stOwner.get(c)}`);
    }));
  }
  const orphans = [...personIds].filter((p) => !stances.stances.some((s) => s.person === p));
  if (orphans.length) warn(`people.json: ${orphans.length} legislator(s) with no statements (fine for real data, UI shows them empty)`);
  const unused = [...issueIds].filter((i) => !stances.stances.some((s) => s.issue === i));
  if (unused.length) warn(`issues.json: ${unused.length} issue(s) with no statements: ${unused.join(", ")}`);
  console.log(`contract B: ${taxonomy.committees.length} committees, ${issues.issues.length} issues, ${people.people.length} people, ${stances.stances.length} statements, ${summaries ? Object.keys(summaries.summaries).length : 0} summaries; quotes checked ${quoteChecked}, skipped ${quoteSkipped}${mock ? " [mock data]" : ""}`);
}

if (opt.dir) validateDir(opt.dir); else loadRecords();

for (const w of warnings) console.log("warn  " + w);
for (const e of errors) console.log("ERROR " + e);
const fail = errors.length || (opt.strict && warnings.length);
console.log(fail ? `FAILED: ${errors.length} error(s), ${warnings.length} warning(s)` : `OK (${warnings.length} warning(s))`);
process.exit(fail ? 1 : 0);
