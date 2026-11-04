// High-quality recorder for the website walkthrough (tools/demo/segments-walkthrough.json).
//
//   python tools/demo/tts.py tools/demo/segments-walkthrough.json   # narration + word timings
//   node tools/demo/walkthrough.mjs [--base <app url>]               # 1920x1080 / 30 fps mp4
//
// Differences from record.mjs: frames are captured with the DevTools screencast as near-lossless
// JPEGs (not Playwright's low-bitrate VP8), and every cursor move waits for the narration to
// reach the word it illustrates (word timings from tts.py), so the pointer follows the voice.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "https://az30667176-sudo.github.io/owl/");
const LOCAL = arg("--local", "http://127.0.0.1:8765/"); // serves the repo root (tools/demo/vision.html)
const REPO = "https://github.com/az30667176-sudo/owl";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const SEG = JSON.parse(fs.readFileSync(path.join(ROOT, arg("--segments", "tools/demo/segments-walkthrough.json")), "utf8"));
const NAME = SEG._meta.out;
const OUT = path.join(ROOT, "tools/demo/out"), AUDIO = path.join(OUT, "audio", NAME), FR = path.join(OUT, NAME + "-frames");
const W = 1920, H = 1080, FPS = 30, PAD = 0.2;
fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });

const probe = f => +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim();
const segs = SEG.segments.map(s => ({ ...s, dur: probe(path.join(AUDIO, s.id + ".mp3")) + PAD,
  words: JSON.parse(fs.readFileSync(path.join(AUDIO, s.id + ".words.json"), "utf8")) }));

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--hide-scrollbars", "--force-device-scale-factor=1"] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: "dark" }); // GitHub follows it, matching the app
await ctx.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    // pointer: amber arrow-sized dot with a soft halo, scales on press
    const c = document.createElement("div");
    c.id = "__cur"; c.style.cssText = "position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:2.5px solid #f0b429;background:rgba(240,180,41,.28);box-shadow:0 0 0 6px rgba(240,180,41,.12);pointer-events:none;left:-60px;top:-60px;transition:transform .12s";
    document.documentElement.appendChild(c);
    const p = sessionStorage.getItem("__xy"); if (p) { const [x, y] = p.split(","); c.style.left = x + "px"; c.style.top = y + "px"; }
    addEventListener("mousemove", e => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; sessionStorage.setItem("__xy", e.clientX + "," + e.clientY); }, true);
    addEventListener("mousedown", () => c.style.transform = "scale(.7)", true);
    addEventListener("mouseup", () => c.style.transform = "", true);
    const cap = document.createElement("div");
    cap.id = "__cap"; cap.style.cssText = "position:fixed;z-index:2147483646;left:50%;bottom:34px;transform:translateX(-50%);padding:12px 22px;background:rgba(15,19,34,.94);border:1px solid #4a5372;border-left:4px solid #f0b429;color:#efe6d2;font:600 21px 'Public Sans',Segoe UI,sans-serif;pointer-events:none;opacity:0;transition:opacity .35s;white-space:nowrap";
    document.documentElement.appendChild(cap);
    const t = sessionStorage.getItem("__cap"); if (t) { cap.textContent = t; cap.style.opacity = 1; }
  });
});
const page = await ctx.newPage();
page.setDefaultTimeout(5000);

// ---- screencast capture: every repaint as a JPEG with its wall-clock timestamp ----
const cdp = await ctx.newCDPSession(page);
const frames = []; let fn = 0;
cdp.on("Page.screencastFrame", async f => {
  const file = path.join(FR, String(fn++).padStart(6, "0") + ".jpg");
  fs.writeFileSync(file, Buffer.from(f.data, "base64"));
  frames.push({ file, ts: f.metadata.timestamp });
  cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const caption = async text => { await page.evaluate(t => { sessionStorage.setItem("__cap", t); const c = document.getElementById("__cap"); if (c) { c.textContent = t; c.style.opacity = t ? 1 : 0; } }, text || "").catch(() => {}); };
const moveTo = async (x, y, ms = 700) => { await page.mouse.move(x, y, { steps: Math.max(10, Math.round(ms / 16)) }); };
const clickAt = async (x, y, ms) => { await moveTo(x, y, ms); await sleep(140); await page.mouse.down(); await sleep(80); await page.mouse.up(); };
const box = async (sel, nth = 0) => { const el = page.locator(sel).nth(nth); await el.scrollIntoViewIfNeeded().catch(() => {}); return el.boundingBox().catch(() => null); };
const pointAt = async (sel, nth = 0, ms = 700, fx = .5, fy = .5) => { const b = await box(sel, nth); if (b) await moveTo(b.x + b.width * fx, b.y + b.height * fy, ms); return b; };
const clickSel = async (sel, nth = 0, ms = 700) => { const b = await box(sel, nth); if (b) await clickAt(b.x + b.width / 2, b.y + b.height / 2, ms); return b; };
const go = async (url, wait = 1500) => { if (page.url() !== "about:blank") await page.goto("about:blank"); await page.goto(url, { waitUntil: "domcontentloaded" }); await sleep(wait); };
// smooth-scroll the page until an element's top sits about a fifth down the viewport
const scrollTo = async (sel, ms = 1400) => {
  const el = page.locator(sel).first(); const b = await el.boundingBox().catch(() => null); if (!b) { console.warn("no " + sel); return; }
  const dy = b.y - H * .2, n = Math.max(8, Math.round(ms / 30)); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy / n); await sleep(30); }
  await sleep(250);
};
const hideCursor = () => page.evaluate(() => { const c = document.getElementById("__cur"); if (c) c.style.display = "none"; }).catch(() => {});
const showCursor = () => page.evaluate(() => { const c = document.getElementById("__cur"); if (c) c.style.display = ""; }).catch(() => {});
const findNode = async (src, people = false) => page.evaluate(([src, people]) => {
  const rx = new RegExp(src), cv = document.querySelector("#main canvas"); if (!cv) return null;
  const R = cv.getBoundingClientRect(), cx = R.left + R.width / 2, cy = R.top + R.height / 2, rr = Math.min(R.width, R.height) / 2;
  const st = people ? 9 : 8;
  for (let y = R.top + 8; y < R.bottom - 8; y += st) for (let x = R.left + 8; x < R.right - 8; x += st) {
    const d = Math.hypot(x - cx, y - cy); if (!people && (d < rr * .45 || d > rr * 1.05)) continue;
    cv.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }));
    const t = document.querySelector(".cond-tip");
    if (t && getComputedStyle(t).display !== "none" && rx.test(t.innerText) && (people || !/Rep\.|Sen\./.test(t.innerText))) return { x, y };
  }
  return null;
}, [src.source, people]);

// ---- cues: wait until the narration of the current segment reaches a word ----
let CUR = null, T0 = 0;
const norm = w => w.toLowerCase().replace(/[^a-z0-9]/g, "");
const cue = async (word, nth = 1, lead = .25) => {
  const target = norm(word); let k = 0;
  const hit = CUR.words.find(x => norm(x.w).startsWith(target) && ++k === nth); // "summary's" matches "summary"
  if (!hit) { console.warn(`cue "${word}" not in ${CUR.id}`); return; }
  const due = T0 + (CUR.start + hit.t - lead) * 1000;
  if (Date.now() < due) await sleep(due - Date.now());
};

const SHOTS = {
  async kLand() {
    const cv = await box("#main canvas"); const cx = cv.x + cv.width / 2, cy = cv.y + cv.height / 2;
    await moveTo(cv.x + cv.width * .3, cv.y + cv.height * .25, 600);
    await cue("middle"); await moveTo(cx, cy, 900);
    const com = PRE.energy, mem = PRE.member;
    await cue("coloured"); if (com) await moveTo(com.x, com.y, 900);
    await cue("small"); if (mem) await moveTo(mem.x, mem.y, 900);
  },
  async kSearch() {
    await cue("search"); await pointAt("#gs", 0, 900, .3);
    await cue("click"); await clickSel("#gs", 0, 300);
    await cue("heres"); await page.keyboard.type("91204", { delay: 150 });
  },
  async kFriedman() {
    await pointAt("#dd", 0, 500, .3, .6); await sleep(250); await page.keyboard.press("Enter");
    await cue("lines"); const cv = await box("#main canvas"); if (cv) { await moveTo(cv.x + cv.width * .42, cv.y + cv.height * .35, 900); await moveTo(cv.x + cv.width * .52, cv.y + cv.height * .6, 1200); }
    await cue("positions"); const card = await box("#side .person-card");
    if (card) { await moveTo(card.x + 60, card.y + 60, 900); await moveTo(card.x + 60, card.y + Math.min(card.height - 40, 220), 1400); }
  },
  async kProfile() {
    await cue("open"); await pointAt("#side button[data-open]", 0, 700);
    await cue("full"); await clickSel("#side button[data-open]", 0, 200);
    await page.waitForFunction(() => location.hash.startsWith("#/legislator/")).catch(() => {}); await sleep(900);
    await cue("summary"); await pointAt("#profile .ai, #profile [class*=summ]", 0, 900, .3, .4).then(b => b || moveTo(W * .42, H * .42, 900));
    await cue("number"); const b = await box("#profile a.cite", 0); if (b) { await clickAt(b.x + b.width / 2, b.y + b.height / 2, 800); }
    await cue("quote"); await pointAt("#side blockquote", 0, 900, .25);
  },
  async kEvidence() {
    await pointAt(".attn-row", 0, 800, .3); await cue("topic"); await clickSel(".attn-row", 0, 200);
    await cue("evidence"); await pointAt("#side .tags", 0, 900, .3);
    await cue("changed"); await pointAt("#side .flipline", 0, 900, .3);
  },
  async kBill() {
    const lk = page.locator('#side a.link[href^="#/bill/"]').first(); await lk.scrollIntoViewIfNeeded().catch(() => {});
    const lb = await lk.boundingBox().catch(() => null); if (lb) await moveTo(lb.x + Math.min(70, lb.width / 2), lb.y + lb.height / 2, 800);
    await cue("bill"); if (lb) await clickAt(lb.x + Math.min(70, lb.width / 2), lb.y + lb.height / 2, 200);
    await sleep(600); if (!(await page.evaluate(() => location.hash)).startsWith("#/bill/")) { const h = await lk.getAttribute("href").catch(() => null); if (h) await page.evaluate(x => { location.hash = x; }, h); }
    await cue("plain"); await pointAt("#bill .bill-sub", 1, 900, .2);
    await cue("supports"); await pointAt("#bill .bill-strip", 0, 900, .15);
  },
  async kTopic() {
    await cue("explore"); await clickSel("#m-explore", 0, 800); await sleep(700);
    const ew = PRE.edu; // the home layout is the same as at the start
    await cue("education"); if (ew) await clickAt(ew.x, ew.y, 900);
    await sleep(500); const cc = await findNode(/^Child Care/); if (cc) await moveTo(cc.x, cc.y, 1100);
    await cue("child"); if (cc) await clickAt(cc.x, cc.y, 200);
  },
  async kAnswer() {
    await cue("question"); await pointAt("#side .mq .qq", 0, 900, .3);
    await cue("answer"); await clickSel('#side [data-mq][data-st="support"]', 0, 700);
    await cue("care"); await clickSel('#side [data-mq][data-st="support"]', 1, 700);
    await cue("enough"); await clickSel('#side [data-mq][data-st="support"]', 2, 700);
  },
  async kMatches() {
    await cue("ring"); await pointAt('[data-esdr="open"]', 0, 900);
    await cue("show"); await clickSel('[data-esdr="open"]', 0, 300);
    await cue("records"); await pointAt("#e-summary .es-m", 0, 900, .3);
    await cue("state"); await pointAt("#es-state", 0, 900);
  },
  async kMember() {
    await cue("click"); await clickSel("#e-summary .es-m .es-mh", 0, 800);
    await cue("agree"); await pointAt("#e-summary .es-g.ok", 0, 900, .3, .3);
    await cue("differ"); await pointAt("#e-summary .es-g.no", 0, 900, .3, .3).then(b => b || pointAt("#e-summary .es-g.na", 0, 900, .3, .3));
  },
  async kEnd() { await clickSel("#m-explore", 0, 700); await sleep(500); await moveTo(W * .45, H * .45, 900); },
  // ---- closing segment (segments-tech.json): GitHub repo, pipeline, vision scenes ----
  async tRepo() {
    await cue("github"); await pointAt('[itemprop="name"]', 0, 900);
    await cue("architecture"); await go(LOCAL + "tools/demo/vision.html#rec", 500); await page.evaluate(() => scene(1)); await sleep(400); await page.evaluate(() => step(1));
    await sleep(900); await pointAt("#c1", 0, 800, .5, .3);
  },
  async tArch() {
    await cue("official"); await pointAt("#c1 .n", 0, 700, .5);
    await cue("zero"); await pointAt("#c2", 0, 700, .5, .15);
    await cue("spark"); await page.evaluate(() => step(2)); await pointAt("#c4", 0, 800, .5, .15);
  },
  async tReal() {
    await page.evaluate(() => scene(9)); await hideCursor();
    await cue("stance"); await page.evaluate(() => step(1));
    await cue("scores"); await page.evaluate(() => step(2));
    await cue("validator"); await page.evaluate(() => step(3));
  },
  async tCaps() {
    await page.evaluate(() => scene(7)); await hideCursor();
    await cue("twenty"); await page.evaluate(() => step(1));
    await cue("turns"); await page.evaluate(() => step(2));
    await cue("conditions"); await page.evaluate(() => step(3));
    await cue("audits"); await page.evaluate(() => step(4));
  },
  async tGates() {
    await page.evaluate(() => scene(1)); await page.evaluate(() => { step(1); step(5); }); await showCursor();
    await cue("person"); await page.evaluate(() => step(3)); await pointAt("#rev", 0, 800, .5);
    await cue("gate"); await page.evaluate(() => step(6)); await pointAt("#c5 .n", 0, 800, .5);
    await cue("code"); await page.evaluate(() => step(4)); await pointAt("#mcode", 0, 800, .4);
  },
  async tPlug() {
    await page.evaluate(() => scene(8)); await hideCursor();
    await cue("hearings"); await page.evaluate(() => step(1));
    await cue("decades"); await page.evaluate(() => { const d = document.querySelector("#srcs"); if (d && !d.querySelector(".old")) { const e = document.createElement("div"); e.className = "src new old on"; e.innerHTML = "decades of past Congresses<small>next</small>"; d.appendChild(e); } });
    await cue("adapter"); await page.evaluate(() => step(2));
  },
  async tLive() {
    await cue("positions"); await page.evaluate(() => step(3));
    await cue("multilingual"); await page.evaluate(() => scene(5)); await sleep(350); await page.evaluate(() => step(1));
  },
  async tReach() {
    await page.evaluate(() => scene(2)); await page.evaluate(() => step(1));
    await cue("decades"); await page.evaluate(() => step(2));
    await cue("language"); await page.evaluate(() => scene(5)); await sleep(350); await page.evaluate(() => step(1));
  },
  async tEnd() { await page.evaluate(() => scene(6)); }
};

// ---- run ----
await go(BASE + "#/explore", 1200);
await page.evaluate(() => { localStorage.removeItem("owl-intro"); localStorage.removeItem("owl-match"); });
await go(BASE + "#/explore", 3500); // loaded, data warm, before the first word
// node positions on the home layout, found before the narration starts so no shot waits on a scan
const PRE = SEG._meta.startUrl ? {} : { energy: await findNode(/^Energy and Commerce/), edu: await findNode(/^Education and Workforce/), member: await findNode(/^Rep\./, true) };
if (SEG._meta.startUrl) { await go(LOCAL + "tools/demo/vision.html", 1500); await go(SEG._meta.startUrl, 3500); } // warm the vision page fonts, then open the segment's first page
await page.mouse.move(W * .3, H * .3); await sleep(400);
T0 = Date.now();
let audioFree = 0;
for (const s of segs) {
  const now = (Date.now() - T0) / 1000;
  if (now < audioFree) await sleep((audioFree - now) * 1000);
  s.start = (Date.now() - T0) / 1000; audioFree = s.start + s.dur; CUR = s;
  // no on-screen captions (they drifted from the voice); the narration carries the explanation
  await SHOTS[s.shot]().catch(e => console.warn(`${s.id}: ${e.message}`));
  const over = (Date.now() - T0) / 1000 - audioFree; if (over > .3) console.warn(`${s.id} ran ${over.toFixed(1)} s past its narration`);
}
const total = audioFree + .6; { const end = T0 + total * 1000; if (Date.now() < end) await sleep(end - Date.now()); }
await cdp.send("Page.stopScreencast").catch(() => {}); await sleep(300);
await browser.close();

// ---- encode: hold each captured frame until the next one, resample to constant 30 fps ----
const t0s = T0 / 1000, keep = frames.filter(f => f.ts >= t0s - 1 && f.ts <= t0s + total).sort((a, b) => a.ts - b.ts);
const first = keep.findIndex(f => f.ts >= t0s); const startIdx = Math.max(0, first - 1);
const list = []; for (let i = startIdx; i < keep.length; i++) {
  const a = Math.max(keep[i].ts, t0s), b = i + 1 < keep.length ? keep[i + 1].ts : t0s + total;
  if (b <= a) continue; list.push(`file '${keep[i].file.replace(/\\/g, "/")}'`, `duration ${(b - a).toFixed(4)}`);
}
list.push(`file '${keep[keep.length - 1].file.replace(/\\/g, "/")}'`);
const LIST = path.join(OUT, NAME + "-frames.txt"); fs.writeFileSync(LIST, list.join("\n"));
const inputs = segs.flatMap(s => ["-i", path.join(AUDIO, s.id + ".mp3")]);
const delays = segs.map((s, i) => `[${i + 1}:a]adelay=${Math.round(s.start * 1000)}|${Math.round(s.start * 1000)}[a${i}]`).join(";");
const mix = segs.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${segs.length}:normalize=0,aresample=48000[aout]`;
const MP4 = path.join(OUT, NAME + "-hq.mp4");
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", LIST, ...inputs, "-filter_complex", `[0:v]fps=${FPS},format=yuv420p[v];` + delays + ";" + mix,
  "-map", "[v]", "-map", "[aout]", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-tune", "stillimage", "-c:a", "aac", "-b:a", "192k", "-t", total.toFixed(2), "-movflags", "+faststart", MP4], { stdio: "inherit" });
fs.writeFileSync(path.join(OUT, NAME + "-hq-timeline.json"), JSON.stringify(segs.map(s => ({ id: s.id, start: +s.start.toFixed(2), dur: +s.dur.toFixed(2) })), null, 1));
console.log(`final ${MP4} · ${total.toFixed(1)} s · ${keep.length} captured frames`);
