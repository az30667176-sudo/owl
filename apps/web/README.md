# Web

## Prototype

`index.html` is the zero-build app (category -> sub-category -> legislators -> evidence), rendering `mock-data.js` shaped like `packages/contract/vis.schema.json` plus a taxonomy layer.

Run: `python -m http.server 8090 (from the repo root) then open http://localhost:8090/apps/web/` then open http://localhost:8090

Legislator names in the mock are fictional. The production app (Next.js) will replace this once contract C is frozen.
