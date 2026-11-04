# OWL demo script (2-minute voiceover)

Generated with Muse Spark (Meta Model API), tuned to the Indie-track criteria: **creativity, technical ambition, and whether it works**, theme *Build for Your World*.

Production: script by Muse Spark → neural TTS at −10% rate (OpenAI TTS had no credits;
Meta offers speech-to-text only) → verified round-trip through Meta Muse Voice Transcribe
(measured duration 1:59, transcript matches this script, single speaker). Audio: `narration.mp3`.

---

Last fall before I voted, I tried to answer a simple question: what has my representative actually said and done?

I couldn't. The votes were scattered across hundreds of bills, the quotes were buried in committee reports and long transcripts. So for Build for Your World, we built OWL, Open Watch on Legislators.

OWL is a map that connects people, issues, and votes, so you can see where all 451 House members stand on 187 issues, across 782 bills and 20,608 statements. And nothing is asserted without evidence. Every position links to the exact quote and official source, one click away.

Here's what that looks like. Pick an issue, and you see every member placed on a spectrum, colored by where they stand. Pick a person, and you see their stances, where they break from their party, and how their position changed over time.

Answer three yes or no questions about bills, and you get your match board, your closest and farthest legislators ranked, which you can filter by party, state, or your answers.

The creative core is trust. Muse Spark reads those reports and transcripts and pulls out each stance with the verbatim quote, a calibrated score, meaning every score uses the same minus one to one scale, and a plain-language summary of the bill with a yes or no question. Nothing merges until a person approves it. Muse Spark also writes each legislator summary where every sentence cites its sources, and it re-scored 101 quotes with names hidden to check for bias. Before the model ever sees anything, a pipeline with no model calls checks the data and refuses anything malformed. Even our logo was drawn by Muse Image.

It works today. Try it, pick your issue, and see for yourself.
