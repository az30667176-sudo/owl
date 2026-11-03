# NEXT — where the ingest work stands and what comes next (Nov 3, 2026, morning)

Read `AGENTS.md` first. This file is the running to-do; tick items off as you go and add what you learn.

## What changed in the repo on Nov 1–2 (Ben) and how this directory adapted

Ben (`benntuecon`) landed on `main` (`a771e90`, `9ef7186`): our Oct 30 CSV drop committed verbatim at the repo root
as `owl-ingest-csv-2026-10-30/` (same MANIFEST hashes as `out_full/csv/`), `services/ingest/csv-to-json.mjs` (CSV
drop -> contract-A records + taxonomy/issues/people/stances.json, zero dependencies, verifies MANIFEST.csv, tests in
`csv-to-json.test.mjs`), `services/process/extract-batch.mjs` / `extract-conditions.mjs` / `review-issues.mjs`, and
real data: 4,463 records (767 ours + 3,696 synthetic `rec-billstatus-*`), 27,248 statements, 187 issues (86 seeds
+ 101 model-proposed, reviewed), 443 summaries. Kurt shipped the web redesign on top. The root `.gitignore` now
ignores `.agents/` ("agent harness, untracked by design").

Adapted here (all tested Nov 2):

- **Landing path is `services/ingest/govinfo/`**, not `services/ingest/` (that directory is Ben's converter and has
  its own README). `m1/paths.py` finds the repo by walking up; `tools/ingest-weekly.sh`, `tools/ci-open-drop-pr.sh`
  (`INGEST_DIR`, default `services/ingest/govinfo`) and the workflow (`INGEST_DIR`) follow.
- **Ben's converter is the build's validation gate.** `ingest.py build` runs
  `node <repo>/services/ingest/csv-to-json.mjs out_full/csv state/staging --sub-names <repo>/data/taxonomy.json`
  and then `packages/contract/validate.mjs state/staging --records state/staging/records` (quotes checked). Result in
  `RESULT.build.converter` (`statements`, `records`, `synthetic_records`); `state/staging/` is git-ignored. Oct 30
  drop: 24,706 deterministic statements, 0 validator errors. Falls back to the old per-record check when the
  converter is absent.
- **Quote lines are now verbatim for every evidence row** (were 525 misses the converter had to repair): vote
  lines print `not voting` like the record (521 rows, their evidence ids changed once, Nov 2), and the 2 signers
  whose signature block sits in an earlier chunk (Budget views ending in bill text) quote the speaker-tag name.
- **The skill moved to `skills/ingest-weekly/`** (tracked). `tools/ingest-weekly.sh` copies it into
  `.agents/skills/` before `muse exec` (Muse Code scans only that directory; verified with `muse skills list`).
- The PR body of the weekly job now tells process what to run next (converter, then `extract-batch --merge-only`).
- Dress rehearsal in a scratch clone of `main` at the real layout (`services/ingest/govinfo/`, drop moved to
  `data/ingest/`): build + publish, converter + validator on the published copy as Ben runs them (manifest verified,
  0 errors), `git add` stages 23 files and no `cache/`, `out_full/`, `state/staging/` or `.agents/`, PR script dry run
  (new drop, unchanged drop), weekly `--direct` from inside the layout (idempotent), two builds give byte-identical
  manifests, agent mode (Muse Code headless, skill synced into `.agents/skills/`, report written in 45 s). Three small
  fixes came out of it: `.gitignore` patterns without a trailing slash (a symlinked `cache` was about to be staged),
  `MANIFEST.csv` no longer lists a stale hash of itself, and `build` clears `out_full/text/` first (a stale text
  file made report 59 show `text_parsed = yes`).

What the converter skips from our drop, for the record (not bugs on our side, but worth knowing):
`bill-without-issues=624` (25 bills with no seed issue; list in `out_full/owl/issues_report.md`),
`amendment-no-record=526` (by design), `duplicate-statement=485` (same signer across chunks; 68 amendment rows are
repeated in the vote summary and could be deduped here), `committee hsha in_graph=false but owns issues` (Kurt's
taxonomy choice; Ben includes it).

## What changed in the repo overnight Nov 2–3 (`051a1cb` -> `1d4b3f5`, read Nov 3 morning)

Eleven commits, nothing under `services/` or `data/`. **The drop, the converter gate and the validator pass
unchanged** (re-run Nov 3 against `1d4b3f5`: 24,793 statements, 0 errors, 1 pre-existing warning; Ben's 5 new
contract tests pass). No re-processing on our side: the schema additions are consumed by the converter, not by us.

- Kurt, 10 web commits: whip-count bar and one "negotiation map" per bill page, Bills tab with conditions first,
  multi-token bill numbers (H.J. Res. 25), Find table paged at 300 rows. `derive.mjs kindOf` untouched, so our
  `extraction_method` values still drive the labels. The web's `billId()` slugs the number out of the `bill`
  string (`H.J. Res. 59 …` -> `hjres59`) = our `bill_id` without the `-119` suffix.
- Ben `1d4b3f5` "contract: optional bill short_context + binary_question (#32)": new `packages/contract/bills.schema.json`
  (bills.json = 7th contract-B file: `bill_id`, `number`, `congress`, `title`, `short_title`, `status` enum without
  `unknown`, `introduced_date`, `last_action{date,text}`, `sponsor_id`, `issue_ids`, `url`, plus process-merged
  `short_context` <= 30 words and `binary_question` {question, 2 options support/oppose}). The validator checks it,
  plus `vote_question` requires `kind: vote` and `bill_id` references. README says bills.json is "emitted by
  csv-to-json.mjs from bills.csv" and that regens must carry `short_context`/`binary_question` forward by `bill_id`.
  **Not true yet:** the converter is unchanged and writes no bills.json; the web does not read it.
- **Gap to tell Ben (verified Nov 3):** `statements.schema.json` still has `additionalProperties: false` and no
  `kind` / `vote_question` / `bill_id`; a stances.json with one row carrying `kind` fails with
  `unexpected property "kind"`.
- New issues by Ben: #31 (web, collapse sidebar groups; nothing for us), #32 (bill match board, see drafts).
- `bills.csv` -> `bills.json` maps one to one except: `status = unknown` (12 bills) must be omitted; `short_title`
  is not in the drop (the cached BILLSTATUS XML has a short title for 717 of 785 bills; additive column, one rebuild).
- The report's "Purpose and Summary" section is parsed (762 purpose records in `out_full/records.jsonl`, median
  about 1,000 chars, cap 6,000) but not exported to the drop; a `purpose` column on `reports.csv` would feed #32's
  drafting prompt. Not asked for yet.
- `tools/ci-open-drop-pr.sh` PR body now also warns that `short_context`/`binary_question` must survive a regen.
- Issue-stance semantics (Nov 2 evening): sponsorship and vote rows are stances toward a *measure*; the converter
  maps "for the bill" to "supports the issue" for every bill, wrong whenever a bill restricts its issue
  (bank-regulation: H.J. Res. 59 disapproving a CFPB rule vs H.R. 1900 Bank Failure Prevention Act; all 86 seed
  issues hold 2+ bills). #32's reviewed `binary_question` is the missing per-bill direction; until it exists only
  speech rows carry a real issue stance. Written into the #26/#29/#32 drafts.

## What changed in the repo on Nov 3 morning (`1d4b3f5` -> `c64356b`, read Nov 3 midday)

Ben `f085296` "process fixes (#25-#28,#30) + bill match board (#32)" + docs `c64356b`. Local clone fast-forwarded;
gate re-run Nov 3 against the new code (counts below replace the Nov 2 numbers everywhere).

- **Schema gap closed:** `statements.schema.json` now carries `kind`, `vote_question`, `bill_id`. The #25 draft
  heads-up is deleted. Validator checks `vote_question` requires `kind: vote`, plus `complex_bill` rules.
- **Converter now emits `bills.json`** (`buildBillRecord`) and `kind`/`vote_question` on stances; skips
  `signed_views` (`views-no-stance-row`), `not_voting` (`not-voting-no-row`), amendments; one row per bill on the
  primary issue only; downgrades `checksum_failed` confidence. Pages copies `bills.json` + audit to the site.
- **Converter ignores our two new columns** and re-classifies from raw text: `classifyVoteQuestion`
  (from `vote_question`) instead of `evidence.vote_kind`, `classifyBillStatus` (from `latest_action_text`)
  instead of `bills.status`. Both additive columns still land; whether the converter consumes them is Ben's call
  (see #33 draft). Verified the converter still runs green on unknown columns.
- **#33 reconciled (measured):** Ben's ~1,907 unknown-question rows were counted on the Oct 30 drop, where 3,688
  questions were boilerplate. Re-ran his `classifyVoteQuestion` on both drops: old = 1,988 unknown, new = 86
  unknown, all "ordered adversely reported" (his `ordered favorably reported` pattern misses `adversely`). So our
  Nov 2 boilerplate strip fixes 96% of #33 once he re-runs on the new drop; the last 86 need one word in his
  pattern, or consuming our `vote_kind` (which labels them `final_passage`, correctly).
- **`extract.mjs` pilot fix still missing upstream:** `f085296` changed the scoring rubric (`SCORE_RUBRIC`,
  `resolveScore`, `kind: speech`) but not `max_tokens: 6000`, `reasoning_effort`, or fan-out. Re-flag in the PR.
- Fresh gate on the Nov 3 drop: converter -> 17,423 statements, 785 bills, 451 people, 86 issues, 4,475 records
  (3,707 synthetic); skips: views 1,257 / bill-without-issues 573 / amendment 527 / not-voting 524 /
  duplicate 332; validator 0 errors, 2 warnings (8 members + 3 issues with no statements; quotes checked 17,423,
  skipped 0). Converter + validator unit tests: 26/26 pass.
- New issues #33 (unknown-question votes; see above) and #34 (blind-audit corpus 3,268D/1R needs majority-party
  records: hearings/floor, post-M2 on our side). Draft replies added for both.

## For Ben (say it in the PR or the chat)

- `csv-to-json.mjs` rewrites `issues.json` from `issues.csv` (86 seeds) and `stances.json` from `evidence.csv`.
  After a weekly drop the 101 reviewed issues and the model statements must be put back (`extract-batch
  --merge-only --supersede-signatures`; check the issues survive, else `review-issues.mjs`). Alternative: have the
  converter union with the existing `issues.json`. His call.
- The drop should move from the dated root folder to `data/ingest/` (`git mv owl-ingest-csv-2026-10-30 data/ingest`)
  in the landing PR: one copy, overwritten weekly, `CHANGES.md` + `delta/` next to it. Dated folders would add
  14 MB per week.
- `--drop ingest-<date>` labels the data (the web header shows `_meta.drop`).
- Two alignment asks (both measured, see #33 draft): converter re-classifies votes and bill status from raw text
  instead of reading `evidence.vote_kind` and `bills.status`. Either consume the columns or keep the double
  classifiers; if kept, add `adversely` to the `ordered favorably reported` pattern (86 rows). When the converter
  rewrites `bills.json` it must read the existing one first and keep `short_context`/`binary_question` per
  `bill_id` (#32).
- The zip prepared Oct 30 is now moot: Ben committed the identical drop.

## Kurt's open issues (Nov 2) and what ingest did about them

Open: #25 (contract: optional `kind` + `vote_question` on statements), #26 (ingest: dedupe, weights, views,
not-voting), #27 (process: LLM score clustering), #28 (contract: optional `data/bills.json`; schema landed Nov 3),
#29 (web: score by kind), #30 (web: blind scoring audit), #31 (Ben, web: collapse sidebar groups), #32 (Ben: bill
match board, `short_context` + `binary_question` per bill). #20–24 closed by Ben's data. Draft replies for Hank to
post (#26, #25, #28, #32; updated Nov 3): `../owl-issue-comments-2026-11-02.md`.

Done here for #26/#25/#28 (Nov 2, evening, all in the drop):
- `vote_question` was truncated at 300 chars and lost the real question behind the rules boilerplate (3,688 vote
  rows read "In compliance with the Rules…"). Boilerplate stripped (`parse.BOILERPLATE_RE`), cap 600.
- New `evidence.csv` column `vote_kind` = `final_passage | amendment | procedural | unknown`
  (`build.classify_question`): 2,894 / 6,038 / 450 / 0. Final-passage only: one vote per person+bill, 0 yea+nay pairs.
- New `bills.csv` column `status` (`export_csv.bill_status`, from BILLSTATUS latest action): 442 passed_house,
  289 committee, 37 enacted, 3 passed_senate, 2 failed, 12 unknown. README: `seed_issue_ids` is best-first.
- Side effect: evidence ids of the ~3,900 vote rows whose question changed are new (one-time, before the first drop
  PR). Record content for ~75 vote records now shows the real question on the `On:` line.

## For Kurt (web, Nov 2 reading of `apps/web`)

- The UI labels every statement's kind from `model` (`owl-ingest-metadata` -> sponsored/cosponsored,
  `owl-ingest-rule` -> yea/nay/not voting/signed views, else speech). 23,913 of the 27,248 statements on `main` are
  ours (88%); the 2 "Voted present" rows are labelled "not voting" (score 0). A `kind` field in the contract would
  make the inference unnecessary; `evidence.csv` already carries `action` + `vote`.
- About page: the AI disclosure says statements are "scored offline by Muse Spark"; 88% are deterministic rows from
  committee reports (govinfo) and BILLSTATUS, no model. A "Sources" line (govinfo House reports, congress.gov
  BILLSTATUS, unitedstates/congress-legislators; model only for speech statements, summaries, conditions) would be
  accurate. The header chip shows `_meta.drop`, so weekly drops will read `data: ingest-<date>`.
- `pages.yml` deploys on any `data/**` push, so a CSV-only weekly merge redeploys the site unchanged; harmless, or
  add `paths-ignore: data/ingest/**` if it bothers him.

## Next, in order

1. **File the ingest issue** from `../owl-issue-ingest.md` (labels `contract`, `area:ingest`, `need backend review`,
   `need frontend review`; milestone M2). Its number N names the branch. `gh issue create` from the user's shell, or
   ask before doing it from the agent.
2. **OpenSpec change** in the repo clone (`../owl`): "openspec propose ingest service" (the repo README asks for it;
   `openspec` 1.15.0 is installed on this Mac). Under 400 words, contract A, issue #N. Requirements: weekly check /
   backfill, drop at `data/ingest/`, stable ids, converter + validator gate.
3. **Land the service**: branch `feat/N-ingest-service` in `../owl`; copy this directory to `services/ingest/govinfo/`
   (code, `README.md`, `AGENTS.md`, `NEXT.md`, `tools/`, `skills/`, `state/packages.json`, `state/handoff_keys.json`;
   NOT `cache/`, `out/`, `out_full/`, `state/runs/`, `state/staging/`, `.agents/`); add one line to Ben's
   `services/ingest/README.md` pointing at `govinfo/`; add the repo-root `AGENTS.md` and `tools/muse-owl.sh` from
   `../muse-code/`; copy `tools/github-workflow-ingest-weekly.yml` to `.github/workflows/ingest-weekly.yml`;
   `git mv owl-ingest-csv-2026-10-30 data/ingest`. Then `python3 -I services/ingest/govinfo/ingest.py build --publish
   data/ingest` (needs `cache/` -> copy the 120 MB cache next to it or run `ingest.py backfill` once, ~15 min); the
   converter gate must pass; commit with both trailers; push and PR (`Closes #N`) from the user's shell.
4. **Tell Ben** (section above) and point him at `data/ingest/README.md` (data dictionary) and `CHANGES.md`.
5. **Schedule**: after the merge, Kurt adds the `META_API_KEY` secret and allows Actions to create PRs; then one
   manual `workflow_dispatch` and read the uploaded `state/last_report.md`.

## Decisions made (Hank, Oct 30; paths updated Nov 2)

- Muse Code sessions: `muse-spark-1.3-contributor` (`tools/muse-owl.sh` and `tools/ingest-weekly.sh` default to it).
- The CSV drop lives in the repo at `data/ingest/` (about 15 MB of CSV; the Pages workflow ignores it).
- The weekly job runs on a GitHub Actions cron (`tools/github-workflow-ingest-weekly.yml` -> `.github/workflows/`),
  with Muse Code installed on the runner operating the run. Muse Code has no hosted computer (the scheduled-VM
  feature belongs to the consumer Muse app), so the runner is the agent's machine. Needs from Kurt (repo admin):
  the `META_API_KEY` secret (agent mode; without it the job runs the pipeline directly) and Settings > Actions >
  General > "Allow GitHub Actions to create and approve pull requests".
  Tested Oct 30 on this Mac: `ingest.py run` end to end; `tools/ingest-weekly.sh --direct`; agent mode (Muse Code
  headless, contributor model, `--disable-sandbox`) writing `state/last_report.md` in 35 s; `tools/ci-open-drop-pr.sh`
  dry runs; `actionlint` clean. Re-tested Nov 2 after the layout change: build with the converter gate, PR script dry
  runs on the `services/ingest/govinfo` layout, skill sync, `actionlint`. Still untested until the first
  `workflow_dispatch` on a Linux runner: the Muse installer there, `actions/cache` round trip, PR creation.

## Data-quality follow-ups (small, deterministic)

- 25 reported bills have no seed issue (CRS subjects match nothing): 624 evidence rows never become statements.
  A policy-area fallback in `m1/seed_issues.py` would catch most ("Sports and Recreation" x3, "Government Operations
  and Politics" x5).
- 68 `offered_amendment` rows are duplicates (the amendment list repeats in the vote summary of the same report).
- `parse._name_line` accepts role words ("Secretary" x13 in H. Rept. 119-106 Book 2); they resolve to nobody.
- PDF fallback: names with diacritics in vote tables (García) are lost; views text through the PDF path is untested.
- 8 vote tables with `checksum_failed` (Ben downgrades their confidence: 418 rows).
- 120th Congress (Jan 2027): ids are pinned to `CRPT-119hrpt*` in `fetch.sitemap_entries`; roster files need a refresh.

## Later (not before M2)

- Bill-direction step for stance option 3(b) (~782 short Muse calls, ~$2) so votes/sponsorships become issue-level
  stance rows (`stance_toward_bill` x direction). Ben's #32 `binary_question` may supply it; if not, a `bills.csv`
  column `issue_direction` (advances | restricts | unclear per bill+issue; disapproval resolutions and appropriations
  are rule-decidable) is the ingest-side version.
- Additive columns if asked: `bills.csv short_title` (BILLSTATUS, 717/785 bills), `reports.csv purpose` (762 parsed
  sections) for #28/#32. Each is one rebuild; evidence ids unaffected.
- Hearing transcripts (M3). Floor roll calls from clerk.house.gov for members whose committees file few reports.
