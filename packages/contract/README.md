# OWL data contracts

Single source of truth for every byte that crosses a team boundary. Maps 1:1 to the boxes on the team board:

```
 data producer ──A──► Data pre-processing ──B──► Data process (Muse Spark) ──C──► Data vis (frontend)
 congress.gov,         services/ingest              services/process               apps/web
 transcripts
```

| Contract | Producer → Consumer | Shape | Schema |
|---|---|---|---|
| **A** | ingest → process | one **record**: speaker-tagged text + source + hints | `record.schema.json` |
| **B** | process → frontend | six **data files** the frontend loads at startup | `taxonomy`, `issues`, `people`, `statements`, `summaries`, `conditions` `.schema.json` |
| **C** | frontend-internal | derived in the browser from B (aggregation, filters, graph) | `derived.md` (rules, no file crosses a boundary) |

Owners: A is owned by **ingest** (producer) and **process** (consumer) jointly; B is owned by **process** (producer) and **web** (consumer) jointly. A change to any schema = open an issue with label `contract`, get the consuming side's thumbs-up, then land the schema and the code in one PR.

Validate anything against the contracts with:

```bash
node packages/contract/validate.mjs data --records data/records   # contract B (+ verbatim quotes)
node packages/contract/validate.mjs --record data/records/record-hearing-mock.json   # contract A
```

The GitHub Pages workflow runs the first command before every deploy; invalid data never ships.

## Contract A — record (ingest → process)

One JSON object per unit of text the model should read in one go (a hearing excerpt, a floor speech, a press-conference segment). Target 2–8k tokens of `content`.

| field | type | required | notes |
|---|---|---|---|
| `id` | string | yes | stable, unique, URL-safe. Convention `rec-<date>-<source-slug>` |
| `content` | string | yes | speaker-tagged text. Each turn starts on its own line as `<Rep. Full Name>: …` for a legislator in `people.json`, `<other>: …` for chair, clerk, witnesses, unknowns. Preserve original wording exactly — the model's quotes are validated as substrings of this field |
| `source.url_link` | uri | yes | where a human can read/hear the original |
| `source.media_type` | `gov` \| `news` | yes | `gov` = congress.gov, govinfo, *.house.gov; everything else `news` |
| `source.media_name` | string | yes | `usgov`, `cnn`, `fox`, `cspan`, … lower-case |
| `source.transcript` | `official_transcript` \| `whisper` \| `muse_voice_transcribe` | yes | how the text was obtained |
| `hints.date` | date (ISO) | yes | date of the statement(s), not of ingestion |
| `hints.persons` | string[] of people ids | no | legislators expected in the text; helps the model but is not trusted |
| `hints.bill_urls` | uri[] | no | bills under discussion |
| `_meta.mock` | bool | no | true for fictional samples; never set on real data |

Example: `data/records/record-hearing-mock.json`.

## Contract B — data files (process → frontend)

Six files in one directory. The frontend fetches them relative to its own URL (`./data/<file>`), so the directory must be served next to `index.html`. All ids are stable strings; names are display-only. Files marked `_meta.mock: true` contain fictional legislators and must never be published as real.

### taxonomy.json — levels 1 + 2

```
{ "_meta": {...}, "committees": [ { "id", "name", "subcommittees": [ { "id", "name" } ] } ] }
```
Level 1 = House standing committees, level 2 = their subcommittees. A committee with no subcommittees is its own leaf (issues may point at the committee id). Source: congress.gov `/committee/house`. Regenerate per Congress; ids are the Thomas/congress.gov committee codes (`hsju`, `hsju-crime`).

### issues.json — level 3

```
{ "_meta": {...}, "issues": [ { "id", "name", "parent" } ] }
```
`parent` is a subcommittee id (or a leaf committee id). Produced by the process stage: the model proposes `new_issue {name, parent}` while extracting; a human merges duplicates and approves. `id` = slug of `name`.

### people.json — House members

```
{ "_meta": {...}, "people": [ { "id", "bioguide_id", "name", "chamber", "state", "district", "party", "gender", "since" } ] }
```
| field | notes |
|---|---|
| `id` | stable; in production use the bioguide id itself |
| `bioguide_id` | congress.gov join key; `null` only in mock data |
| `name` | with prefix: `Rep. Jane Doe` |
| `chamber` | always `house` in current scope (field kept for stability) |
| `state` | 2-letter |
| `district` | `CA-12` |
| `party` | `D` \| `R` \| `I` |
| `gender` | `F` \| `M` |
| `since` | first year in office (int) |

### stances.json — one row per statement (schema: `statements.schema.json`)

```
{ "_meta": {...}, "stances": [ { "statement_id", "person", "issue", "date", "score", "direction", "linkage", "llm_confidence", "quote", "bill", "source", "model", "record_id"?, "rationale"? } ] }
```
| field | type | rule |
|---|---|---|
| `statement_id` | `st` + digits | unique across the file |
| `person` | people id | must exist |
| `issue` | issues id | must exist |
| `date` | ISO date | from the record's `hints.date` |
| `score` | number −1…+1 | +1 strongest support |
| `direction` | `support` \| `oppose` \| `neutral` | **derived**: `> .15` support, `< −.15` oppose, else neutral. Stored for convenience; the validator rejects a mismatch |
| `linkage` | `low` \| `mid` \| `high` \| `super_high` | how directly the quote addresses the issue |
| `llm_confidence` | same enum | the model's confidence in its reading |
| `quote` | string 2–600 chars | **verbatim substring of the source record's `content`** (whitespace/quote-normalised). The whole product rests on this |
| `bill` | string \| null | bill named near the statement |
| `source` | uri | the record's `source.url_link` |
| `model` | string | e.g. `muse-spark-1.3` |
| `record_id` | string | back-reference to the contract-A record. Optional on mock data, **required on real data** (the validator uses it to check the quote) |
| `rationale` | string | optional one-sentence model explanation |

**Never pre-aggregate.** A legislator who speaks five times on an issue yields five rows. Aggregation is contract C.

### summaries.json — optional

```
{ "_meta": {...}, "summaries": { "<person id>": { "model", "generated_at", "sentences": [ { "text", "cites": ["st012", ...] } ] } } }
```
Generated offline by `services/process/summarize.mjs`. Every sentence cites ≥ 1 statement that belongs to that person; the validator drops nothing — it fails the file if a citation points elsewhere. Missing file or missing person = the UI shows "not generated yet".

### conditions.json — optional

```
{ "_meta": {...}, "demands": [ { "id", "name", "type", "excludes"? } ], "conditions": [ { "condition_id", "demand", "person", "issue", "bill", "stance_if_met", "scope", "condition", "quote", "statement_id", "record_id", "model" } ] }
```

| field | type | rule |
|---|---|---|
| `demands[].id` | kebab-case string | unique across the file |
| `demands[].name` | string 1–80 chars | display name of the demand |
| `demands[].type` | `amendment` \| `funding` \| `timeline` \| `oversight` \| `exemption` \| `study` \| `procedure` \| `other` | demand kind; drives bill-page grouping |
| `demands[].excludes` | string[] | optional; other demand ids that cannot be adopted together with this one |
| `condition_id` | `cd` + digits | unique across the file |
| `demand` | demands id | must exist in the registry |
| `person` | people id | must exist |
| `issue` | issues id | must exist |
| `bill` | string \| null (≤ 120 chars) | bill named near the condition |
| `stance_if_met` | `support` \| `oppose` | stance the legislator takes if the demand is met |
| `scope` | `vote` \| `final_passage` | which vote the condition governs |
| `condition` | string 1–300 chars | one-sentence paraphrase of the condition |
| `quote` | string 2–400 chars | **verbatim substring of the source record's `content`** (whitespace/quote-normalised). The whole ledger rests on this |
| `statement_id` | string \| null | stances id, or null when not yet linked. When non-null it must exist and belong to the same `person` |
| `record_id` | string | back-reference to the contract-A record. The validator uses it to check the quote |
| `model` | string | e.g. `muse-spark-1.3` |

Demand registry: `water-cap` (amendment, "Enforceable water-use cap"), `water-disc` (amendment, "Binding water-use disclosure (Sec. 4)"), `clean` (procedure, "Pass the bill clean, no amendments", excludes `water-cap` + `water-disc`).

Rules: `quote` must be verbatim against the record named by `record_id`; `statement_id` is nullable but when present must match the row's `person`; conditions are never averaged into scores.

## Contract C — derived in the browser

See `derived.md`. In short: the frontend folds statements into one edge per (person, issue) with a confidence-weighted score, counts, a flip flag and an attention score; applies filters; and builds graph/list/profile views. Nothing in C is stored or exchanged, so changing C is a frontend-only change — unless it needs a new field in B.

## Versioning

`_meta.contract_version` (string, semver) may be set on any B file; the frontend currently accepts any version and warns on a major mismatch. Bump the major when a required field changes meaning or is removed.
