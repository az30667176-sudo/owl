"""Narration for the demo video: one mp3 per segment, plus word timings.

    python tools/demo/tts.py [tools/demo/segments-walkthrough.json]

Writes tools/demo/out/audio/<out>/<id>.mp3 and <id>.words.json (each word's start in
seconds from the segment start) so tools/demo/record.mjs can move the cursor when a word
is spoken. Uses the edge-tts package (Microsoft neural voices; the segment text is sent to
that service). Meta's model API has speech-to-text only, so the voice is not a Meta model.
"""
import asyncio, json, pathlib, sys
import edge_tts

ROOT = pathlib.Path(__file__).resolve().parents[2]
SEGFILE = sys.argv[1] if len(sys.argv) > 1 else "tools/demo/segments.json"
SEG = json.loads((ROOT / SEGFILE).read_text(encoding="utf-8"))
OUT = ROOT / "tools/demo/out/audio" / SEG["_meta"].get("out", "owl-demo")
OUT.mkdir(parents=True, exist_ok=True)


async def one(s, voice, rate):
    f, wf = OUT / f"{s['id']}.mp3", OUT / f"{s['id']}.words.json"
    if f.exists() and wf.exists() and f.stat().st_size > 2000:
        return
    for attempt in range(4):  # the service occasionally returns no audio; retry
        try:
            audio, words = bytearray(), []
            com = edge_tts.Communicate(s["text"], voice, rate=rate, boundary="WordBoundary")
            async for ch in com.stream():
                if ch["type"] == "audio":
                    audio += ch["data"]
                elif ch["type"] == "WordBoundary":
                    words.append({"t": ch["offset"] / 1e7, "d": ch["duration"] / 1e7, "w": ch["text"]})
            if not audio:
                raise edge_tts.exceptions.NoAudioReceived("empty")
            f.write_bytes(bytes(audio))
            wf.write_text(json.dumps(words), encoding="utf-8")
            print("wrote", s["id"], len(words), "words")
            return
        except edge_tts.exceptions.NoAudioReceived:
            await asyncio.sleep(2 + 2 * attempt)
    raise SystemExit(f"no audio for {s['id']}")


async def main():
    voice = SEG["_meta"].get("voice", "en-US-AndrewNeural")
    rate = SEG["_meta"].get("rate", "-4%")
    for s in SEG["segments"]:
        await one(s, voice, rate)

asyncio.run(main())
