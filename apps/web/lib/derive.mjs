// Shared edge-derivation for the OWL web app (explore-redesign, section 1).
//
// Scoring rules live in packages/contract/derived.md and are reproduced here
// exactly as apps/web/index.html computes them today: same CONF_W weights, same
// weighted-mean score formula, same direction thresholds, same flip rule, same
// salience sum, same first-index-wins heat percentile, same latest-statement
// headline fields. Copy that logic; do not reinterpret it.
//
// index.html carries an inlined copy of deriveEdges for the no-graph.json
// fallback (local dev). Any scoring change must be applied in both places.
//
// ES module, no dependencies, Node and browser safe. Pure: inputs in, edges out.

export const CONF_W = { low: 0.4, mid: 0.7, high: 1, super_high: 1.2 };

const CONF_ORDER = ["low", "mid", "high", "super_high"];

export function dirOf(score) {
  return score > 0.15 ? "support" : score < -0.15 ? "oppose" : "neutral";
}

// Action-kind inference. Labels only: scores, directions, heat and flips are
// untouched. Isolated in one function so it can be deleted when the contract
// gains a kind field.
export function kindOf(st) {
  if (st.model === "owl-ingest-metadata") return st.score >= 1 ? "sponsored" : "cosponsored";
  if (st.model === "owl-ingest-rule") {
    if (String(st.rationale || "").startsWith("Signed")) return "views";
    if (st.score === 0) return "notvoting";
    return st.score > 0 ? "yea" : "nay";
  }
  return "speech";
}

function heatOfAt(now, s) {
  const days = s.date ? (now - new Date(s.date)) / 864e5 : 365;
  return Math.pow(2, -Math.max(0, days) / 180);
}

// statements: rows already filtered to known people/issues. now: the "today"
// the salience decay is relative to (mock data: newest statement date, else
// the current time — the caller decides, mirroring index.html's NOW rule).
// Returns one edge per (person, issue) pair. kind is
// [sponsored, cosponsored, yea, nay, views, spokeN, spokeMeanScore] where the
// spoke slots count speech-kind statements only; "notvoting" rows keep their
// score/n weight but take no kind slot (no halo ring reads them).
export function deriveEdges(statements, { now } = {}) {
  const t = now instanceof Date ? now : new Date(now ?? Date.now());
  const groups = new Map();
  for (const s of statements) {
    const k = s.person + "|" + s.issue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const edges = [...groups.values()].map((list) => {
    const st = [...list].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    const w = st.map((s) => CONF_W[s.llm_confidence] || 0.7);
    const score = st.reduce((a, s, i) => a + s.score * w[i], 0) / w.reduce((a, b) => a + b, 0);
    const latest = st[st.length - 1];
    const dirs = st.map((s) => s.direction);
    const counts = { sponsored: 0, cosponsored: 0, yea: 0, nay: 0, views: 0 };
    let spokeN = 0;
    let spokeSum = 0;
    for (const s of st) {
      const k = kindOf(s);
      if (k === "speech") {
        spokeN += 1;
        spokeSum += s.score;
      } else if (k in counts) {
        counts[k] += 1;
      }
    }
    return {
      from: latest.person,
      to: latest.issue,
      score,
      direction: dirOf(score),
      n: st.length,
      statements: st,
      salience: st.reduce((a, s) => a + heatOfAt(t, s), 0),
      linkage: CONF_ORDER[Math.max(...st.map((s) => CONF_ORDER.indexOf(s.linkage)))],
      llm_confidence: CONF_ORDER[Math.max(...st.map((s) => CONF_ORDER.indexOf(s.llm_confidence)))],
      flip: new Set(dirs.filter((d) => d !== "neutral")).size > 1,
      first: st[0].date,
      last: latest.date,
      quote: latest.quote,
      bill: latest.bill,
      source: latest.source,
      model: latest.model,
      kind: [
        counts.sponsored,
        counts.cosponsored,
        counts.yea,
        counts.nay,
        counts.views,
        spokeN,
        spokeN ? spokeSum / spokeN : 0,
      ],
    };
  });
  // Global salience percentile 0..1; first-index-wins on ties, exactly as today.
  const sorted = edges.map((e) => e.salience).sort((a, b) => a - b);
  edges.forEach((e) => {
    e.heat = sorted.length > 1 ? sorted.indexOf(e.salience) / (sorted.length - 1) : 1;
  });
  return edges;
}
