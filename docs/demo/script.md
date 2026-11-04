# OWL demo script (2-minute voiceover)

Structure per direction: mission and vision first (first 30-60 seconds), the app today with exactly two numbers (451 members, 20,608 statements), how it is built on Meta Spark and Wonder, then the future — decades of past Congresses, public social-media ingestion, runtime natural-language answers at a hundred times the data on Meta cost-efficient model serving.

Production: script by Muse Spark (Meta Model API) → neural TTS at -6% rate (OpenAI TTS had no credits; Meta offers speech-to-text only) → verified round-trip through Meta Muse Voice Transcribe (measured duration 2:02, transcript matches this script, single speaker). Audio: `narration.mp3`.

---

Before voting, every citizen deserves to know what their representative actually said and did — but that record is scattered across bills, reports, and transcripts nobody has time to read. At OWL, Open Watch on Legislators, our mission is to make every position in Congress legible, searchable, and backed by the exact quote behind it. Our vision is a public evidence graph of the legislature: linking every claim to the words and votes behind it, where asking for proof always gets a clear answer.

Here is what OWL does today. Pick an issue and see 451 House members placed along a spectrum by where they stand. Pick a member and see their stances, where they break with their party, and how those views have shifted over time. Answer a short set of yes-or-no questions about current bills and get a ranked match board showing your closest and farthest legislators, filterable by party and state. Behind that view are 20,608 statements, each tied to its source.

It is built to stay trustworthy. Official records pass through a deterministic pipeline — no model calls while gathering data — and must meet strict contracts before anything is modeled. Then Meta's Spark and Wonder APIs do the reading: extracting stances with verbatim quotes, scoring them on one calibrated scale, summarizing each legislator with citations, and drafting plain-language bill questions.

Looking ahead, we start with the current Congress. The same pipeline can reach back across twenty or thirty years of past Congresses, plus members' public social-media posts on Meta platforms and other public media, using Meta's model serving to process big archives in batches, cost-effectively. Next, the front end will let a visitor ask in plain words and get an answer drawn from the evidence base, also in plain words, with quotes. Even at a hundred times today's data, Meta's cost-efficient model serving keeps that practical.

Come explore your Congress and see the proof for yourself.
