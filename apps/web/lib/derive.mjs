// Shared edge-derivation for the OWL web app (explore-redesign, section 1).
//
// Scoring rules live in packages/contract/derived.md and are implemented here:
// kind-scaled effective scores aggregated by confidence-weighted mean, same
// direction thresholds, speech+final-passage flip rule, same salience sum,
// same first-index-wins heat percentile, same latest-statement headline fields.
//
// index.html carries inlined copies for the no-graph.json fallback (local dev)
// and the bill-page legislator scores. Any scoring change must be applied in
// all three places: here, deriveEdgesInline, and billLegs.
//
// ES module, no dependencies, Node and browser safe. Pure: inputs in, edges out.

export const CONF_W = { low: 0.4, mid: 0.7, high: 1, super_high: 1.2 };

const CONF_ORDER = ["low", "mid", "high", "super_high"];

export function dirOf(score) {
  return score > 0.15 ? "support" : score < -0.15 ? "oppose" : "neutral";
}

// Action-kind labels. Prefers the contract `kind` field; falls back to
// model/rationale inference for mock and legacy rows without it. Vote rows map
// to yea/nay/notvoting by direction so existing consumers keep working.
export function kindOf(st) {
  if (st.kind) {
    if (st.kind === "vote") return st.direction === "support" ? "yea" : st.direction === "oppose" ? "nay" : "notvoting";
    return st.kind;
  }
  return kindOfLegacy(st);
}
export function kindOfLegacy(st) {
  if (st.model === "owl-ingest-metadata") return st.score >= 1 ? "sponsored" : "cosponsored";
  if (st.model === "owl-ingest-rule") {
    if (String(st.rationale || "").startsWith("Signed")) return "views";
    if (st.score === 0) return "notvoting";
    return st.score > 0 ? "yea" : "nay";
  }
  return "speech";
}

// Display factor: a signature is weaker evidence than speech, and an amendment
// vote weaker than final passage. Applied to the row's score before
// confidence-weighted aggregation; stored scores are untouched.
export function kindFactor(st) {
  switch (kindOf(st)) {
    case "speech": return 1;
    case "sponsored": return 0.8;
    case "cosponsored": return 0.5;
    case "views": return 0.25;
    case "yea":
    case "nay": {
      const vq = st.vote_question;
      if (vq === "final_passage") return 1;
      if (vq === "amendment" || vq === "procedural") return 0.5;
      return 0.75;
    }
    default: return 1; // notvoting and unknowns: score-0 rows are unaffected by construction
  }
}
export const effOf = (st) => st.score * kindFactor(st);

// Amendment/procedural votes are activity, not stance: forty nays on the other
// party's amendments must not read as opposing the issue. They count toward n
// and salience but never toward the score. Votes without a known question stay
// scored (legacy behavior) since there is nothing to judge them by.
export const scoresStance = (st) =>
  st.kind !== "vote" || !st.vote_question || st.vote_question === "final_passage";

// Match board (#32): rank legislators by agreement with the user's bill answers.
// legsByBill: {billKey: [{id, score}]} with billLegs-style scores (null = no signal).
// answers: {billKey: "support"|"oppose"}. Only answered bills where the legislator
// has a score count; neutral scores count as answered but not agreed. Sorted by
// rate desc, then agreed desc, then answered desc. minAnswers floors the board.
export function matchRank(legsByBill, answers, { minAnswers = 3 } = {}) {
  const per = new Map();
  for (const [bill, stance] of Object.entries(answers || {})) {
    if (stance !== "support" && stance !== "oppose") continue;
    for (const leg of legsByBill[bill] || []) {
      if (leg.score === null || leg.score === undefined) continue;
      if (!per.has(leg.id)) per.set(leg.id, { id: leg.id, answered: 0, agreed: 0 });
      const r = per.get(leg.id);
      r.answered += 1;
      if (dirOf(leg.score) === stance) r.agreed += 1;
    }
  }
  return [...per.values()]
    .filter((r) => r.answered >= minAnswers)
    .map((r) => ({ ...r, rate: r.answered ? r.agreed / r.answered : 0 }))
    .sort((a, b) => b.rate - a.rate || b.agreed - a.agreed || b.answered - a.answered);
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
    const sw = st.filter(scoresStance);
    const w = sw.map((s) => CONF_W[s.llm_confidence] || 0.7);
    const eff = sw.map(effOf);
    const score = w.length ? eff.reduce((a, v, i) => a + v * w[i], 0) / w.reduce((a, b) => a + b, 0) : 0;
    const latest = st[st.length - 1];
    // Flips count speech and final-passage votes only: amendment/procedural
    // yea+nay pairs on one bill are not flips. Votes without a question keep
    // the legacy behavior (counted) since there is nothing to judge them by.
    const flipDirs = st
      .filter((s) => {
        const k = kindOf(s);
        if (k === "speech") return true;
        if (k === "yea" || k === "nay") return !s.vote_question || s.vote_question === "final_passage";
        return false;
      })
      .map((s) => s.direction);
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
      flip: new Set(flipDirs.filter((d) => d !== "neutral")).size > 1,
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
