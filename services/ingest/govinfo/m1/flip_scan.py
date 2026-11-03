#!/usr/bin/env python3
"""Flip candidates from the no-model evidence (person_bill.jsonl) joined to seed issues.

A "flip" in contract C = the same person, same issue, with both a support and an oppose
statement on different dates. Here each evidence row gets a direction *toward the bill*:
  sponsored / cosponsored                 -> for
  committee_vote yea on final passage     -> for
  committee_vote nay on final passage     -> against
  signed minority / dissenting views      -> against
Amendment votes, additional/supplemental views and votes whose question text is truncated
are skipped (direction toward the bill unknown).

Caveat printed in the report: "for bill A, against bill B" on one issue is only a flip if
the two bills point the same way. That bill-direction step is the Muse call in option (b);
until then these are candidates, not findings.

Usage: python3 -I m1/flip_scan.py [--out out_full]
"""
import json, re, sys, collections
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else ROOT / "out_full"

AMEND = re.compile(r"amendment|offered by|\bLog\b|^No\. \d|en bloc|substitute|motion to table|appeal", re.I)
PASS = re.compile(r"final passage|favorabl|motion to report|ordered (to be )?reported|report the bill|be reported", re.I)


def direction(r):
    a = r["action"]
    if a in ("sponsored", "cosponsored"):
        return "for", a
    if a == "signed_views":  # stance already accounts for adverse reports (minority views on an adverse report = for)
        return (r["stance"], "signed_" + str(r["views_type"])) if r["stance"] in ("for", "against") else (None, None)
    if a == "committee_vote":
        q = r.get("vote_question") or ""
        if AMEND.search(q) or not PASS.search(q):
            return None, None
        if r["vote"] == "yea": return "for", "vote_yea_passage"
        if r["vote"] == "nay": return "against", "vote_nay_passage"
    return None, None


def main():
    people = {p["id"]: p for p in json.load(open(OUT / "owl" / "people.json"))["people"]}
    bills = {b["bill_id"]: b for b in map(json.loads, open(OUT / "bills.jsonl"))}
    bill_issues = {r["bill_id"]: r["issues"] for r in map(json.loads, open(OUT / "owl" / "bill_issues.jsonl"))}
    issues = {i["id"]: i for i in json.load(open(OUT / "owl" / "issues.json"))["issues"]}

    used, skipped = collections.Counter(), collections.Counter()
    edges = collections.defaultdict(list)  # (person, issue) -> [(date, dir, bill, how)]
    per_bill = collections.defaultdict(set)  # (person, bill) -> {dirs}
    for r in map(json.loads, open(OUT / "person_bill.jsonl")):
        d, how = direction(r)
        if not d:
            skipped[r["action"]] += 1; continue
        used[how] += 1
        per_bill[(r["person_id"], r["bill_id"])].add((d, how, r["event_date"]))
        for iid in bill_issues.get(r["bill_id"], []):
            edges[(r["person_id"], iid)].append((r["event_date"] or "", d, r["bill_id"], how))

    cross, within = [], []
    for (pid, iid), ev in edges.items():
        dirs = {e[1] for e in ev}
        if len(dirs) < 2: continue
        bills_for = sorted({e[2] for e in ev if e[1] == "for"}); bills_against = sorted({e[2] for e in ev if e[1] == "against"})
        if bills_for and bills_against and set(bills_for) != set(bills_against):
            cross.append((pid, iid, sorted(ev)))
    for (pid, bid), s in per_bill.items():
        if len({d for d, _, _ in s}) > 1:
            within.append((pid, bid, sorted(s, key=lambda x: x[2] or "")))

    is_ca = lambda pid: pid in people and people[pid]["state"] == "CA"
    name = lambda pid: people[pid]["name"] + f" ({people[pid]['party']}-{people[pid]['district']})" if pid in people else pid + " (departed)"

    L = ["# Flip scan (no model) — candidates only", "",
         f"Evidence rows used: {dict(used)}", f"Skipped (direction toward bill unknown): {dict(skipped)}", "",
         f"Cross-bill candidates (same person, same seed issue, for on one bill and against on another): **{len(cross)}**, of which CA members: **{sum(1 for c in cross if is_ca(c[0]))}**",
         f"Within-bill contradictions (same person, same bill, e.g. cosponsored then voted nay): **{len(within)}**, CA: **{sum(1 for w in within if is_ca(w[0]))}**", "",
         "> A cross-bill candidate is a real flip only if both bills point the same way on the issue. Bill direction is the Muse step in option (b). Within-bill contradictions need no model and are the strongest candidates.", "",
         "## Within-bill contradictions", ""]
    for pid, bid, s in sorted(within, key=lambda w: (not is_ca(w[0]), w[0])):
        L.append(f"- {'**CA** ' if is_ca(pid) else ''}{name(pid)} on {bills[bid]['label']} ({', '.join(bill_issues.get(bid, []))}): " + "; ".join(f"{how} {dt or 'n.d.'}" for d, how, dt in s) + f" — {bills[bid]['title'][:90]}")
    L += ["", "## Cross-bill candidates, CA members", ""]
    for pid, iid, ev in sorted(cross, key=lambda c: c[0]):
        if not is_ca(pid): continue
        L.append(f"- {name(pid)} on **{issues[iid]['name']}**: " + "; ".join(f"{d} {bills[b]['label']} ({how}, {dt or 'n.d.'})" for dt, d, b, how in ev))
    L += ["", f"## Cross-bill candidates, all members (count by issue)", ""]
    for iid, n in collections.Counter(c[1] for c in cross).most_common(): L.append(f"- {issues[iid]['name']}: {n}")
    (OUT / "owl" / "flip_report.md").write_text("\n".join(L))
    print("\n".join(L[:8]))
    print(f"-> {OUT/'owl'/'flip_report.md'}")


if __name__ == "__main__":
    main()
