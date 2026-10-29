# process-pipeline

## Purpose

`services/process/` turns contract-A records into contract-B data using Muse Spark: `extract.mjs` produces one statement row per passage, and `summarize.mjs` produces per-legislator cited summaries offline. This spec freezes their inputs, validation, outputs, and merge behaviour as implemented today.

## Requirements

### Requirement: Extract inputs and invocation

`extract.mjs` SHALL be invoked as `node services/process/extract.mjs <record.json> [--merge] [--model <name>]` (default model `muse-spark-1.3`), read `taxonomy.json`, `issues.json`, `people.json`, and `stances.json` from `data/`, read `MODEL_API_KEY` from the environment or `.env`, and exit non-zero with a usage or key error when the record path or key is missing.

#### Scenario: Missing key aborts

WHEN `MODEL_API_KEY` is unset and absent from `.env` THEN the script SHALL exit non-zero with a `MODEL_API_KEY missing` message before any network call.

### Requirement: Extract model call

The script SHALL send the full taxonomy (subcommittee id → committee › subcommittee label), existing issues, legislator roster, record id/date/source, and transcript to the model with temperature 0.1, `response_format: json_object`, and a system prompt requiring one statement per passage, verbatim quotes of at most 60 words, and `new_issue {name, parent}` proposals only when no existing issue fits.

#### Scenario: Prompt carries taxonomy labels

WHEN the taxonomy contains `hsju-crime` under Judiciary THEN the model prompt SHALL include the `hsju-crime: … › …` label line.

### Requirement: Extract per-statement validation

Each candidate statement SHALL be validated: `person` exists in `people.json`; `issue` exists, or `new_issue` carries a name and a `parent` that is a real subcommittee id (the issue id is then the slugified name); `score` is a number in −1…+1; `linkage` and `llm_confidence` are in `low|mid|high|super_high`; `quote` is a verbatim substring of the record content under the same normalisation as the contract validator.

#### Scenario: Unknown person rejected

WHEN the model emits a statement for a person absent from `people.json` THEN that statement SHALL be rejected with an `unknown person` reason.

#### Scenario: Bad new-issue parent rejected

WHEN `new_issue.parent` names no real subcommittee THEN the statement SHALL be rejected with an `unknown issue / bad new_issue` reason.

#### Scenario: Paraphrased quote rejected

WHEN the quote is not a verbatim substring of the record THEN the statement SHALL be rejected with a `quote not verbatim in transcript` reason.

### Requirement: Direction derived from score in extract

`direction` SHALL be derived from `score` (> 0.15 support, < −0.15 oppose, else neutral); the model's own direction label is advisory only, and a mismatch SHALL log a warning while storing the score-derived value.

#### Scenario: Model label overridden

WHEN the model labels a `score: 0.8` statement `oppose` THEN the stored row SHALL carry `direction: support` and a warning SHALL be logged.

### Requirement: Rejected rows logged, accepted rows written

Every rejected statement SHALL be reported with its reasons; the run SHALL always write `data/extracted/<record id>.extracted.json` containing `record_id`, `model`, `extracted_at`, `accepted`, `rejected`, `new_issues`, and token `usage`, and SHALL print per-statement accept/reject lines plus a summary count line.

#### Scenario: Extraction artifact always written

WHEN all candidate statements fail validation THEN the extracted file SHALL still be written with an empty `accepted` array and a populated `rejected` array.

### Requirement: Extract merge mode

With `--merge` and at least one accepted statement, the script SHALL append new issues to `issues.json` and accepted statements (minus `rationale`) with sequential `stNNN` ids to `stances.json`; without `--merge` it SHALL NOT modify either file.

#### Scenario: Dry run leaves data untouched

WHEN the script runs without `--merge` THEN `stances.json` and `issues.json` SHALL be byte-identical afterwards.

#### Scenario: Sequential ids

WHEN the highest existing id is `st012` THEN the first accepted statement SHALL be stored as `st013`.

### Requirement: Extract statement row fields

Each accepted row SHALL carry `statement_id`, `person`, `issue`, `date` from the record's `hints.date` (or null), `score` rounded to 2 decimals, score-derived `direction`, `linkage`, `llm_confidence`, trimmed `quote`, `bill` (or null), `source` from the record's `source.url_link` (or null), `record_id`, `model`, and `rationale` (or null).

#### Scenario: Date provenance

WHEN the record's `hints.date` is `2026-03-04` THEN accepted rows SHALL carry `date: 2026-03-04`.

### Requirement: Summarize inputs and invocation

`summarize.mjs` SHALL be invoked as `node services/process/summarize.mjs [--only <ids>] [--model <name>] [--dry]`, read `data/{people,issues,taxonomy,stances}.json`, merge into (never replace wholesale) `data/summaries.json` stamped with generator `services/process/summarize.mjs`, and SHALL NOT run at page load — summaries are generated offline and committed as data.

#### Scenario: Scoped run

WHEN `--only p09,p04` is passed THEN only those legislators SHALL be processed.

#### Scenario: Dry run writes nothing

WHEN `--dry` is passed THEN `summaries.json` SHALL NOT be modified.

### Requirement: Summarize model call and style

For each legislator with statements, the script SHALL send their chronological statements (id, date, issue name, committee path, score, direction, confidence, bill, quote) plus same-party averages to the model with temperature 0.2 and a system prompt requiring 2–4 neutral sentences, each grounded only in the provided statements, with no praise/blame adjectives and no inferred motives.

#### Scenario: Legislator without statements skipped

WHEN a legislator has no statements THEN they SHALL be skipped with a `no statements` report and no entry written.

### Requirement: Summary citation validation

Sentences whose citations fail validation SHALL be dropped: each surviving sentence MUST have non-empty text and at least one cited `statement_id` belonging to this legislator. A legislator with zero surviving sentences SHALL be skipped and reported; the number of dropped sentences SHALL be logged.

#### Scenario: Bad citations dropped

WHEN the model cites a statement belonging to another legislator THEN that citation SHALL be removed, and a sentence left with no valid citations SHALL be dropped.

### Requirement: Summary entry shape

Each written entry SHALL be keyed by person id with `model`, `generated_at` (YYYY-MM-DD), and `sentences: [{text, cites}]`, and the run SHALL log token usage plus an estimated cost line on write.

#### Scenario: Entry fields present

WHEN a summary is written for `p01` THEN it SHALL contain `model`, a date-shaped `generated_at`, and a non-empty `sentences` array.
