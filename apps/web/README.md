# Web

## Prototype

`prototype/` is a zero-build static mock of the dashboard (category -> sub-category -> legislators -> evidence), rendering `mock-data.js` shaped like `packages/contract/vis.schema.json` plus a taxonomy layer.

Run: `python -m http.server 8090 --directory apps/web/prototype` then open http://localhost:8090

Legislator names in the mock are fictional. The production app (Next.js) will replace this once contract C is frozen.
