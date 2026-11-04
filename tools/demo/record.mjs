// Records the OWL demo video: plays one shot per narration segment (tools/demo/segments.json)
// against the live site, then muxes the narration over it.
//
//   node tools/demo/record.mjs [--base https://az30667176-sudo.github.io/owl/] [--local http://127.0.0.1:8765/]
//
// Needs: playwright-core (uses the installed Google Chrome), Playwright's ffmpeg for video
// capture, and a full ffmpeg on PATH for the audio mux. Narration per segment is read from
// tools/demo/out/audio/<id>.mp3 (tools/demo/tts.py writes them); without audio the timeline
// falls back to segments.json wordsPerSecond and the video is written silent.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "https://az30667176-sudo.github.io/owl/");
const LOCAL = arg("--local", "http://127.0.0.1:8765/");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const OUT = path.join(ROOT, "tools/demo/out");
const SEGFILE = arg("--segments", "tools/demo/segments.json");
const W = 1440, H = 900;
fs.mkdirSync(OUT, { recursive: true });

const seg = JSON.parse(fs.readFileSync(path.join(ROOT, SEGFILE), "utf8"));
const NAME = seg._meta.out || "owl-demo";
const AUDIO = path.join(OUT, "audio", NAME);
const has = cmd => { try { execFileSync(cmd, ["-version"], { stdio: "ignore" }); return true; } catch { return false; } };
const FF = has("ffmpeg") && has("ffprobe");
const dur = s => {
  const f = path.join(AUDIO, s.id + ".mp3");
  if (FF && fs.existsSync(f)) return +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim();
  return s.text.split(/\s+/).length / seg._meta.wordsPerSecond;
};
const PAD = 0.3; // breath between segments
const timeline = []; let t = 0;
for (const s of seg.segments) { const d = dur(s) + PAD; timeline.push({ ...s, start: t, dur: d }); t += d; }
console.log(`timeline ${t.toFixed(1)} s, ${timeline.length} segments, audio ${FF && fs.existsSync(AUDIO) ? "per segment" : "estimated"}`);

// ---- terminal card: real validator output + blind-audit summary, rendered as a page ----
function terminalHtml() {
  let v = "";
  try { v = execFileSync("node", ["packages/contract/validate.mjs", "data", "--records", "data/records"], { cwd: ROOT }).toString(); }
  catch (e) { v = (e.stdout || "").toString() + (e.stderr || "").toString(); }
  const a = JSON.parse(fs.readFileSync(path.join(ROOT, "data/audit/blind-scoring.json"), "utf8"));
  const S = a.summary, top = S.top10.slice(0, 4);
  const esc = x => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const q = id => { const r = a.rows.find(z => z.statement_id === id); return r ? r.quote : ""; };
  return `<!doctype html><meta charset="utf-8"><title>OWL pipeline</title>
<style>body{margin:0;background:#0f1322;color:#efe6d2;font:15px/1.55 "JetBrains Mono",Consolas,monospace;display:grid;grid-template-columns:1fr 1fr;gap:28px;padding:48px;height:100vh;box-sizing:border-box}
section{border:1px solid #2c3348;background:#171c2e;padding:22px 24px;overflow:hidden}h2{font:600 12px Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;color:#f0b429;margin:0 0 14px}
pre{white-space:pre-wrap;margin:0}.p{color:#9aa3b2}.ok{color:#3fcf77}.w{color:#f0b429}.n{color:#efe6d2;font-weight:700}.row{border-top:1px solid #2c3348;padding:8px 0;font-size:13px}.q{color:#c9c2b0;font-family:Georgia,serif;font-style:italic}</style>
<section id="validate"><h2>Contract gate · packages/contract/validate.mjs</h2><pre><span class="p">$ node packages/contract/validate.mjs data --records data/records</span>
${esc(v).replace(/^(OK.*)$/m, '<span class="ok">$1</span>').replace(/^(warn.*)$/gm, '<span class="w">$1</span>')}</pre></section>
<section id="audit"><h2>Blind audit · Muse Spark re-scores with name and party hidden</h2>
<pre><span class="p">${esc(a._meta.model)} · n=${S.n} · ${esc(a._meta.at)}</span>
direction agreement  <span class="n">${Math.round(S.direction_agreement * 100)}%</span>
mean |score change|  <span class="n">${S.mean_abs_diff.toFixed(2)}</span>
flagged for review   <span class="n">${S.top10.length}</span> largest changes</pre>
${top.map(r => `<div class="row">${r.statement_id} · published <b>${r.published > 0 ? "+" : ""}${r.published}</b> → blind <b>${r.blind > 0 ? "+" : ""}${r.blind}</b><div class="q">“${esc(q(r.statement_id).slice(0, 150))}${q(r.statement_id).length > 150 ? "…" : ""}”</div></div>`).join("")}
</section>`;
}
fs.writeFileSync(path.join(OUT, "terminal.html"), terminalHtml());

// ---- recording ----
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--hide-scrollbars"] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: OUT, size: { width: W, height: H } } });
const tStartVideo = Date.now();
// visible cursor + caption bar (headless capture has no OS cursor)
await ctx.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.id = "__cur"; c.style.cssText = "position:fixed;z-index:2147483647;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;border:2px solid #f0b429;background:rgba(240,180,41,.25);pointer-events:none;left:-40px;top:-40px;transition:transform .12s";
    document.documentElement.appendChild(c);
    addEventListener("mousemove", e => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", () => c.style.transform = "scale(.7)", true);
    addEventListener("mouseup", () => c.style.transform = "", true);
    const cap = document.createElement("div");
    cap.id = "__cap"; cap.style.cssText = "position:fixed;z-index:2147483646;left:50%;bottom:28px;transform:translateX(-50%);padding:10px 18px;background:rgba(15,19,34,.92);border:1px solid #4a5372;border-left:3px solid #f0b429;color:#efe6d2;font:600 17px 'Public Sans',Segoe UI,sans-serif;letter-spacing:.01em;pointer-events:none;opacity:0;transition:opacity .4s;white-space:nowrap";
    document.documentElement.appendChild(cap);
    const t = sessionStorage.getItem("__cap"); if (t) { cap.textContent = t; cap.style.opacity = 1; }
  });
});
const page = await ctx.newPage();
page.setDefaultTimeout(5000); // a missing element costs 5 s, not 30
const sleep = ms => new Promise(r => setTimeout(r, ms));
const caption = async text => { await page.evaluate(t => { sessionStorage.setItem("__cap", t); const c = document.getElementById("__cap"); if (c) { c.textContent = t; c.style.opacity = t ? 1 : 0; } }, text || "").catch(() => {}); };
let mx = W / 2, my = H / 2;
const moveTo = async (x, y, ms = 600) => { const steps = Math.max(8, Math.round(ms / 16)); await page.mouse.move(x, y, { steps }); mx = x; my = y; };
const clickAt = async (x, y) => { await moveTo(x, y); await sleep(120); await page.mouse.down(); await sleep(70); await page.mouse.up(); };
const clickSel = async (sel, nth = 0) => { const el = page.locator(sel).nth(nth); await el.scrollIntoViewIfNeeded(); const b = await el.boundingBox(); if (!b) throw new Error("no box " + sel); await clickAt(b.x + b.width / 2, b.y + b.height / 2); };
// always a real load: a goto that only changes the hash would keep the old view (zoom, pins)
const go = async (url, wait = 1500) => { if (page.url() !== "about:blank") await page.goto("about:blank"); await page.goto(url, { waitUntil: "domcontentloaded" }); await sleep(wait); };
const smoothScroll = async (px, ms) => { const n = Math.round(ms / 40); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, px / n); await sleep(40); } };
// canvas node finder: sweep mousemove over the ring and read the hover tooltip
const findNode = async re => page.evaluate(src => {
  const rx = new RegExp(src), cv = document.querySelector("#main canvas"), R = cv.getBoundingClientRect();
  for (let y = R.top + 8; y < R.bottom - 8; y += 6) for (let x = R.left + 8; x < R.right - 8; x += 6) {
    cv.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }));
    const t = document.querySelector(".cond-tip");
    if (t && getComputedStyle(t).display !== "none" && rx.test(t.innerText) && !/Rep\.|Sen\./.test(t.innerText)) return { x, y };
  }
  return null;
}, re.source);

const SHOTS = {
  async govinfo() { await go("https://www.govinfo.gov/content/pkg/CRPT-119hrpt4/html/CRPT-119hrpt4.htm", 1200); await moveTo(W * .55, H * .45, 900); await smoothScroll(5200, 9000); },
  async home() {
    await go(BASE + "#/explore", 2500);
    await page.evaluate(() => { localStorage.removeItem("owl-intro"); localStorage.removeItem("owl-match"); });
    await go(BASE + "#/explore", 3000);
    await moveTo(W * .42, H * .45, 1500); await sleep(1500);
    const b = await page.locator(".intro").boundingBox(); if (b) { await moveTo(b.x + 40, b.y + 60, 1200); await moveTo(b.x + 40, b.y + 170, 2500); }
  },
  async topic() { await go(BASE + "#/issue/tax-administration-and-irs", 3500); await moveTo(W * .45, H * .5, 900); await smoothScroll(420, 3000); await sleep(800); await smoothScroll(-420, 1500); },
  async member() {
    await go(BASE + "#/explore", 1200);
    await clickSel("#gs"); await page.keyboard.type("Courtney", { delay: 90 }); await sleep(700); await page.keyboard.press("Enter");
    await page.waitForFunction(() => location.hash.indexOf("#/legislator/") === 0, null, { timeout: 8000 }).catch(() => {});
    await sleep(2600);
    if (await page.locator("a.cite").count()) { await clickSel("a.cite", 1); await sleep(1800); }
    await clickSel('.tabs button[data-tab="timeline"]'); await sleep(1600);
  },
  async match() {
    await go(BASE + "#/explore", 2000);
    await clickSel('[data-intro="try"]').catch(async () => { await go(BASE + "#/explore?com=hsba", 2000); });
    await sleep(1800);
    const n = await findNode(/Securities and Capital Markets/); if (n) { await clickAt(n.x, n.y); await sleep(1500); }
    for (let i = 0; i < 3; i++) { await clickSel('#side [data-mq][data-st="support"]', i).catch(() => {}); await sleep(650); }
    await clickSel('[data-esdr="open"]').catch(() => {}); await sleep(1500);
    await clickSel("#e-summary .es-m .es-mh").catch(() => {}); await sleep(2000);
    await page.locator("#es-state").selectOption("CA").catch(() => {}); await sleep(1500);
  },
  async terminal() { await go(LOCAL + "tools/demo/out/terminal.html", 800); await moveTo(W * .25, H * .4, 1200); await sleep(800); await moveTo(W * .28, H * .62, 1500); },
  async evidence() {
    await go(BASE + "#/legislator/C001069", 3500);
    const row = page.locator('.attn-row[data-to="k-12-education"]');
    if (await row.count()) { await clickSel('.attn-row[data-to="k-12-education"]'); } else { await clickSel(".attn-row"); }
    await sleep(1500); const q = await page.locator("#side blockquote").first().boundingBox(); if (q) await moveTo(q.x + q.width * .3, q.y + q.height / 2, 1200);
  },
  async audit() { await go(LOCAL + "tools/demo/out/terminal.html", 600); const b = await page.locator("#audit").boundingBox(); if (b) { await moveTo(b.x + 120, b.y + 110, 1000); await moveTo(b.x + 160, b.y + 260, 1800); } },
  async bill() { await go(BASE + "#/bill/hr1013", 3500); const b = await page.locator(".chip.yn").first().boundingBox(); if (b) await moveTo(b.x + b.width / 2, b.y + b.height / 2, 1200); await sleep(1600); await go("https://github.com/az30667176-sudo/owl/tree/main/openspec/changes/archive", 2500); await moveTo(W * .4, H * .5, 1200); },
  async zoom() {
    await go(BASE + "#/explore", 3000);
    const cv = await page.locator("#main canvas").boundingBox(); const cx = cv.x + cv.width / 2, cy = cv.y + cv.height / 2;
    await moveTo(cx, cy, 900); for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, -120); await sleep(90); }
    await sleep(1600); for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 120); await sleep(110); }
  },
  async about() { await go(BASE + "#/about", 2000); const h = page.getByText("What Muse Spark does here"); if (await h.count()) { await h.first().scrollIntoViewIfNeeded(); const b = await h.first().boundingBox(); if (b) await moveTo(b.x + 60, b.y + 40, 1200); } },
  async end() { await go(BASE + "#/explore", 2500); await moveTo(W * .5, H * .4, 900); },
  // ---- middle segment: how to use the site ----
  async mLand() {
    await go(BASE + "#/explore", 1500);
    await page.evaluate(() => { localStorage.removeItem("owl-intro"); localStorage.removeItem("owl-match"); });
    await go(BASE + "#/explore", 2500);
    const cv = await page.locator("#main canvas").boundingBox();
    await moveTo(cv.x + cv.width * .5, cv.y + cv.height * .5, 1400);
    const c = await findNode(/Financial Services/); if (c) await moveTo(c.x, c.y, 1500);
    await sleep(900); await moveTo(cv.x + cv.width * .42, cv.y + cv.height * .45, 1500);
  },
  async mCommittee() {
    const c = await findNode(/Financial Services/); if (c) { await clickAt(c.x, c.y); } else { await go(BASE + "#/explore?com=hsba", 2000); }
    await sleep(2200);
    const cv = await page.locator("#main canvas").boundingBox();
    await moveTo(cv.x + cv.width * .45, cv.y + cv.height * .42, 1600); await sleep(1500);
  },
  async mTopic() {
    const n = await findNode(/Securities and Capital Markets/); if (n) { await moveTo(n.x, n.y, 1200); await sleep(500); await clickAt(n.x, n.y); }
    await sleep(1500);
    const r = await page.locator("#side .mq").first().boundingBox(); if (r) await moveTo(r.x + 80, r.y + 14, 1200);
  },
  async mAnswer() { for (let i = 0; i < 3; i++) { await clickSel('#side [data-mq][data-st="support"]', i).catch(() => {}); await sleep(1300); } },
  async mMatches() {
    await clickSel('[data-esdr="open"]').catch(() => {}); await sleep(2000);
    await clickSel("#e-summary .es-m .es-mh").catch(() => {}); await sleep(3000);
    await page.locator("#es-state").selectOption("CA").catch(() => {}); await sleep(1500);
  },
  async mProfile() {
    await go(BASE + "#/legislator/C001069", 3200);
    const s = page.locator(".ai-sum, .summary, #profile").first(); await moveTo(W * .42, H * .38, 1200);
    if (await page.locator("a.cite").count()) { await clickSel("a.cite", 1); await sleep(1600); const q = await page.locator("#side blockquote").first().boundingBox(); if (q) await moveTo(q.x + 60, q.y + q.height / 2, 1000); }
  },
  async mTimeline() {
    await clickSel('.tabs button[data-tab="timeline"]'); await sleep(1500);
    const g = page.locator("#ptimeline g").filter({ hasText: "K-12" }).first();
    const b = await g.boundingBox().catch(() => null); if (b) await moveTo(b.x + b.width * .8, b.y + 14, 1500);
  },
  async mBill() { await go(BASE + "#/bill/hr1013", 3000); const y = await page.locator(".chip.yn").first().boundingBox(); if (y) await moveTo(y.x + y.width / 2, y.y + y.height / 2, 1200); await sleep(1500); await smoothScroll(500, 2500); },
  // ---- walkthrough (segments-walkthrough.json) ----
  async kLand() {
    await go(BASE + "#/explore", 1200);
    await page.evaluate(() => { localStorage.removeItem("owl-intro"); localStorage.removeItem("owl-match"); });
    await go(BASE + "#/explore", 2600);
    const cv = await page.locator("#main canvas").boundingBox();
    await moveTo(cv.x + cv.width * .5, cv.y + cv.height * .5, 1200);
    const c = await findNode(/^Energy and Commerce/); if (c) await moveTo(c.x, c.y, 1400);
    await sleep(700);
    await moveTo(cv.x + cv.width * .45, cv.y + cv.height * .4, 1200);
  },
  async kSearch() { await clickSel("#gs"); await sleep(300); await page.keyboard.type("91204", { delay: 220 }); await sleep(1800); },
  async kFriedman() {
    await page.keyboard.press("Enter"); await sleep(2600);
    const card = page.locator("#side .person-card").first();
    if (await card.count()) { await card.scrollIntoViewIfNeeded(); const b = await card.boundingBox(); if (b) await moveTo(b.x + 90, b.y + 40, 1400); await sleep(600); if (b) await moveTo(b.x + 120, b.y + 140, 1500); }
  },
  async kProfile() {
    await clickSel("#side button[data-open]").catch(async () => { await go(BASE + "#/legislator/F000483", 2500); });
    await sleep(2400);
    const c = page.locator("#profile a.cite"); if (await c.count()) { await clickSel("#profile a.cite", 0); await sleep(1500); const q = await page.locator("#side blockquote").first().boundingBox(); if (q) await moveTo(q.x + 60, q.y + q.height / 2, 900); }
  },
  async kEvidence() {
    await clickSel(".attn-row", 0); await sleep(1300);
    const f = await page.locator("#side .flipline").first().boundingBox(); if (f) await moveTo(f.x + 80, f.y + 10, 1300);
  },
  async kBill() {
    const lk = page.locator('#side a.link[href^="#/bill/"]').first(); const lb = await lk.boundingBox().catch(() => null);
    if (lb) await clickAt(lb.x + Math.min(60, lb.width / 2), lb.y + lb.height / 2);
    await sleep(700); if (!(await page.evaluate(() => location.hash)).startsWith("#/bill/")) { const h = await lk.getAttribute("href"); await page.evaluate(x => { location.hash = x; }, h); }
    await sleep(2200);
    const y = await page.locator("#bill .chip.yn").first().boundingBox(); if (y) await moveTo(y.x - 120, y.y - 40, 1000);
    await smoothScroll(420, 1600);
  },
  async kTopic() {
    await clickSel("#m-explore"); await sleep(1400);
    const c = await findNode(/^Education and Workforce/); if (c) { await moveTo(c.x, c.y, 900); await clickAt(c.x, c.y); }
    await sleep(1500);
    const t = await findNode(/^Child Care/); if (t) { await moveTo(t.x, t.y, 900); await clickAt(t.x, t.y); }
    await sleep(900);
  },
  async kAnswer() {
    const r = await page.locator("#side .mq").first().boundingBox(); if (r) await moveTo(r.x + 120, r.y + 14, 800);
    for (let i = 0; i < 3; i++) { await clickSel('#side [data-mq][data-st="support"]', i).catch(() => {}); await sleep(1100); }
  },
  async kMatches() {
    await clickSel('[data-esdr="open"]').catch(() => {}); await sleep(2000);
    // point at the state filter (the narration mentions it) without changing it
    const b = await page.locator("#es-state").boundingBox().catch(() => null); if (b) await moveTo(b.x + b.width / 2, b.y + b.height / 2, 1000);
    await sleep(1200);
  },
  async kMember() {
    const h = page.locator("#e-summary .es-m .es-mh").first(); const hb = await h.boundingBox().catch(() => null);
    if (hb) await clickAt(hb.x + hb.width * .6, hb.y + hb.height / 2);
    await sleep(1200); const d = await page.locator("#e-summary .es-det").first().boundingBox().catch(() => null); if (d) await moveTo(d.x + 120, d.y + 30, 900);
  },
  async kEnd() { await clickSel("#m-explore"); await sleep(1500); await moveTo(W * .5, H * .45, 900); },
  async mSearch() { await go(BASE + "#/explore", 2500); await clickSel("#gs"); await page.keyboard.type("90012", { delay: 160 }); await sleep(2500); }
};

const t0 = Date.now();
const offset = (t0 - tStartVideo) / 1000;
// a segment's narration starts when the previous narration has ended; if the previous shot is
// still running, the narration waits for it, and its actual start is what the audio mix uses
let audioFree = 0;
for (const s of timeline) {
  const now = (Date.now() - t0) / 1000;
  if (now < audioFree) { await sleep((audioFree - now) * 1000); }
  s.start = (Date.now() - t0) / 1000;
  audioFree = s.start + s.dur;
  await caption("");
  await SHOTS[s.shot]().catch(e => console.warn(`${s.id} ${s.shot}: ${e.message}`));
  await caption(s.caption);
  console.log(`${s.id} ${s.shot} done at ${((Date.now() - t0) / 1000).toFixed(1)} s (slot ends ${(s.start + s.dur).toFixed(1)} s)`);
}
t = audioFree; const end = t0 + t * 1000; if (Date.now() < end) await sleep(end - Date.now());
await sleep(800);
const videoPath = await page.video().path();
await ctx.close(); await browser.close();
const silent = path.join(OUT, NAME + "-silent.webm"); fs.renameSync(videoPath, silent);
fs.writeFileSync(path.join(OUT, NAME + "-timeline.json"), JSON.stringify({ offset, total: t, timeline }, null, 2));
console.log("video", silent, "offset", offset.toFixed(2), "s");

if (FF && seg.segments.every(s => fs.existsSync(path.join(AUDIO, s.id + ".mp3")))) {
  // narration track: each segment placed at its slot start
  const inputs = seg.segments.flatMap(s => ["-i", path.join(AUDIO, s.id + ".mp3")]);
  const delays = timeline.map((s, i) => `[${i + 1}:a]adelay=${Math.round(s.start * 1000)}|${Math.round(s.start * 1000)}[a${i}]`).join(";");
  const mix = timeline.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${timeline.length}:normalize=0[aout]`;
  const mp4 = path.join(OUT, NAME + ".mp4");
  execFileSync("ffmpeg", ["-y", "-ss", offset.toFixed(2), "-i", silent, ...inputs, "-filter_complex", delays + ";" + mix,
    "-map", "0:v", "-map", "[aout]", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-t", t.toFixed(2), mp4], { stdio: "inherit" });
  console.log("final", mp4);
} else console.log("no ffmpeg or no per-segment audio: kept the silent capture only");
