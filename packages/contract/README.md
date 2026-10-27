# Contracts

Single source of truth for data crossing service boundaries. JSON Schema (draft 2020-12).

| File | Boundary | Producer -> Consumer |
|---|---|---|
| `preprocessed.schema.json` | contract A | ingest -> process |
| `stance.schema.json` | contract B | process -> api/db |
| `vis.schema.json` | contract C | api -> web |
| `domains.json` | closed enum | shared |

Changing any file here = open an issue with label `contract` first.
