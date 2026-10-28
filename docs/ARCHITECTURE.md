# Architecture

Transcribed from the team Excalidraw board (2026-10-26). Keep this file in sync when the board changes.

## Data flow

```
data producer
   |  congress.gov API (bills, members, Congressional Record), news/gov transcripts
   v
Data pre-processing            contract A --> semi-structured records
   |                           { id, content }  (LLM-ingestable text, ~10k rows)
   v                           speaker-tagged: <user>: ... / <other>: ...
Data process (Muse Spark)      contract B --> stance edges
   |                           { person, bill, domain, action, linkage, llm_confidence, source }
   v
[filter]  state=CA, attr={x,y,z}      e.g. "CA incumbent 52 congressmen"
   v
Data vis                        contract C --> derived in the browser (see packages/contract/derived.md)
```

## Data model (ERD)

```
person            bill              domain
---------         ---------         ---------------------
name: str (uniq)  url: str (uniq)   type: enum [closed set]
state: str

person_bill_m2m                     bill_domain_m2m
---------------                     -------------------------------
person_id  FK                       bill_id    FK
bill_id    FK                       domain_id  FK
action: str                         linkage: low | mid | high | super_high

source
----------------------------------------------
url_link: str
media_type: news | gov
media_name: cnn | usgov | fox | ...
transcript: whisper | official_transcript

stance (per person x bill, produced by LLM)
----------------------------------------------
direction: support | oppose | neutral
linkage: low | mid | high | super_high
llm_confidence: low | mid | high | super_high
quote: str            <- verbatim evidence
source_id: FK
```

Uniqueness: `person.name`, `bill.url`, `domain.type`, and (`person_id`,`bill_id`) are unique keys.

## Filtering

Filters apply at the process->vis boundary: `state`, `domain`, `person`, `linkage >= ...`, `llm_confidence >= ...`.
MVP filter: California incumbent House members (52).

## Where Meta models sit

| Stage | Model | Job |
|---|---|---|
| Data process | Muse Spark 1.3 (`muse-spark-1.3`) | read transcript chunk -> emit stance JSON per (person, bill) with quote + confidence |
| Data process (backfill) | Muse Spark Contributor | same prompt, 10x cheaper, for the ~10k historical rows |
| Domain tagging | Muse Spark 1.3 | bill -> domain enum + linkage |
| Vis (stretch) | Muse Wonder | agent answering questions over the graph |
| Vis (stretch) | Muse Image | per-issue share card |

## Contracts (current)

The board's contracts A/B/C are formalised in [`packages/contract/README.md`](../packages/contract/README.md): A = `record.schema.json`, B = the five data files the frontend loads, C = browser-side derivation rules. The shapes sketched above are the day-one draft and are superseded by that directory.
