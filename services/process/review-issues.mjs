// Deterministic new-issue review for extract-batch.mjs --merge-new-issues.
// (The human-review alternative is staging proposals in _new-issues.json.)
//
// Greedy star-topology matching: each proposal joins the first same-parent
// canonical it directly resembles, else it becomes a new canonical. Resemblance
// is subset ("X" vs "X and Y") or token Jaccard (stopwords dropped) >= 0.5 —
// except into curated existing issues, where only subset counts (Jaccard on
// generic tokens like "student"/"education" must not pollute a seed issue).
// Star topology (compare against the canonical only, never transitively
// through other proposals) prevents chains like A~B~C from collapsing A into C.
// Returns { create: [{id,name,parent}], remap: Map(oldId->canonicalId), audit: [str] }.

const STOPWORDS = new Set(["and", "or", "of", "the", "a", "an", "for", "to", "in", "on"]);
const toks = (s, stop = false) =>
  String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && (!stop || !STOPWORDS.has(t)));

function isSubset(aName, bName) {
  const A = new Set(toks(aName)), B = new Set(toks(bName));
  return A.size > 0 && B.size > 0 && ([...A].every((t) => B.has(t)) || [...B].every((t) => A.has(t)));
}
function resembles(aName, bName) {
  if (isSubset(aName, bName)) return true;
  const As = new Set(toks(aName, true)), Bs = new Set(toks(bName, true));
  const inter = [...As].filter((t) => Bs.has(t)).length;
  return inter / new Set([...As, ...Bs]).size >= 0.5;
}

export function reviewNewIssues(existing, proposals) {
  const audit = [];
  // Dedupe proposals by id (first wins; conflicts logged).
  const uniq = new Map();
  for (const p of proposals) {
    if (!uniq.has(p.id)) uniq.set(p.id, p);
    else if (uniq.get(p.id).name !== p.name || uniq.get(p.id).parent !== p.parent) {
      audit.push(`conflict on ${p.id}: keeping "${uniq.get(p.id).name}" (${uniq.get(p.id).parent}), ignoring "${p.name}" (${p.parent})`);
    }
  }
  // Canonicals: existing issues first, then proposals shortest-id-first.
  const canonicals = existing.map((e) => ({ ...e, existing: true }));
  const ordered = [...uniq.values()].sort((a, b) => a.id.length - b.id.length || (a.id < b.id ? -1 : 1));
  const create = [], remap = new Map();
  for (const p of ordered) {
    // Higher bar into curated seeds (subset only): Jaccard overlap on generic
    // tokens ("student", "education") must not pollute an existing issue.
    const hit = canonicals.find((c) => {
      if (c.parent !== p.parent) return false;
      return c.existing ? isSubset(c.name, p.name) : resembles(c.name, p.name);
    });
    if (hit) {
      remap.set(p.id, hit.id);
      audit.push(`merged "${p.name}" -> "${hit.name}"${hit.existing ? " (existing)" : ""}`);
    } else {
      canonicals.push({ ...p, existing: false });
      create.push({ id: p.id, name: p.name, parent: p.parent });
    }
  }
  return { create, remap, audit };
}
