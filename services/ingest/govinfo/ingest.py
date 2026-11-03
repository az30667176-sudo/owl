#!/usr/bin/env python3
"""OWL ingest - the one command the agent (or a scheduler) runs. House committee reports of the 119th Congress, from
govinfo, parsed without any model into the CSV tables services/process consumes.

  python3 -I ingest.py check                       what is new on govinfo since the last run (sitemaps + MODS); updates state/packages.json
  python3 -I ingest.py fetch  [--refresh-bills N]  download report text (html edition, else PDF -> pdftotext) and bill status the cache lacks;
                                                   --refresh-bills N re-downloads BILLSTATUS for bills reported in the last N days (cosponsors grow)
  python3 -I ingest.py build  [--publish DIR] [--no-validate]
                                                   offline, ~10 min: parse every report -> out_full/, contract-A records + people.json, seed
                                                   issues, flip scan, CSV handoff + CHANGES.md + delta/; validate with the repo checker; copy to DIR
  python3 -I ingest.py run    [--publish DIR] [--refresh-bills N] [--force-build]
                                                   check + fetch + build-if-anything-changed. THE WEEKLY JOB.
  python3 -I ingest.py backfill [--publish DIR]    one-off: every report of the 119th (sitemaps, MODS, text, bills) then build
  python3 -I ingest.py status                      last run, counts, what is still without text

Network only in check / fetch / backfill (govinfo, key-free). build is offline and deterministic. No model is called.
Every command logs to state/runs/<timestamp>.log and ends with one line `RESULT: {json}` for the caller to read.
Exit code 0 = fine (also when nothing is new); 1 = a step failed (the RESULT line says which).
"""
import argparse
import csv
import datetime
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from m1 import build as build_mod  # noqa: E402
from m1 import fetch, paths, roster  # noqa: E402

ROOT, STATE, OUT = paths.ROOT, paths.STATE, paths.OUT_FULL
PKG_FILE, LAST_FILE, KEYS_FILE = STATE / 'packages.json', STATE / 'last_run.json', STATE / 'handoff_keys.json'
PY = [sys.executable, '-I']
CSV_FILES = ['records.csv', 'evidence.csv', 'people.csv', 'bills.csv', 'issues.csv', 'bill_committees.csv',
             'committee_seats.csv', 'committees.csv', 'reports.csv', 'README.md', 'MANIFEST.csv']


def now():
    return datetime.datetime.now().replace(microsecond=0).isoformat()


class Log:
    """print + append to state/runs/<ts>.log; subprocess output goes to the file only (the agent reads the summary)."""
    def __init__(self, cmd):
        (STATE / 'runs').mkdir(parents=True, exist_ok=True)
        self.path = STATE / 'runs' / f"{now().replace(':', '')}-{cmd}.log"
        self.f = open(self.path, 'a', encoding='utf-8')

    def __call__(self, *a):
        line = ' '.join(str(x) for x in a)
        print(line, flush=True)
        self.f.write(line + '\n')
        self.f.flush()

    def run(self, name, cmd, cwd=ROOT):
        """Run a step; its stdout/stderr go to the log file. Raises on failure."""
        self(f'[{now()[11:]}] {name} ...')
        self.f.write('$ ' + ' '.join(str(c) for c in cmd) + '\n')
        t0 = time.time()
        r = subprocess.run([str(c) for c in cmd], cwd=str(cwd), stdout=self.f, stderr=subprocess.STDOUT, text=True)
        self(f'    {"ok" if r.returncode == 0 else "FAILED"} in {time.time() - t0:.0f}s (exit {r.returncode})')
        if r.returncode:
            raise RuntimeError(f'{name} failed (exit {r.returncode}); see {self.path}')
        return r


# ---------------------------------------------------------------- state

def load_state():
    if PKG_FILE.exists():
        return json.load(open(PKG_FILE, encoding='utf-8'))
    return {'updated': None, 'packages': {}}


def save_state(st):
    st['updated'] = now()
    STATE.mkdir(parents=True, exist_ok=True)
    tmp = PKG_FILE.with_suffix('.json.tmp')
    json.dump(st, open(tmp, 'w', encoding='utf-8'), indent=1, sort_keys=True)
    tmp.replace(PKG_FILE)


def describe(pkg, lastmod, old=None):
    """One state entry from the cached MODS (+ what text the cache holds)."""
    m = build_mod.mods_info(pkg)
    comm = m['committees'][0] if m['committees'] else None
    code = roster.authority_to_code(comm['authority_id']) if comm and comm['authority_id'] else None
    parts = {p['id']: (fetch.text_path(p['id'])[1] or 'missing') for p in fetch.parts_of(pkg)}
    return {'first_seen': (old or {}).get('first_seen') or now()[:10], 'lastmod': lastmod or (old or {}).get('lastmod'),
            'date': m['date'], 'committee': code, 'title': (m['title'] or '')[:120],
            'bills': [build_mod.bill_id_of(b) for b in m['bills']], 'parts': parts, 'checked': now()}


def textless(st):
    return sorted((p for p, e in st['packages'].items()
                   if e.get('committee') != 'HSRU' and any(v not in ('html', 'pdf') for v in e['parts'].values())),
                  key=fetch.natural_key)


# ---------------------------------------------------------------- steps

def check(log):
    """Refresh the govinfo sitemaps; register new packages (download their MODS); flag changed ones."""
    st = load_state()
    known = st['packages']
    roster_status, roster_changed = fetch.fetch_roster()        # members + seats, refreshed when older than 30 days
    log(f"roster: {roster_status}{' (changed)' if roster_changed else ''}")
    sm = fetch.fetch_sitemaps(force=True)
    log(f'sitemaps: {sm}')
    if not any(v in ('ok', 'cached') for v in sm.values()) and not list(fetch.CACHE.glob('sitemap_20*.xml')):
        raise RuntimeError('could not download the govinfo sitemaps and none are cached')
    entries = fetch.sitemap_entries()
    if not known:                                   # first run on this machine: adopt whatever the cache already holds
        for f in sorted(fetch.CACHE.glob('mods/CRPT-119hrpt*.xml')):
            try:
                known[f.stem] = describe(f.stem, entries.get(f.stem))
            except Exception as e:                  # a truncated download; drop it, check() re-fetches it below
                log(f'bad mods {f.stem}: {e}; removed'); f.unlink()
        log(f'state initialised from cache: {len(known)} packages')
    new = sorted((p for p in entries if p not in known), key=fetch.natural_key)
    updated = sorted((p for p in known if entries.get(p, '') > (known[p].get('lastmod') or '')), key=fetch.natural_key)
    mods_fail = []
    for p in new:
        s = fetch.fetch_mods(p)
        if s in ('ok', 'cached'):
            known[p] = describe(p, entries[p])
        else:
            mods_fail.append(p)
    for p in updated:                               # govinfo touched the package: metadata (or a new part) may have changed
        if fetch.fetch_mods(p, force=True) in ('ok', 'cached'):
            known[p] = describe(p, entries[p], known[p])
    save_state(st)
    summary = {'packages_on_govinfo': len(entries), 'known': len(known), 'new': new, 'updated': updated,
               'mods_failed': mods_fail, 'textless': textless(st), 'roster_changed': roster_changed}
    log(f"check: {len(entries)} reports listed by govinfo, {len(new)} new, {len(updated)} changed, "
        f"{len(summary['textless'])} without text yet" + (f", {len(mods_fail)} MODS downloads failed" if mods_fail else ''))
    for p in new:
        e = known.get(p)
        if e:
            log(f"  new: {p}  {e['date']}  {e['committee']}  {', '.join(e['bills'][:1])}  {e['title'][:70]}")
    return summary


def fetch_all(log, refresh_bills_days=None):
    """Download text for every part the cache lacks (retrying the text-less ones) and BILLSTATUS for every primary bill."""
    st = load_state()
    if not st['packages']:
        raise RuntimeError('no packages known yet; run `check` (or `backfill`) first')
    newly, still, failed, bills_new, bills_changed = [], [], [], 0, 0
    cutoff = (datetime.date.today() - datetime.timedelta(days=refresh_bills_days)).isoformat() if refresh_bills_days else None
    for pkg in sorted(st['packages'], key=fetch.natural_key):
        e = st['packages'][pkg]
        if e.get('committee') == 'HSRU':
            continue                                # Rules reports are metadata only; no text needed
        before = dict(e['parts'])
        if any(v not in ('html', 'pdf') for v in before.values()) or not before:
            res = fetch.fetch_text(pkg)
            e['parts'] = res
            for pid, v in res.items():
                if v in ('html', 'pdf') and before.get(pid) not in ('html', 'pdf'):
                    newly.append(f'{pid}:{v}')
                elif v == 'fail':
                    failed.append(pid)
                elif v == 'missing':
                    still.append(pid)
        for b in e['bills'][:1]:                    # the primary bill (what the report accompanies)
            path = fetch.CACHE / 'billstatus' / f"BILLSTATUS-{b.split('-')[1]}{b.split('-')[0]}.xml"
            had = hashlib.sha1(path.read_bytes()).hexdigest() if path.exists() else None
            force = bool(cutoff and (e.get('date') or '') >= cutoff)
            s = fetch.fetch_billstatus(b, force=force)
            if s == 'ok':
                if had is None:
                    bills_new += 1
                elif hashlib.sha1(path.read_bytes()).hexdigest() != had:
                    bills_changed += 1
        e['checked'] = now()
    save_state(st)
    summary = {'newly_texted': newly, 'still_textless': still, 'text_failed': failed,
               'bills_new': bills_new, 'bills_changed': bills_changed}
    log(f'fetch: {len(newly)} parts got text ({sum(x.endswith(":pdf") for x in newly)} from the PDF), '
        f'{len(still)} still unpublished, {len(failed)} download failures, {bills_new} new bills, {bills_changed} bills changed')
    return summary


def keys_of(csv_dir):
    """Stable ids of the current CSV drop, for the delta."""
    def col(name, c):
        p = csv_dir / name
        if not p.exists():
            return []
        with open(p, encoding='utf-8', newline='') as f:
            return [r[c] for r in csv.DictReader(f)]
    with open(csv_dir / 'reports.csv', encoding='utf-8', newline='') as f:
        parsed = [r['source_id'] for r in csv.DictReader(f) if r['text_parsed'] == 'yes']
    return {'records': col('records.csv', 'record_id'), 'evidence': col('evidence.csv', 'evidence_id'),
            'people': col('people.csv', 'bioguide_id'), 'bills': col('bills.csv', 'bill_id'),
            'issues': col('issues.csv', 'issue_id'), 'reports_parsed': parsed}


def write_delta(log, csv_dir, publish):
    """CHANGES.md + delta/ (only the rows that are new) against the previous drop: the published copy when there is
    one, else state/handoff_keys.json. Then remember this drop's keys."""
    cur = keys_of(csv_dir)
    prev, prev_label = None, None
    if publish and (pathlib.Path(publish) / 'records.csv').exists() and (pathlib.Path(publish) / 'reports.csv').exists():
        prev, prev_label = keys_of(pathlib.Path(publish)), f'the copy in {publish}'
    elif KEYS_FILE.exists():
        k = json.load(open(KEYS_FILE, encoding='utf-8'))
        prev, prev_label = k['keys'], f"the drop of {k['date']}"
    today = now()[:10]
    lines = [f'# Changes in this drop ({today})', '']
    delta_dir = csv_dir / 'delta'
    if delta_dir.exists():
        shutil.rmtree(delta_dir)
    added_counts = {}
    if prev is None:
        lines += ['First drop: every row is new. From the next drop on, this file lists what changed and `delta/` holds '
                  'only the added rows.', '']
    else:
        lines += [f'Compared with {prev_label}.', '', '| table | rows now | added | removed |', '|---|---|---|---|']
        file_of = {'records': 'records.csv', 'evidence': 'evidence.csv', 'people': 'people.csv', 'bills': 'bills.csv',
                   'issues': 'issues.csv', 'reports_parsed': 'reports.csv'}
        id_col = {'records.csv': 'record_id', 'evidence.csv': 'evidence_id', 'people.csv': 'bioguide_id',
                  'bills.csv': 'bill_id', 'issues.csv': 'issue_id', 'reports.csv': 'source_id'}
        for k, fname in file_of.items():
            a, r = set(cur[k]) - set(prev[k]), set(prev[k]) - set(cur[k])
            label = 'reports with text' if k == 'reports_parsed' else fname
            lines.append(f'| {label} | {len(cur[k]):,} | {len(a):,} | {len(r):,} |')
            added_counts[k] = len(a)
            if a:
                delta_dir.mkdir(exist_ok=True)
                with open(csv_dir / fname, encoding='utf-8', newline='') as f:
                    rd = csv.DictReader(f)
                    rows = [row for row in rd if row[id_col[fname]] in a]
                    hdr = rd.fieldnames
                with open(delta_dir / fname, 'w', encoding='utf-8', newline='') as f:
                    w = csv.DictWriter(f, fieldnames=hdr, lineterminator='\n')
                    w.writeheader()
                    w.writerows(rows)
        lines.append('')
        if added_counts.get('reports_parsed'):
            with open(csv_dir / 'reports.csv', encoding='utf-8', newline='') as f:
                newrep = [r for r in csv.DictReader(f) if r['source_id'] in set(cur['reports_parsed']) - set(prev['reports_parsed'])]
            lines += [f'## Reports newly parsed ({len(newrep)})', '']
            lines += [f"- {r['citation']} ({r['committee_code']}, {r['date']}, text from {r['text_source']}): {r['title'][:90]}"
                      for r in sorted(newrep, key=lambda r: fetch.natural_key(r['source_id']))]
            lines.append('')
        lines += ['`delta/<table>.csv` holds only the added rows, same columns as the full tables. Removed rows (a report '
                  'reparsed differently, a member who left) are not listed row by row; diff on the id columns if needed.', '']
    (csv_dir / 'CHANGES.md').write_text('\n'.join(lines), encoding='utf-8')
    STATE.mkdir(parents=True, exist_ok=True)
    json.dump({'date': today, 'keys': cur}, open(KEYS_FILE, 'w', encoding='utf-8'))
    log(f"delta: {', '.join(f'{k} +{v}' for k, v in added_counts.items()) if added_counts else 'first drop (baseline)'}")
    return added_counts


def build(log, publish=None, validate=True):
    """Offline: everything from the cache to the handoff."""
    t0 = time.time()
    if not all((fetch.CACHE / 'roster' / f).exists() for f in fetch.ROSTER_FILES):
        log(f'roster: {fetch.fetch_roster()[0]}')
    shutil.rmtree(OUT / 'text', ignore_errors=True)      # no stale text from reports that are now skipped (reports.csv text_parsed)
    log.run('parse every report -> out_full/ (offline, under a minute)', PY + ['run_pilot.py', '--all'])
    log.run('export contract-A records + people.json -> out_full/owl/', PY + ['m1/export_owl.py'])
    log.run('seed issues.json from bill metadata', PY + ['m1/seed_issues.py'])
    log.run('flip scan (no model)', PY + ['m1/flip_scan.py'])
    log.run('CSV handoff -> out_full/csv/', PY + ['m1/export_csv.py'])
    csv_dir = OUT / 'csv'
    repo = paths.repo_root()
    validated, converter = None, None
    if validate:
        if repo and shutil.which('node'):
            checker = repo / 'packages' / 'contract' / 'validate.mjs'
            conv = repo / 'services' / 'ingest' / 'csv-to-json.mjs'
            if conv.exists():
                # The gate is the consumer's own converter (Ben's services/ingest/csv-to-json.mjs, Nov 1): CSV drop ->
                # contract JSON in state/staging/ (never committed), then the repo validator over that output with the
                # quotes checked against the records it produced. Exactly what the process stage will run on the drop.
                staging = STATE / 'staging'
                shutil.rmtree(staging, ignore_errors=True)
                cmd = ['node', conv, csv_dir, staging, '--drop', f'ingest-{now()[:10]}']
                if (repo / 'data' / 'taxonomy.json').exists():
                    cmd += ['--sub-names', repo / 'data' / 'taxonomy.json']     # real subcommittee names
                log.run(f'convert the drop with {repo.name}/services/ingest/csv-to-json.mjs -> state/staging/', cmd)
                log.run(f'validate state/staging with {repo.name}/packages/contract/validate.mjs (quotes checked)',
                        ['node', checker, staging, '--records', staging / 'records'])
                n_st = len(json.load(open(staging / 'stances.json', encoding='utf-8'))['stances'])
                n_all = len(list((staging / 'records').glob('rec-*.json')))
                n_syn = len(list((staging / 'records').glob('rec-billstatus-*.json')))
                converter = {'statements': n_st, 'records': n_all - n_syn, 'synthetic_records': n_syn}
                validated = n_all - n_syn
                log(f'converter: {n_st} deterministic statements from {validated} records '
                    f'(+{n_syn} synthetic BILLSTATUS records); validator ok')
            else:
                recs = sorted((OUT / 'owl' / 'records').glob('rec-*.json'))
                cmd = ['node', str(checker)]
                for r in recs:
                    cmd += ['--record', str(r)]
                log.run(f'validate {len(recs)} records with {repo.name}/packages/contract/validate.mjs', cmd)
                validated = len(recs)
        else:
            log('validate: skipped (no OWL repo with packages/contract/validate.mjs found, or node missing)')
    added = write_delta(log, csv_dir, publish)
    published = None
    if publish:
        dst = pathlib.Path(publish)
        dst.mkdir(parents=True, exist_ok=True)
        for name in CSV_FILES + ['CHANGES.md']:
            if (csv_dir / name).exists():
                shutil.copy2(csv_dir / name, dst / name)
        if (dst / 'delta').exists():
            shutil.rmtree(dst / 'delta')
        if (csv_dir / 'delta').exists():
            shutil.copytree(csv_dir / 'delta', dst / 'delta')
        published = str(dst)
        log(f'published the CSV drop to {dst}')
    man = {}
    with open(csv_dir / 'MANIFEST.csv', encoding='utf-8', newline='') as f:
        for r in csv.DictReader(f):
            if r['rows']:
                man[r['file']] = int(r['rows'])
    summary = {'rows': man, 'added': added, 'validated_records': validated, 'converter': converter,
               'published': published, 'minutes': round((time.time() - t0) / 60, 1)}
    log(f"build: {man.get('records.csv')} records, {man.get('evidence.csv')} evidence rows, {man.get('reports.csv')} reports "
        f"in {summary['minutes']} min" + (f'; {validated} records pass the contract validator' if validated else ''))
    return summary


def write_last(cmd, result, started):
    STATE.mkdir(parents=True, exist_ok=True)
    json.dump({'command': cmd, 'started': started, 'finished': now(), 'result': result},
              open(LAST_FILE, 'w', encoding='utf-8'), indent=1)


def status(log):
    st = load_state()
    last = json.load(open(LAST_FILE, encoding='utf-8')) if LAST_FILE.exists() else None
    tl = textless(st)
    parts = sum(len(e['parts']) for e in st['packages'].values())
    kinds = {}
    for e in st['packages'].values():
        for v in e['parts'].values():
            k = 'rules (metadata only, text not fetched)' if e.get('committee') == 'HSRU' else v
            kinds[k] = kinds.get(k, 0) + 1
    log(f"state: {len(st['packages'])} packages, {parts} parts ({kinds}), updated {st.get('updated')}")
    log(f'without text (non-Rules): {len(tl)}' + (f": {' '.join(tl[:20])}{' ...' if len(tl) > 20 else ''}" if tl else ''))
    if last:
        log(f"last run: {last['command']} started {last['started']} finished {last['finished']}")
        log(f"  result: {json.dumps(last['result'])[:600]}")
    else:
        log('last run: none recorded')
    if (OUT / 'csv' / 'MANIFEST.csv').exists():
        log(f"current drop: {OUT / 'csv'} (MANIFEST.csv dated {datetime.date.fromtimestamp((OUT / 'csv' / 'MANIFEST.csv').stat().st_mtime)})")
    return {'packages': len(st['packages']), 'parts': kinds, 'textless': tl, 'last_run': last}


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('command', choices=['check', 'fetch', 'build', 'run', 'backfill', 'status'])
    ap.add_argument('--publish', metavar='DIR', help='copy the CSV drop (+ CHANGES.md, delta/) to DIR')
    ap.add_argument('--refresh-bills', type=int, metavar='N', default=None,
                    help='re-download BILLSTATUS for bills whose report is dated within the last N days (run: default 45)')
    ap.add_argument('--force-build', action='store_true', help='run: rebuild even when nothing new was found')
    ap.add_argument('--no-validate', action='store_true', help='build: skip the repo contract validator')
    a = ap.parse_args()
    log = Log(a.command)
    started = now()
    log(f'== ingest {a.command} == {started} in {ROOT}')
    result = {'command': a.command, 'ok': True}
    try:
        if a.command == 'check':
            result.update(check(log))
        elif a.command == 'fetch':
            result.update(fetch_all(log, a.refresh_bills))
        elif a.command == 'build':
            result.update(build(log, a.publish, not a.no_validate))
        elif a.command == 'status':
            result.update(status(log))
        elif a.command == 'backfill':
            log(f'roster: {fetch.fetch_roster()[0]}')
            fetch.fetch_sitemaps(force=True)
            ids = fetch.report_ids()
            log(f'backfill: {len(ids)} reports listed by govinfo; downloading MODS the cache lacks ...')
            tally = {}
            for i, pkg in enumerate(ids, 1):
                s = fetch.fetch_mods(pkg)
                tally[s] = tally.get(s, 0) + 1
                if i % 100 == 0:
                    log(f'  {i}/{len(ids)} {tally}')
            log(f'  MODS: {tally}')
            result['check'] = check(log)
            result['fetch'] = fetch_all(log, a.refresh_bills)
            result['build'] = build(log, a.publish, not a.no_validate)
        elif a.command == 'run':
            c = check(log)
            f = fetch_all(log, 45 if a.refresh_bills is None else a.refresh_bills)
            result['check'], result['fetch'] = c, f
            changed = bool(c['new'] or c['updated'] or f['newly_texted'] or f['bills_new'] or f['bills_changed']
                           or c.get('roster_changed'))
            if changed or a.force_build:
                why = ('forced' if a.force_build and not changed else
                       f"{len(c['new'])} new reports, {len(f['newly_texted'])} parts newly with text, "
                       f"{f['bills_new'] + f['bills_changed']} bills new/changed"
                       + (', member roster changed' if c.get('roster_changed') else ''))
                log(f'something changed ({why}): rebuilding')
                result['build'] = build(log, a.publish, not a.no_validate)
                result['changed'] = True
            else:
                result['changed'] = False
                log('nothing new on govinfo since the last run; no rebuild')
        write_last(a.command, result, started)
    except Exception as e:
        result.update({'ok': False, 'error': f'{type(e).__name__}: {e}', 'log': str(log.path)})
        write_last(a.command, result, started)
        log(f'ERROR {result["error"]}')
        log('RESULT: ' + json.dumps(result, default=str))
        sys.exit(1)
    log('RESULT: ' + json.dumps(result, default=str))


if __name__ == '__main__':
    main()
