# Prompt: make a demo-video segment in the OWL house style

Paste everything below the line into your coding agent (Claude Code, Muse Code, ...) from the
repo root. Replace the three `<...>` placeholders first.

---

You are making one segment of the OWL hackathon demo video. OWL (Open Watch on Legislators) is a
static web app: live at https://az30667176-sudo.github.io/owl/ , source in `apps/web/index.html`.
Match the existing middle segment exactly in style and tooling. It was produced by the files in
`tools/demo/` and you must reuse them, not invent a new pipeline.

**My segment:** <WHAT YOUR SEGMENT COVERS, e.g. "how the data pipeline and Meta models work">
**Length:** <TARGET LENGTH, e.g. 0:30–0:45>
**What must appear on screen:** <PAGES / FILES / ACTIONS, e.g. "the About page section 'What Muse
Spark does here', the GitHub repo's packages/contract folder, a validator run">

## How the existing segment was made (read these files first)

- `tools/demo/segments-walkthrough.json`: the narration, one entry per shot:
  `{ "id": "k01", "shot": "kLand", "text": "..." }`. `_meta` sets `out` (output name),
  `voice` (`en-US-BrianMultilingualNeural`), and `rate` (`+7%`).
- `tools/demo/tts.py <segments.json>`: makes one mp3 per segment and a `<id>.words.json`
  with each word's start time. It uses the `edge-tts` Python package (Microsoft neural voice).
  Meta's API has no text-to-speech, so say so if anyone asks.
- `tools/demo/walkthrough.mjs --segments <segments.json> --base <app url>`: drives headless
  Google Chrome with `playwright-core` and captures every repaint through the DevTools
  screencast. It plays each shot while that segment's audio runs, then muxes everything with
  ffmpeg into `tools/demo/out/<out>-hq.mp4` (1920×1080, 30 fps, x264 CRF 16, AAC 192k).
  Each shot is an async function in its `SHOTS` object. Helpers: `cue(word)` waits until the
  narration reaches that word, so the cursor moves when the word is spoken. `pointAt(sel)` and
  `clickSel(sel)` move a visible amber cursor and click. `findNode(/regex/)` locates a committee
  or topic dot on the Explore canvas by sweeping hover tooltips; `go(url)` always does a full
  page load.
- Output and audio live in `tools/demo/out/`, which git ignores.

## Do this

1. Create `tools/demo/segments-<yourname>.json` with the same shape. Set `_meta.out` to
   `owl-<yourname>` and keep the same `voice` and `rate`. Write the narration in a casual
   spoken style: contractions, short sentences, "Now", "Then", "Click X, and you get Y". Say
   where to look ("in the right panel", "below the ring", "at the top"). Use exact numbers
   only if they are true in today's data. Check them in `data/*.json` or on the live site.
   Mention Muse Spark only for what it actually does in this repo. Do not claim Muse Wonder.
2. Add one shot function per segment to `SHOTS` in `tools/demo/walkthrough.mjs`. Name them
   with your own prefix (e.g. `pData`, `pAudit`) so you never touch the existing `k*` shots.
   Inside each shot, call `cue("<word from that segment's text>")` before every cursor move or
   click, in the order the words are spoken. Cue words must appear in that segment's text. A
   prefix match is enough (`cue("summary")` matches "summary's").
3. Before the narration starts, find any canvas node positions you need (see how `PRE` is
   built). A scan during a shot stalls the picture.
4. Install once if missing: `npm install` inside `tools/demo/`, then
   `npx playwright-core install ffmpeg`, then `pip install edge-tts`, then ffmpeg on PATH
   (Windows: `winget install Gyan.FFmpeg`). The recorder uses the installed Google Chrome; no
   browser download is needed.
5. Run `python tools/demo/tts.py tools/demo/segments-<yourname>.json`, then
   `node tools/demo/walkthrough.mjs --segments tools/demo/segments-<yourname>.json --base https://az30667176-sudo.github.io/owl/`.
6. Check the result before calling it done:
   - The console must not print `ran N s past its narration` above about 0.5 s. If it does,
     that shot is too slow: move scans earlier, shorten sleeps, or reword so the cue word comes
     later.
   - It must not print `cue "<word>" not in <id>`.
   - Pull a frame every few seconds with
     `ffmpeg -ss <t> -i tools/demo/out/owl-<yourname>-hq.mp4 -frames:v 1 f.png` and look at
     them. The cursor must sit on the thing being named, with no loading spinners and no
     empty panels.
   - Keep the total within the target length (ffprobe the mp4).
7. No on-screen captions (the shared segment has none). No music. Do not change
   `apps/web/index.html`, `data/`, `services/` or `packages/`. If the site needs a fix for the
   shot to work, stop and report it instead of editing it.
8. Hand back the mp4 path, its length, and the final narration text.

## Style reference

The shared middle segment shows how the result should look and sound:
`tools/demo/segments-walkthrough.json` with its `k*` shots. In it, a visitor types a ZIP into
the top search bar, opens a member's profile, clicks a citation number to read the quote, opens
a bill, then picks a topic on the Explore ring, answers three yes/no questions and opens "Show
matches". Every cursor move lands on the word that names it.

---

# Prompt: write the narration script for a segment (run this first)

Write the narration script for one segment of the OWL demo video, as
`tools/demo/segments-<yourname>.json`. Do not record anything yet. Write the script and walk it
on the live site first.

**My segment:** <WHAT YOUR SEGMENT COVERS>
**Length:** <TARGET LENGTH, e.g. 0:30–0:45>
**Story I want to tell:** <ONE OR TWO SENTENCES, e.g. "how a hearing transcript becomes a quoted,
scored statement, and how we check the model for bias">

## Step 1: walk the real site before writing a word

Open https://az30667176-sudo.github.io/owl/ in a browser you can drive (a 1920×1080 window). Do
the exact clicks your segment will show, in order. Write down, for each step:
- the URL or hash you are on (`#/explore`, `#/legislator/<id>`, `#/bill/<id>`, `#/issue/<id>`,
  `#/about`, ...);
- the exact visible labels you will point at (button text, panel headings, numbers on screen);
- where each one sits ("top search bar", "right panel", "below the ring", "left panel");
- anything that breaks, loads slowly, shows an empty panel, or needs scrolling to be seen.

If a step does not work on the live site, stop and report it. Do not write narration around a
broken screen. Use only names and numbers you saw on screen or read in `data/*.json`; never
make up a member, a bill, a count or a feature.

## Step 2: write the segments

One segment per screen action, usually 1 to 3 sentences each. Shape:

    {
      "_meta": { "description": "...", "out": "owl-<yourname>",
                 "voice": "en-US-BrianMultilingualNeural", "wordsPerSecond": 2.8, "rate": "+7%" },
      "segments": [
        { "id": "p01", "shot": "pIntro", "caption": "", "text": "..." }
      ]
    }

Rules for the text:
- **Length budget:** total words ≈ target seconds × 2.6. For example, 40 s is about 105 words.
  Count them.
- **Spoken, not written:** contractions, short sentences, everyday words. Use bridges like
  "Now", "Then", "Say you…". Write "Click X, and you get Y". No marketing adjectives.
- **Tell people where to look:** name the place each time: "at the top", "in the right panel",
  "below the ring", "on the left".
- **One action per sentence**, in the order the cursor does it. The noun you say is the thing
  the cursor will be on at that moment (this becomes a `cue()` word).
- **Accuracy:** OWL covers 451 House members and 20 committees, and its topics sit under
  subcommittees. The committee structure is official. Topics are seeded from CRS subject tags
  and named by Muse Spark, then human-reviewed. Muse Spark extracts stances with verbatim
  quotes, writes cited summaries, drafts the yes/no bill questions (a person reviews them), and
  runs a blind re-scoring audit. Muse Code wrote much of the front end from specs. Do not
  mention Muse Wonder or anything the repo does not do. Explore ring lines show attention, not
  agreement.
- **Hand-off:** your first and last sentences must connect to the segments before and after
  yours. Ask the team for their first and last lines if you do not have them.

## Step 3: mark the cue words

Under the JSON, list for each segment the shot plan as `word → action`, for example
`search → point at #gs`, `click → click #gs`, `heres → type 91204`. Every word must appear in
that segment's text, and the words must run in spoken order. These become the `cue()` calls in
`tools/demo/walkthrough.mjs`.

## Step 4: check

- Read the script aloud with a timer. It must fit the target length.
- Re-walk the site following only your script. Each sentence must match what is on screen at
  that moment.
- Hand back the JSON file, the word count, the estimated length, and the cue plan.
