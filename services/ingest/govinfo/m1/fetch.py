"""Download sources into cache/. Everything here is key-free (govinfo + GitHub). No model is called.

  python3 -I m1/fetch.py sitemaps [--force]   # ids + lastmod of every 119th House report (force = re-download the sitemaps)
  python3 -I m1/fetch.py mods-all             # MODS metadata for every report (~7 min the first time, then cached)
  python3 -I m1/fetch.py text ID [ID...]      # report text: html edition, else the PDF through pdftotext
  python3 -I m1/fetch.py bills hr1382-119 ... # bulk BILLSTATUS xml
  python3 -I m1/fetch.py roster [--force]     # members + committee seats (unitedstates/congress-legislators), refreshed monthly

govinfo facts that shaped this file (checked Oct 30 2026):
- A report's files are NOT always <pkg>.htm / <pkg>.pdf. For 77 of the 852 packages of the 119th GPO names them
  <pkg>-pt1.htm (and -pt2 ... for multi-part reports). The MODS record lists the real rendition URLs, so we read them
  from there instead of guessing (parts_of). 18 packages have 2-4 parts ("Book 1", "Book 2", ...).
- A missing file is answered with HTTP 200 and a 44 kB "Page Not Found" page, for .htm and .pdf alike.
- The html edition (fixed-width text, what the parser was written for) is published together with the PDF; the PDF is
  the fallback for the day it is not.
"""
import datetime
import pathlib
import re
import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / 'cache'
GOVINFO = 'https://www.govinfo.gov'
UA = 'owl-ingest/0.2 (House committee reports; Meta hackathon team project)'
NOT_FOUND = b'Page Not Found | GovInfo'
XLINK = '{http://www.w3.org/1999/xlink}href'


def get(url, dest, delay=0.2, retries=3, force=False):
    """-> 'cached' | 'ok' | 'missing' | 'fail'. curl rather than urllib: the python.org build on this Mac has no CA
    bundle for urllib. Downloads go to a .part file first, so a failed refresh never destroys a cached copy."""
    dest = pathlib.Path(dest)
    if not force and dest.exists() and dest.stat().st_size > 0:
        return 'cached'
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + '.part')
    last = ''
    for attempt in range(retries):
        r = subprocess.run(['curl', '-sSL', '--fail', '--max-time', '120', '-A', UA, '-o', str(tmp), url],
                           capture_output=True, text=True)
        if r.returncode == 0 and tmp.exists() and tmp.stat().st_size > 0:
            head = tmp.read_bytes()[:4000]
            if NOT_FOUND in head or (dest.suffix == '.pdf' and not head.startswith(b'%PDF')):
                tmp.unlink()                      # govinfo answers 200 with a not-found page
                return 'missing'
            tmp.replace(dest)
            time.sleep(delay)
            return 'ok'
        last = r.stderr.strip()
        if r.returncode == 22 and '404' in last:
            tmp.unlink(missing_ok=True)
            return 'missing'
        time.sleep(2 * (attempt + 1))
    tmp.unlink(missing_ok=True)
    print(f'FAIL {url}: {last}', file=sys.stderr)
    return 'fail'


def natural_key(pkg):
    m = re.search(r'hrpt(\d+)(?:-pt(\d+))?', pkg)
    return (int(m.group(1)), int(m.group(2) or 0))


# ---------------------------------------------------------------- sitemaps (what exists)

def sitemap_years():
    """The 119th Congress runs Jan 2025 - Jan 2027; govinfo files one CRPT sitemap per publication year."""
    return list(range(2025, min(datetime.date.today().year, 2027) + 1))


def fetch_sitemaps(force=False):
    return {year: get(f'{GOVINFO}/sitemap/CRPT_{year}_sitemap.xml', CACHE / f'sitemap_{year}.xml', force=force)
            for year in sitemap_years()}


def sitemap_entries():
    """{pkg: lastmod} for every 119th House report listed in the cached sitemaps (lastmod = govinfo's last change)."""
    out = {}
    for f in sorted(CACHE.glob('sitemap_20*.xml')):
        for pkg, lastmod in re.findall(r'details/(CRPT-119hrpt[^<]+)</loc>\s*<lastmod>([^<]+)', f.read_text()):
            out[pkg] = max(lastmod, out.get(pkg, ''))
    return out


def report_ids():
    return sorted(sitemap_entries(), key=natural_key)


# ---------------------------------------------------------------- MODS (what a report is, where its files are)

def fetch_mods(pkg, force=False):
    return get(f'{GOVINFO}/metadata/pkg/{pkg}/mods.xml', CACHE / 'mods' / f'{pkg}.xml', force=force)


def parts_of(pkg):
    """Renditions from the cached MODS, one entry per constituent granule (part), else the package itself:
       [{'id': 'CRPT-119hrpt106-pt2', 'html': url, 'pdf': url, 'part_name': 'Book 2', 'committee_authority': 'hsbu00'}]
    A single-part package keeps id == pkg even when GPO names the file <pkg>-pt1 (59 of 852 in the 119th), so the
    cache, record ids and citations stay the same as for the 775 packages with plain file names."""
    root = ET.parse(CACHE / 'mods' / f'{pkg}.xml').getroot()
    local = lambda tag: tag.rsplit('}', 1)[-1]
    parts = []
    for ri in root.iter():
        if local(ri.tag) != 'relatedItem' or ri.get('type') != 'constituent':
            continue
        p = {'id': None, 'html': None, 'pdf': None, 'part_name': None, 'committee_authority': None}
        for el in ri.iter():
            t = local(el.tag)
            if t == 'relatedItem' and el.get('type') == 'otherFormat':
                href = el.get(XLINK) or ''
                if href.endswith('.htm'):
                    p['html'] = href
                elif href.endswith('.pdf'):
                    p['pdf'] = href
            elif t == 'partName' and p['part_name'] is None:
                p['part_name'] = (el.text or '').strip() or None
            elif t == 'congCommittee' and p['committee_authority'] is None:
                p['committee_authority'] = el.get('authorityId')
        m = re.search(r'/(CRPT-119hrpt\d+(?:-pt\d+)?)\.(?:htm|pdf)$', p['html'] or p['pdf'] or '')
        if m:
            p['id'] = m.group(1)
            parts.append(p)
    if not parts:                                   # no granules: the package-level location/url list
        p = {'id': pkg, 'html': None, 'pdf': None, 'part_name': None, 'committee_authority': None}
        for el in root.iter():
            if local(el.tag) == 'url':
                label, href = el.get('displayLabel') or '', (el.text or '').strip()
                if label == 'HTML rendition' and not p['html']:
                    p['html'] = href
                elif label == 'PDF rendition' and not p['pdf']:
                    p['pdf'] = href
        if not p['html'] and not p['pdf']:          # MODS without any url: fall back to the conventional names
            p['html'] = f'{GOVINFO}/content/pkg/{pkg}/html/{pkg}.htm'
            p['pdf'] = f'{GOVINFO}/content/pkg/{pkg}/pdf/{pkg}.pdf'
        parts = [p]
    parts.sort(key=lambda p: natural_key(p['id']))
    if len(parts) == 1:
        parts[0]['id'], parts[0]['part_name'] = pkg, None
    return parts


# ---------------------------------------------------------------- report text (html edition, else PDF)

def text_path(part_id):
    """Cached text of one part -> (path, 'html' | 'pdf') or (None, None). The html edition wins when both exist."""
    h = CACHE / 'crpt' / f'{part_id}.htm'
    if h.exists() and h.stat().st_size > 0:
        return h, 'html'
    p = CACHE / 'crpt' / f'{part_id}.pdf.txt'
    if p.exists() and p.stat().st_size > 0:
        return p, 'pdf'
    return None, None


def pdf_to_text(pdf, dest):
    """pdftotext -layout keeps the fixed-width layout the parser relies on; parse.load_pdf_text cleans the margins."""
    if not shutil.which('pdftotext'):
        print('pdftotext not installed (macOS: brew install poppler; Debian: apt install poppler-utils)', file=sys.stderr)
        return False
    r = subprocess.run(['pdftotext', '-layout', '-enc', 'UTF-8', str(pdf), str(dest)], capture_output=True, text=True)
    ok = r.returncode == 0 and dest.exists() and dest.stat().st_size > 0
    if not ok:
        pathlib.Path(dest).unlink(missing_ok=True)
        print(f'pdftotext failed on {pdf}: {r.stderr.strip()[:200]}', file=sys.stderr)
    return ok


def fetch_text(pkg, pdf_fallback=True):
    """Download what the cache lacks for every part of a report.
    -> {part_id: 'html' | 'pdf' | 'missing' | 'fail'} ('missing' = govinfo has published neither rendition yet)."""
    out = {}
    for part in parts_of(pkg):
        pid = part['id']
        if text_path(pid)[0]:
            out[pid] = text_path(pid)[1]
            continue
        st = get(part['html'], CACHE / 'crpt' / f'{pid}.htm') if part['html'] else 'missing'
        if st == 'ok':
            out[pid] = 'html'
            continue
        if st == 'fail' or not pdf_fallback or not part['pdf']:
            out[pid] = 'fail' if st == 'fail' else 'missing'
            continue
        pdf = CACHE / 'pdf' / f'{pid}.pdf'
        st = get(part['pdf'], pdf)
        if st in ('ok', 'cached') and pdf_to_text(pdf, CACHE / 'crpt' / f'{pid}.pdf.txt'):
            out[pid] = 'pdf'
        else:
            out[pid] = 'missing' if st == 'missing' else 'fail'
    return out


# ---------------------------------------------------------------- roster (members, committee seats)

ROSTER_BASE = 'https://unitedstates.github.io/congress-legislators'
ROSTER_FILES = ('legislators-current.yaml', 'legislators-historical.yaml',
                'committee-membership-current.yaml', 'committees-current.yaml')


def fetch_roster(max_age_days=30, force=False):
    """unitedstates/congress-legislators -> cache/roster/. Members leave and seats change, so a file older than
    max_age_days is re-downloaded (a failed refresh keeps the old copy). The derived house119.json is dropped when a
    yaml changed, so roster.load_people() rebuilds it. -> ({file: status}, changed)"""
    out, changed = {}, False
    for f in ROSTER_FILES:
        dest = CACHE / 'roster' / f
        stale = force or not dest.exists() or dest.stat().st_size == 0 or \
            (time.time() - dest.stat().st_mtime) > max_age_days * 86400
        before = dest.read_bytes() if dest.exists() else None
        out[f] = get(f'{ROSTER_BASE}/{f}', dest, force=stale and dest.exists())
        if out[f] == 'ok' and (before is None or dest.read_bytes() != before):
            changed = True
    if changed:
        (CACHE / 'roster' / 'house119.json').unlink(missing_ok=True)
    return out, changed


# ---------------------------------------------------------------- bills

def fetch_billstatus(bill_id, force=False):
    """bill_id like hr1382-119 -> cache/billstatus/BILLSTATUS-119hr1382.xml (sponsor, cosponsors, subjects, actions)"""
    typ, num, cong = re.fullmatch(r'([a-z]+)(\d+)-(\d+)', bill_id).groups()
    name = f'BILLSTATUS-{cong}{typ}{num}.xml'
    return get(f'{GOVINFO}/bulkdata/BILLSTATUS/{cong}/{typ}/{name}', CACHE / 'billstatus' / name, force=force)


if __name__ == '__main__':
    cmd, args = (sys.argv[1] if len(sys.argv) > 1 else ''), sys.argv[2:]
    if cmd == 'sitemaps':
        print(fetch_sitemaps(force='--force' in args))
        print(len(report_ids()), 'report ids')
    elif cmd == 'mods-all':
        ids = report_ids()
        tally = {}
        for i, pkg in enumerate(ids, 1):
            status = fetch_mods(pkg)
            tally[status] = tally.get(status, 0) + 1
            if i % 50 == 0:
                print(i, '/', len(ids), tally, flush=True)
        print('done', tally)
    elif cmd == 'text':
        for pkg in args:
            print(pkg, fetch_text(pkg))
    elif cmd == 'bills':
        for b in args:
            print(b, fetch_billstatus(b))
    elif cmd == 'roster':
        print(fetch_roster(force='--force' in args))
    else:
        sys.exit(__doc__)
