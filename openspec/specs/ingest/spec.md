# ingest Specification

## Purpose
Produce speaker-tagged records (contract A) from congressional sources so the process stage has clean, attributable text to extract stances from.

## Requirements

### Requirement: Speaker-tagged record text
Ingest SHALL emit `content` where each turn starts on its own line as `<Rep. Full Name>:` for a legislator in `people.json` and `<other>:` for chairs, clerks, witnesses, and unknowns, preserving original wording exactly.

#### Scenario: Legislator and non-legislator turns tagged
- **WHEN** a hearing excerpt contains a representative's speech and a chair's remark
- **THEN** the representative's turn starts with `<Rep. Full Name>:` and the chair's with `<other>:`

### Requirement: Record size targets one model read
Each record's `content` SHALL target 2-8k tokens so the model reads one coherent unit (a hearing excerpt, floor speech, or press-conference segment) per record.

#### Scenario: Oversized transcript is split
- **WHEN** a transcript far exceeds one unit of text
- **THEN** ingest emits multiple records rather than one oversized record

### Requirement: Source attribution on every record
Every record SHALL carry `source.url_link` (where a human can read or hear the original), `source.media_type` (`gov` or `news`), `source.media_name`, and `source.transcript` (how the text was obtained).

#### Scenario: Official transcript attributed
- **WHEN** a record comes from a congress.gov transcript
- **THEN** it carries `media_type` gov, `media_name` usgov, and `transcript` official_transcript

### Requirement: Hints carry date, optionally persons and bills
Every record SHALL carry `hints.date` (ISO date of the statements, not of ingestion) and MAY carry `hints.persons` and `hints.bill_urls` as untrusted model aids.

#### Scenario: Record without statement date fails
- **WHEN** a record omits `hints.date`
- **THEN** contract-A validation reports an error

### Requirement: Mock records marked fictional
Fictional sample records SHALL set `_meta.mock` to true; real records MUST NOT set it.

#### Scenario: Mock record is labelled
- **WHEN** a sample record contains invented content
- **THEN** it carries `_meta.mock: true`

### Requirement: Stable URL-safe record ids
Every record id SHALL be stable, unique, and URL-safe, following the `rec-<date>-<source-slug>` convention.

#### Scenario: Record id follows convention
- **WHEN** a record is created for a hearing on 2026-10-20
- **THEN** its id starts with `rec-2026-10-20-` and contains only URL-safe characters
