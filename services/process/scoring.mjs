// Shared scoring rubric for the process extractors (#27). Pure module: no API calls,
// no file reads, safe to import from tests and CLIs alike.
//
// The model commits to a verbal intensity band plus a continuous position inside
// it; the number is then derived deterministically. Verbal bands calibrate far
// better than raw numbers (the old prompt's bare "score in [-1, 1]" collapsed
// 90% of rows onto |score| >= 0.8), while the position keeps output continuous
// so rows do not pile onto a handful of discrete values.

// Band -> [lo, hi] on |score|. Contiguous: neutral ends where lean starts, etc.
export const INTENSITY_BANDS = {
  neutral: [0, 0.15], // purely descriptive, balanced, or procedural
  lean: [0.15, 0.4], // a lean or a concern about one provision, short of a position
  qualified: [0.4, 0.65], // partial support or notable reservations
  clear: [0.65, 0.85], // clear support/opposition, no reservations
  strong: [0.85, 1.0], // unqualified commitment
};

// Derive |score| from band + position (0 = weakest edge, 1 = strongest edge),
// signed by direction. Missing/unparsable positions land mid-band; unknown
// bands return null (the caller rejects the statement).
export function bandScore(intensity, position, direction) {
  const band = INTENSITY_BANDS[String(intensity || "").toLowerCase()];
  if (!band) return null;
  let p = Number(position);
  if (!Number.isFinite(p)) p = 0.5;
  p = Math.min(1, Math.max(0, p));
  const dir = direction > 0 ? 1 : direction < 0 ? -1 : 0;
  if (dir === 0) return 0;
  return dir * (band[0] + p * (band[1] - band[0]));
}

// Normalise the model's direction label to a sign. Garbage -> 0 (neutral).
export function dirSign(d) {
  const t = String(d || "").toLowerCase();
  if (/support/.test(t)) return 1;
  if (/oppos/.test(t)) return -1;
  return 0;
}

// Resolve a model statement to a score in [-1, 1], or null to reject it.
// Preferred: intensity band + position. Legacy: raw numeric score (kept so old
// prompts and hand-written fixtures still validate).
export function resolveScore(st) {
  if (st.intensity != null) return bandScore(st.intensity, st.position, dirSign(st.direction));
  const score = Number(st.score);
  return score >= -1 && score <= 1 ? score : null;
}

// Prompt fragment shared by extract.mjs and extract-batch.mjs. Rationale comes
// first so the model reasons about intensity before committing to a band.
export const SCORE_RUBRIC = `Calibrated scoring. Most legislative speech is qualified: use the middle bands often, not just the extremes.
Score the stance TOWARD THE ISSUE, not toward any bill: a speaker who attacks a bill for harming the issue SUPPORTS the issue, and bare opposition to a bill ("I oppose this legislation") with no stated position on the issue itself is neutral, not opposition.
For each statement FIRST write the rationale (one neutral sentence on what the speaker commits to and any reservation or condition), THEN commit to an intensity band, THEN a position 0..1 inside the band (0 = weakest edge, 1 = strongest edge). The score is derived from band + position; never write the number directly.
- strong: unqualified commitment. e.g. "This bill must become law." / "I will fight this bill with everything I have."
- clear: clear support or opposition, no reservations. e.g. "This is the right approach and I urge its adoption."
- qualified: partial support, or support with notable reservations. e.g. "I support the goal but have serious concerns about the funding mechanism."
- lean: a lean, or a concern about one provision, stopping short of a position. e.g. "I am sympathetic but need to see the final text before deciding."
- neutral: purely descriptive, balanced, or procedural. e.g. "The amendment strikes section 4."
If the speaker states a condition ("support, if X"), cap the band at qualified: the condition belongs in the conditions ledger, and a conditioned stance is never stronger than partial.
Emit "rationale" first, then "direction" (support/oppose/neutral), "intensity" (one band), "position" (0..1), then the remaining fields.`;
