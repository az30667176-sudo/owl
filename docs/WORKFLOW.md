# Team workflow: issue-driven, async

Three areas, three owners, one contract. Nobody blocks on a meeting: you open an issue.

## Labels

| Label | Meaning |
|---|---|
| `need backend review` | frontend/process finished a spec round; backend must review/confirm the contract |
| `need frontend review` | backend changed a payload; frontend must review |
| `contract` | touches `packages/contract/` and requires sign-off from both sides |
| `area:ingest` / `area:process` / `area:web` | ownership routing |
| `bug` | something that worked and broke |
| `blocked` | waiting on another issue; link it |
| `P0` | must land before submission (Nov 4) |

## The loop

1. Finish a round of spec work on your side.
2. Open an issue describing the contract you expect from the other side, tagged for their review.
3. The other side reviews, then either resolves (closes) or counter-proposes via a PR that `Closes #N`.
4. Every morning: clear your review queue first, then build.

## gh cheatsheet

```bash
# what is waiting on you
gh issue list --label "need backend review"
gh issue list --assignee @me

# open one
gh issue create --title "process -> vis payload: add llm_confidence" --label "need frontend review" --label contract --body "Proposed change to packages/contract/statements.schema.json: ..."

# work it
git checkout -b feat/12-confidence-field
git commit -m "process: emit llm_confidence (refs #12)"
gh pr create --fill --body "Closes #12"

# close with a note
gh issue close 12 --comment "Shipped in #15"
```

## Rules

- Contract changes (`packages/contract/`) land only via PR tagged `contract`, approved by the consuming side.
- Branch per issue: `feat/<issue>-<slug>`, `fix/<issue>-<slug>`.
- `main` is always demo-able after Nov 1.
- Milestones: M1 Contract frozen (Oct 28) -> M2 End-to-end on real data (Oct 31) -> M3 Submission (Nov 4, 9pm ET).
