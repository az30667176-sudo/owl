# process Specification

## Purpose
Turn contract-A records into evidence-anchored contract-B data (stances and summaries) with Muse Spark, dropping anything that fails hard validation.

## Requirements

### Requirement: Extraction emits one row per statement
Extraction SHALL send one record to Muse Spark and return one statement row per legislator statement found, stamped with the model name and the record's statement date.

#### Scenario: Record with two statements yields two rows
- **WHEN** a record contains statements by two legislators on known issues
- **THEN** extraction returns two rows, each with `model`, `date`, and `record_id`

### Requirement: Hard validation drops bad statements
A statement SHALL be dropped and reported when any check fails: unknown `person` id, unknown `issue` id without a valid new-issue parent, non-verbatim `quote`, or `direction` disagreeing with `score`.

#### Scenario: Unknown person dropped
- **WHEN** the model emits a statement for a person id missing from `people.json`
- **THEN** the statement is dropped and reported, and no row is written for it

#### Scenario: Non-verbatim quote dropped
- **WHEN** the model emits a quote that is not a substring of the record content
- **THEN** the statement is dropped and reported

#### Scenario: Direction mismatch dropped
- **WHEN** the model emits score 0.9 with direction `neutral`
- **THEN** the statement is dropped and reported

### Requirement: New issues need a human-approved parent
The model MAY propose `new_issue {name, parent}` while extracting, but the parent MUST be a real subcommittee id and a human MUST merge duplicates and approve before the issue joins `issues.json`.

#### Scenario: New issue under a real subcommittee staged
- **WHEN** the model proposes an issue whose parent is a real subcommittee id
- **THEN** the issue is staged for human review, not silently merged

#### Scenario: New issue under an unknown parent dropped
- **WHEN** the model proposes an issue whose parent matches no subcommittee
- **THEN** the proposal is dropped and reported

### Requirement: Merge appends only validated rows
With `--merge`, extraction SHALL append only validated statements to `stances.json` and only approved new issues to `issues.json`, and MUST always write the per-record extraction log.

#### Scenario: Merge writes log and appends valid rows
- **WHEN** extraction runs with `--merge` on a record with one valid and one invalid statement
- **THEN** the log records both outcomes and only the valid statement is appended

### Requirement: Summaries cite their legislator's statements
Summarization SHALL write 2-4 neutral sentences per legislator with every sentence citing at least one statement belonging to that legislator; sentences whose citations fail validation are dropped.

#### Scenario: Valid summary written
- **WHEN** a legislator has valid statements and the model returns cited sentences
- **THEN** `summaries.json` gains an entry with `model`, `generated_at`, and cited sentences

#### Scenario: Legislator with no valid sentences skipped
- **WHEN** none of a legislator's sentences survives citation validation
- **THEN** the legislator is skipped and reported, with no entry written

### Requirement: Model calls need an API key and stay offline
Process scripts SHALL call Muse Spark through the Meta Model API using `MODEL_API_KEY` from the environment or `.env`, exiting with an error when the key is missing; summaries are generated offline and committed as data.

#### Scenario: Missing API key exits with error
- **WHEN** `MODEL_API_KEY` is unset and no `.env` provides it
- **THEN** the script exits non-zero with a message naming the missing key
