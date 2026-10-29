# data-contract

## Purpose

Contracts A (ingest → process) and B (process → frontend) define every byte that crosses a team boundary in OWL. This spec freezes the record shape, the five data files, enums, id references, and the validator's fail-vs-warn behaviour as implemented today, so future changes can be proposed as deltas.

## Requirements

### Requirement: Contract A record shape

The system SHALL accept a contract-A record as one JSON object with required `id` (stable, unique, URL-safe, convention `rec-<date>-<source-slug>`), required `content` (speaker-tagged text, target 2–8k tokens), required `source` object (`url_link` URI, `media_type`, `media_name`), required `hints.date` (ISO date of the statement, not of ingestion), optional `hints.persons` (people ids, advisory only) and `hints.bill_urls`, and optional `_meta.mock` (true for fictional samples, never set on real data).

#### Scenario: Valid record passes schema check

WHEN a record carries all required fields with well-formed values THEN the validator SHALL report no schema error for it.

#### Scenario: Advisory hints are never trusted

WHEN `hints.persons` names legislators absent from `content` THEN extraction MAY ignore the hint and the validator SHALL NOT fail the record.

### Requirement: Contract A speaker-tag format

Record `content` SHALL start each turn on its own line as `<Rep. Full Name>: …` for a legislator listed in `people.json` and `<other>: …` for chair, clerk, witnesses, and unknowns, preserving original wording exactly.

#### Scenario: Missing speaker tags fail validation

WHEN record content contains no `<Rep. Name>:` / `<other>:` speaker tag THEN the validator SHALL emit an error.

#### Scenario: Malformed tags warn only

WHEN a speaker tag matches neither `<other>` nor the `<Rep. …>` form THEN the validator SHALL emit a warning, not an error.

### Requirement: Contract A source and transcript enums

`source.media_type` SHALL be exactly `gov` (congress.gov, govinfo, *.house.gov) or `news` (everything else); `source.transcript` SHALL be exactly `official_transcript`, `whisper`, or `muse_voice_transcribe`; `source.media_name` SHALL be a lower-case name such as `usgov`, `cnn`, `fox`, or `cspan`.

#### Scenario: Unknown media type rejected

WHEN `source.media_type` is `podcast` THEN the validator SHALL emit a schema error.

### Requirement: Contract B five data files

The system SHALL load contract B as exactly five JSON files in one directory served next to `index.html`: `taxonomy.json` (levels 1+2), `issues.json` (level 3), `people.json` (House members), `stances.json` (one row per statement), and optional `summaries.json` (per-legislator AI summaries). The validator SHALL error when any of the first four files is missing.

#### Scenario: Missing stances file fails

WHEN `stances.json` is absent from the data directory THEN the validator SHALL emit a `stances.json: missing` error and stop before cross-file checks.

#### Scenario: Missing summaries file is tolerated

WHEN `summaries.json` is absent THEN the validator SHALL still pass (the UI shows "not generated yet").

### Requirement: Taxonomy and issue id rules

Committee ids SHALL be Thomas/congress.gov House codes (e.g. `hsju`); each subcommittee id SHALL start with `<committee-id>-` (e.g. `hsju-crime`); a committee with no subcommittees SHALL be its own leaf. Each issue SHALL carry `id` (slug of `name`), `name`, and `parent` pointing at a subcommittee id or a leaf committee id.

#### Scenario: Bad subcommittee prefix fails

WHEN a subcommittee id `hsju-crime` sits under committee `hsed` THEN the validator SHALL emit an error.

#### Scenario: Issue with unknown parent fails

WHEN an issue's `parent` names no subcommittee or leaf committee THEN the validator SHALL emit an error.

### Requirement: People file fields and scope

Each person SHALL carry `id` (stable; the bioguide id in production), `bioguide_id` (congress.gov join key; `null` only in mock data), `name` with prefix (e.g. `Rep. Jane Doe`), `chamber` always `house`, `state` (2-letter), `district` matching `<STATE>-<n>` (e.g. `CA-12`), `party` in `D|R|I`, `gender` in `F|M`, and `since` (first year in office, int). Scope is House members only; no senators.

#### Scenario: District-state mismatch fails

WHEN a person has `state: CA` and `district: TX-3` THEN the validator SHALL emit an error.

#### Scenario: Null bioguide on real data fails

WHEN `bioguide_id` is `null` and the corpus is not marked mock THEN the validator SHALL emit an error.

### Requirement: Statement row shape and enums

Each stance row SHALL carry unique `statement_id` (`st` + digits), `person` (existing people id), `issue` (existing issue id), `date` (ISO), `score` in −1…+1, `direction` in `support|oppose|neutral`, `linkage` and `llm_confidence` in `low|mid|high|super_high`, `quote` (2–600 chars), `bill` (string or null), `source` (URI), `model` (e.g. `muse-spark-1.3`), optional `rationale`, and `record_id` (required on real data, optional on mock).

#### Scenario: Unknown person reference fails

WHEN a stance names a `person` absent from `people.json` THEN the validator SHALL emit an error naming the statement.

### Requirement: Direction-from-score rule

`direction` SHALL be derived from `score`: greater than 0.15 is `support`, less than −0.15 is `oppose`, otherwise `neutral`. The value is stored for convenience and the validator SHALL reject any mismatch.

#### Scenario: Mismatched direction fails

WHEN a statement has `score: 0.8` and `direction: oppose` THEN the validator SHALL emit a direction-inconsistency error.

### Requirement: Verbatim-quote rule

Every stance `quote` SHALL be a verbatim contiguous substring of its source contract-A record's `content`, compared after NFKC normalisation, curly/straight quote normalisation, dash normalisation, and whitespace collapsing with case folding. The statement `source` SHALL equal the record's `source.url_link`.

#### Scenario: Paraphrased quote fails

WHEN a quote is paraphrased rather than copied from the record THEN the validator SHALL emit a `quote is not a verbatim substring` error.

#### Scenario: Quote check skipped without records

WHEN the record for a `record_id` is not supplied to the validator THEN the quote check SHALL be skipped (warning only when records were explicitly provided but the id is missing).

### Requirement: Never-pre-aggregate rule

The data SHALL hold one row per statement: a legislator who speaks five times on an issue yields five rows. Aggregation into per-(person, issue) edges happens only in the browser under contract C and MUST NOT be pre-computed upstream.

#### Scenario: Multiple rows per pair validate

WHEN two statements share the same `person` and `issue` with different `statement_id`s THEN the validator SHALL accept both.

### Requirement: Summaries citation rule

In `summaries.json`, every sentence SHALL cite at least one `statement_id`, every cited statement MUST exist, and every cited statement MUST belong to the same legislator the summary is written about. Summaries are neutral in register with no praise/blame adjectives.

#### Scenario: Cross-legislator citation fails

WHEN legislator `p01`'s summary sentence cites `st099` belonging to `p02` THEN the validator SHALL emit an error.

#### Scenario: Unknown citation fails

WHEN a sentence cites a `statement_id` absent from `stances.json` THEN the validator SHALL emit an error.

### Requirement: Validator fail-vs-warn behaviour

The validator SHALL exit non-zero on any error, and additionally on any warning when `--strict` is passed (CI uses strict for non-mock data). The following SHALL be warnings, never errors: a stance `date` differing from its record's `hints.date`; legislators with no statements; issues with no statements.

#### Scenario: Strict mode promotes warnings

WHEN a stance date differs from its record date THEN the default run SHALL warn and pass, while a `--strict` run SHALL fail.
