"""Run module 1 on a set of reports.

  python3 -I run_pilot.py                     # auto-pick ~20 reports across CA-heavy committees
  python3 -I run_pilot.py CRPT-119hrpt852 ... # explicit ids
  python3 -I run_pilot.py --all               # every non-Rules 119th House report
"""
import pathlib
import sys
from collections import defaultdict

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from m1 import build, fetch, roster  # noqa: E402

# committees ordered by CA seats (ca-house-committees.md)
PRIORITY = ['HSPW', 'HSFA', 'HSSY', 'HSAS', 'HSJU', 'HSAP', 'HSIF', 'HSII', 'HSBA', 'HSBU', 'HSWM', 'HSAG', 'HSGO',
            'HSED', 'HSSM', 'HSHM', 'HSVR']
MUST = ['CRPT-119hrpt852', 'CRPT-119hrpt4']


def all_mods():
    out = {}
    for f in (build.CACHE / 'mods').glob('CRPT-119hrpt*.xml'):
        try:
            out[f.stem] = build.mods_info(f.stem)
        except Exception as e:  # a truncated download; refetch next time
            print('bad mods', f.stem, e, file=sys.stderr)
            f.unlink()
    return out


def select_pilot(n=20):
    mods = all_mods()
    by_comm = defaultdict(list)
    for pkg, m in mods.items():
        code = roster.authority_to_code(m['committees'][0]['authority_id']) if m['committees'] and m['committees'][0]['authority_id'] else None
        if code and code != 'HSRU':
            by_comm[code].append(pkg)
    for code in by_comm:
        by_comm[code].sort(key=fetch.natural_key, reverse=True)
    picked, skipped = list(MUST), []
    while len(picked) < n:
        added = False
        for code in PRIORITY:
            while by_comm.get(code):
                pkg = by_comm[code].pop(0)
                if pkg in picked:
                    continue
                if set(fetch.fetch_text(pkg).values()) <= {'missing', 'fail'}:     # no html edition or PDF published yet
                    skipped.append(pkg)
                    continue
                picked.append(pkg)
                added = True
                break
            if len(picked) >= n:
                break
        if not added:
            break
    if skipped:
        print(len(skipped), 'skipped, no html text yet:', ' '.join(skipped))
    return picked


def main():
    args = sys.argv[1:]
    if args == ['--all']:
        build.OUT = build.ROOT / 'out_full'          # keep the pilot sample in out/
        mods = all_mods()
        ids = [pkg for pkg, m in mods.items()
               if not (m['committees'] and (m['committees'][0]['authority_id'] or '').startswith('hsru'))]
        ids.sort(key=fetch.natural_key)
    elif args:
        ids = args
    else:
        ids = select_pilot()
    print(len(ids), 'reports:', ' '.join(ids), flush=True)
    for pkg in ids:
        fetch.fetch_mods(pkg)
        print(pkg, 'text', fetch.fetch_text(pkg), flush=True)
        m = build.mods_info(pkg)
        for b in m['bills'][:1]:
            print('   bill', build.bill_id_of(b), fetch.fetch_billstatus(build.bill_id_of(b)), flush=True)
    b = build.Builder()
    for pkg in ids:
        try:
            b.build_report(pkg)
        except Exception:
            import traceback
            traceback.print_exc()
            b.issues.append((pkg, 'build:exception', 'see stderr'))
    b.finish()
    print(open(build.OUT / 'pilot_report.md').read())


if __name__ == '__main__':
    main()
