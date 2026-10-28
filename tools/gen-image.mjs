#!/usr/bin/env node
// Generate an image with Muse Image (Meta Model API) and save it as PNG.
//   node tools/gen-image.mjs <out.png> "<prompt>" [size]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(resolve(ROOT, ".env"))) for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const [out, prompt, size = "1024x1024"] = process.argv.slice(2);
if (!out || !prompt) { console.error("usage: gen-image.mjs <out.png> <prompt> [size]"); process.exit(1); }
const r = await fetch("https://api.meta.ai/v1/images/generations", { method: "POST", headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: "muse-image-1.0", prompt, n: 1, size, response_format: "b64_json" }) });
const j = await r.json();
if (!r.ok || j.error) { console.error("ERR", r.status, JSON.stringify(j.error || j).slice(0, 400)); process.exit(1); }
const d = j.data[0];
if (d.b64_json) writeFileSync(out, Buffer.from(d.b64_json, "base64"));
else if (d.url) writeFileSync(out, Buffer.from(await (await fetch(d.url)).arrayBuffer()));
else { console.error("no image in response", Object.keys(d)); process.exit(1); }
console.log(`saved ${out}${d.revised_prompt ? " · revised: " + d.revised_prompt.slice(0, 120) : ""}`);
