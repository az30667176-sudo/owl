# Spec Delta

## MODIFIED Requirements

### Requirement: Contract B five data files

The system SHALL load contract B as JSON files in one directory served next to `index.html`: `taxonomy.json` (levels 1+2), `issues.json` (level 3), `people.json` (House members), `stances.json` (one row per statement), optional `summaries.json` (per-legislator AI summaries), and optional `conditions.json` (conditions ledger). The validator SHALL error when any of the first four files is missing.

#### Scenario: Missing stances file fails

WHEN `stances.json` is absent from the data directory THEN the validator SHALL emit a `stances.json: missing` error and stop before cross-file checks.

#### Scenario: Missing summaries file is tolerated

WHEN `summaries.json` is absent THEN the validator SHALL still pass (the UI shows "not generated yet").

#### Scenario: Missing conditions file is tolerated

WHEN `conditions.json` is absent THEN the validator SHALL still pass and the UI SHALL hide every conditions element.

## ADDED Requirements

### Requirement: Demand registry

`conditions.json` SHALL carry a `demands` array whose entries have a unique `id` (kebab-case), a `name` (≤ 80 chars), a `type` in {amendment, funding, timeline, oversight, exemption, study, procedure, other}, and an optional `excludes` list of other demand ids that cannot be adopted together with it.

#### Scenario: Exclusion references an unknown demand

WHEN a demand's `excludes` names an id not present in `demands` THEN the validator SHALL emit an error naming both ids.

#### Scenario: Unknown type rejected

WHEN a demand has `type: "wish"` THEN the validator SHALL emit an error naming the demand and the allowed enum.

### Requirement: Conditions row shape

Each row in `conditions.conditions` SHALL carry `condition_id` (`cd` + digits, unique), `demand` (a registry id), `person` (people id), `issue` (issues id), `bill` (string or null), `stance_if_met` in {support, oppose}, `scope` in {vote, final_passage}, `condition` (≤ 300 chars), `quote` (2–400 chars), `statement_id` (string or null), `record_id`, and `model`.

#### Scenario: Empty ledger is valid

WHEN `conditions.json` contains empty `demands` and `conditions` arrays THEN the validator SHALL pass.

#### Scenario: Unknown demand fails

WHEN a row's `demand` is not in the registry THEN the validator SHALL emit an error naming the row.

### Requirement: Conditions reference rules

A row's `person` and `issue` MUST exist in `people.json` and `issues.json`. When `statement_id` is non-null it MUST exist in `stances.json` and belong to the same `person`.

#### Scenario: Cross-legislator statement fails

WHEN a row's `statement_id` belongs to a different legislator THEN the validator SHALL emit an error naming both ids.

#### Scenario: Null statement allowed

WHEN a row has `statement_id: null` THEN the validator SHALL accept it without warning.

### Requirement: Conditions verbatim-quote rule

A row's `quote` SHALL be a verbatim substring (whitespace- and quote-normalised) of the content of the record named by `record_id`, checked whenever that record is supplied to the validator.

#### Scenario: Paraphrased condition quote fails

WHEN records are supplied and a condition quote is not a substring of its record THEN the validator SHALL emit an error naming the condition id.

#### Scenario: Quote check skipped without records

WHEN the named record is not supplied THEN the validator SHALL skip the check and count it in its "quotes skipped" total.
