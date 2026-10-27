# 🦉 OWL — Open Watch on Legislators

Evidence-anchored knowledge graph of legislators' stances on issues, built for the
**Meta Global AI Developer Hackathon** (Oct 26 – Nov 4, 2026, Indie track, theme: *Build for Your World*).

Pick an issue → see every legislator's position on it, with the quote and source that
justify the score. Pick a legislator → see where they stand across every issue.
Stances are extracted and scored by **Muse Spark** (Meta Model API); every edge carries
`source` + `llm_confidence` so a human can verify the model's reading.

## Pipeline

```
data producer ──► Data pre-processing ──► Data process ──► [filter] ──► Data vis
(congress.gov,      (semi-structured       (Muse Spark:      state=CA     (graph UI)
 transcripts)        {id, content}×10k)     stance / domain   attr={…}
                                            / confidence)
                        │                       │
                        └──── CONTRACT ─────────┘   packages/contract/*.schema.json
```

Each hop is governed by a frozen contract in [`packages/contract/`](packages/contract/).
Change the contract → open an issue first (see Workflow below).

## Repo layout

| Path | Owner area | What lives here |
|---|---|---|
| `services/ingest/` | `area:ingest` | congress.gov + transcript fetchers → semi-structured records |
| `services/process/` | `area:process` | Muse Spark scoring: person × bill × domain → stance, linkage, confidence |
| `apps/web/` | `area:web` | Graph dashboard (filter by state / domain / person) |
| `packages/contract/` | `area:contract` | JSON schemas shared by all three; the source of truth |
| `docs/` | — | [Architecture & ERD](docs/ARCHITECTURE.md) · [Workflow](docs/WORKFLOW.md) |

## Workflow (async, issue-driven)

1. Finish a round of spec work → **open an issue** describing the contract you expect from the other side.
2. Tag it `need backend review` or `need frontend review`; the owner of that area reviews and resolves.
3. Everyone periodically checks open issues tagged for their area (`gh issue list --label "need backend review"`).
4. PRs reference the issue (`Closes #12`). One review before merge.

Full cheatsheet: [docs/WORKFLOW.md](docs/WORKFLOW.md).

## Quick start

```bash
cp .env.example .env            # add MODEL_API_KEY (Meta Model API) + CONGRESS_API_KEY
gh issue list --label "need backend review"
```

## Meta models used

- **Muse Spark 1.3** — stance extraction, domain classification, confidence scoring (`services/process`)
- **Muse Spark Contributor** — bulk backfill at 1/10 the price
- **Muse Wonder** — demo research agent over the graph (stretch)
- **Muse Image** — shareable issue cards (stretch)
- **Muse Code** — team coding agent during development
