# data-contracts Specification

## Purpose
Define every byte that crosses a team boundary (contracts A, B, C) so ingest, process, and web can build against stable shapes with a single source of truth.

## Requirements

### Requirement: Contract A record shape
Ingest SHALL emit one JSON record per unit of text the model reads in one go, carrying speaker-tagged `content`, a `source`, and `hints` as defined in `record.schema.json`.

#### Scenario: Valid record passes contract-A validation
- **WHEN** a record with `id`, `content`, `source`, and `hints.date` is checked with `validate.mjs --record`
- **THEN** validation succeeds with no errors

#### Scenario: Record missing source fails validation
- **WHEN** a record omits `source.url_link`
- **THEN** validation reports an error naming the missing field

### Requirement: Contract B data files
Process SHALL publish exactly the five JSON files `taxonomy`, `issues`, `people`, `stances`, and `summaries` in one directory, using stable string ids, servable next to the web app.

#### Scenario: Complete directory passes contract-B validation
- **WHEN** the data directory holds all five files with valid shapes and id references
- **THEN** `validate.mjs <data dir>` succeeds with no errors

#### Scenario: Dangling id reference fails validation
- **WHEN** a stance references a `person` id missing from `people.json`
- **THEN** validation reports an error naming the dangling reference

### Requirement: One row per statement, never pre-aggregated
Process SHALL emit one stance row per statement and MUST NOT fold multiple statements into aggregates; aggregation is contract C and happens only in the browser.

#### Scenario: Repeated speech yields repeated rows
- **WHEN** a legislator speaks five times on one issue
- **THEN** `stances.json` holds five rows for that person-issue pair

### Requirement: Direction derived from score
Every stance SHALL carry both `score` (-1 to +1) and `direction`, where `direction` is `support` above 0.15, `oppose` below -0.15, and `neutral` otherwise; the validator MUST reject a mismatch.

#### Scenario: Score and direction agree
- **WHEN** a stance has score 0.8 and direction `support`
- **THEN** validation succeeds

#### Scenario: Score and direction disagree
- **WHEN** a stance has score 0.8 and direction `oppose`
- **THEN** validation reports a score/direction consistency error

### Requirement: Verbatim quote evidence
Every stance `quote` (2-600 chars) SHALL be a verbatim substring of its source record's `content` under whitespace/quote normalisation, and real-data stances MUST carry `record_id` so the quote can be re-checked.

#### Scenario: Verbatim quote passes with records supplied
- **WHEN** validation runs with `--records` and each quote appears in its referenced record
- **THEN** validation succeeds

#### Scenario: Non-verbatim quote fails
- **WHEN** a quote is paraphrased and not found in its referenced record
- **THEN** validation reports a verbatim-quote error

#### Scenario: Real-data stance without record_id fails strictly
- **WHEN** a non-mock stance omits `record_id`
- **THEN** strict validation reports an error for the missing back-reference

### Requirement: Summary citations stay with their legislator
Every summary sentence SHALL cite at least one statement that belongs to the summarised person; the validator MUST fail the file when a citation points at another person's statement.

#### Scenario: Valid citations pass
- **WHEN** each sentence of a person's summary cites only that person's statements
- **THEN** validation succeeds

#### Scenario: Cross-person citation fails
- **WHEN** a sentence cites a statement belonging to a different person
- **THEN** validation reports a citation error

### Requirement: Contract C owned by the frontend
Contract-C derivations SHALL live only in the browser and MUST NOT be stored or exchanged; a derivation needing a new input requires a contract-B change instead.

#### Scenario: Frontend-only derivation change
- **WHEN** a derived rule changes without needing new data fields
- **THEN** no schema or data file changes

### Requirement: Validator gates every deploy
The zero-dependency validator SHALL check JSON shapes plus cross-file rules (id references, score/direction, verbatim quotes, citations), and the Pages workflow MUST run it before every deploy so invalid data never ships.

#### Scenario: Invalid data blocks deploy
- **WHEN** the data directory fails validation
- **THEN** the deploy workflow fails before publishing

### Requirement: Contract changes need consumer sign-off
A change to any schema SHALL land only via a PR labeled `contract` that carries the consuming side's approval and changes schema and code together.

#### Scenario: Unapproved contract change is blocked
- **WHEN** a PR touches `packages/contract/` without the `contract` label and consumer approval
- **THEN** it MUST NOT be merged
