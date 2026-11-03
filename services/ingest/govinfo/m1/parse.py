"""Turn a govinfo House-report .htm into sections, and pull the deterministic facts out of them:
committee vote tables, views signature blocks, sponsor / amendment sentences in the legislative history.

Formats seen in the Oct 28 pilot (20 reports, 17 committees):
- vote tables with a dot leader and a letter (Transportation: "Mr. Graves of MO....... Y")
- column tables with x marks under Aye/No/Present (Armed Services, Ways and Means: "Mr. Rogers (AL)....  .....  x  ....")
- narrative votes with totals only (Budget, Judiciary, Financial Services)
- tallies printed as images (Energy and Commerce, Homeland Security, Small Business, Veterans) -> graphic_only
Layouts that are none of these are reported as 'unsupported' rather than guessed.
"""
import html
import re

HEADING_MIN_INDENT = 6

# First match wins. Only these start a new section; any other centred line is a sub-heading and
# stays inside the current section. Headings may carry a numeral ("III. Votes of the Committee").
SECTION_PATTERNS = [
    ('purpose', r'^(?:purpose|summary)'),
    ('background', r'^background'),
    ('hearings', r'^(?:committee |legislative )?hearings?\b'),
    ('legislative_history', r'legislative history|committee consideration|^consideration|^markup|committee action'),
    ('committee_votes', r'committee votes?|votes? of the committee|record(?:ed)? votes?|roll ?call votes?|committee markup'),
    ('minority_views', r'minority views'),
    ('additional_views', r'additional views'),
    ('dissenting_views', r'dissenting views'),
    ('supplemental_views', r'supplemental views'),
    ('views', r'^views of|\bviews$'),
    ('section_by_section', r'section-by-section|section by section'),
    ('changes_in_existing_law', r'changes in existing law'),
    ('cbo', r'congressional budget office|cost estimate|budget authority|new budget'),
    ('oversight', r'oversight'),
    ('boilerplate', r'federal mandates|advisory committee|applicability to (?:the )?legislative branch|earmark|'
                    r'duplication|directed rule ?making|performance goals|preemption|statement of general|'
                    r'constitutional authority|unfunded mandate|correspondence|exchange of letters|'
                    r'federal advisory|hearing summary|committee cost|general performance|'
                    r'explanation of amendment|committee amendment|committee recommendation|'
                    r'committee estimate|macroeconomic|tax expenditure'),
]
VIEWS_TYPES = {'minority_views', 'additional_views', 'dissenting_views', 'supplemental_views', 'views'}
# section types that, when they appear after a views heading, are sub-headings of the views
# (a CBO estimate or section-by-section after the views is a real section and must not be absorbed)
ABSORBABLE = {'oversight', 'boilerplate', 'purpose', 'background', 'hearings'}

TITLE = r'(?:Mr|Ms|Mrs|Dr|Miss|Mx|Del)'
NAME_IN_TABLE = rf"{TITLE}\.?\s+[A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-]+){{0,2}}(?:\s+of\s+[A-Z]{{2}}|\s+\([A-Z]{{2}}\))?"
FIELD = r'(?:x|X|\.{3,})'
# "Mr. Graves of MO................            Y"  (dot leader, letter)
ROW_RE = re.compile(rf"({NAME_IN_TABLE})\.{{3,}}\s*(Y|N|P|X|Yea|Nay|Aye|No|Present|\.{{3,}})(?=\s|$)")
# "Mr. Rogers (AL)................  .......  x        ............"  (x under a column)
CELL_RE = re.compile(rf"({NAME_IN_TABLE})\.*\s+({FIELD})\s+({FIELD})(?:\s+({FIELD}))?(?=\s|$)")
HEADER_RE = re.compile(r'\b(?:ayes?|yeas?)\b.*\b(?:no|noes|nays?)\b', re.I)
SEP_RE = re.compile(r'^\s*[-=_]{3,}\s*$')
BOILERPLATE_RE = re.compile(r'(?:In compliance with|Pursuant to)\b.{0,900}?\b(?:19|20)\d{2}[.,;:]?\s+', re.S)   # long bill titles push the date past 400 chars   # "...on February 12, 2025. "
QUESTION_RE = re.compile(r'^\s*(?:On|Subject|Question|Motion|Amendment Description)\s*[:.]\s*(.+?)\s*$')
ROLLCALL_RE = re.compile(r'^\s*(?:ROLL ?CALL|Roll ?[Cc]all|RECORD VOTE|Record Vote|Recorded Vote)\s*(?:NO\.|No\.|#)?\s*(\d+)')
TOTAL_RES = {   # "Yea 40." (Transportation) or "16 yeas to 23 nays" (Ways and Means prose)
    'yea': re.compile(r'\b(?:Yeas?|Ayes?)\s*[:.]?\s*(\d+)|\b(\d+)\s+(?:yeas?|ayes?)\b', re.I),
    'nay': re.compile(r'\b(?:Nays?|Noes?)\s*[:.]?\s*(\d+)|\b(\d+)\s+(?:nays?|noes?)\b', re.I),
    'present': re.compile(r'\bPresent\s*[:.]?\s*(\d+)|\b(\d+)\s+present\b', re.I),
    'not_voting': re.compile(r'\bNot [Vv]oting\s*[:.]?\s*(\d+)|\b(\d+)\s+not voting\b', re.I),
}
VOTE_MAP = {'Y': 'yea', 'YEA': 'yea', 'AYE': 'yea', 'N': 'nay', 'NAY': 'nay', 'NO': 'nay',
            'P': 'present', 'PRESENT': 'present', 'X': 'yea'}
ROLE_RE = re.compile(r'^(?:(?:Acting |Vice )?Ranking (?:Minority |Democratic )?Member|Chair(?:man|woman)?(?: Emeritus)?|Vice Chair(?:man|woman)?|'
                     r'Members? of Congress|Committee Members?|Member|Delegate|Resident Commissioner|Subcommittee .*)\s*[.,]?$', re.I)
SIGNOFF_RE = re.compile(r'^(?:Sincerely|Respectfully|Respectfully submitted|Signed)\s*,?$', re.I)
NAME_TOKEN = r"[A-Z`'\"‘“][A-Za-z'’`\"”\-.]*"
NAME_LINE_RE = re.compile(rf"^(?:Hon\.\s+)?({NAME_TOKEN}(?:\s+{NAME_TOKEN}){{0,4}}"
                          rf"(?:,\s*(?:Jr|Sr|II|III|IV|Ph\.D|M\.D|D\.D\.S|Esq)\.?)?)\s*[,.]$")
MONTH = r'(?:January|February|March|April|May|June|July|August|September|October|November|December)'
DATE_RE = re.compile(rf'({MONTH}) (\d{{1,2}}), (\d{{4}})')
MONTHS = {m: i for i, m in enumerate(MONTH.strip('(?:)').split('|'), 1)}
GRAPHIC = '[graphic omitted]'


def iso(m):
    return f'{int(m.group(3)):04d}-{MONTHS[m.group(1)]:02d}-{int(m.group(2)):02d}'


# ---------------------------------------------------------------- text

def load_text(htm_bytes):
    """-> (title, raw lines). govinfo serves one <pre> block of ~70-col fixed text; [] if there is none
    (the html edition of a new report can lag the PDF; govinfo then serves a "Page Not Found" page)."""
    s = htm_bytes.decode('utf-8', errors='replace')
    title = re.search(r'<title>(.*?)</title>', s, re.S)
    title = html.unescape(title.group(1)).strip() if title else ''
    body = re.search(r'<pre>(.*?)</pre>', s, re.S)
    if not body:
        return title, []
    text = html.unescape(body.group(1))
    text = text.replace('<bullet>', '•')
    text = re.sub(r'[\[<]GRAPHIC\(S\) NOT AVAILABLE IN TIFF FORMAT[\]>]', GRAPHIC, text)
    return title, text.split('\n')


PDF_STAMP_RE = re.compile(r'VerDate\b|\bon DSK\w+ with\b|^\s*\d{2}[\u2013-]\d{3}\s*$|E:\\|^\s*(?:Jkt|PO|Frm|Fmt|Sfmt)\s+\d{4,}')


def load_pdf_text(txt):
    """pdftotext -layout output of a GPO report PDF -> (title, lines) shaped like the html edition, so the same parser
    runs on both. Used only when govinfo has no html edition yet. Removes the typesetting stamps GPO prints in the
    margins ("VerDate ... Jkt ... Frm", the "<operator> on DSK... with REPORTS" sidebar, the jacket number), the page
    number on each form feed, de-indents the text column (the PDF text starts ~79 columns in), closes the gap in dot
    leaders ("Mr. Graves of MO ....." -> "Mr. Graves of MO....."), and puts a blank line after each centred heading
    (the PDF has none; split_sections needs one)."""
    out = []
    for line in txt.replace('\r', '').split('\n'):
        page_break = '\f' in line
        line = line.replace('\f', '').rstrip()
        if PDF_STAMP_RE.search(line) or (page_break and re.fullmatch(r'\s*\d{1,3}', line)):
            continue
        out.append(line)
    indents = [len(l) - len(l.lstrip(' ')) for l in out if l.strip()]
    base = min(indents) if indents else 0
    out = [l[base:] if l.strip() else '' for l in out]
    out = [re.sub(r' (?=\.{3,})', '', l) for l in out]
    lines = []
    for i, l in enumerate(out):
        s = l.strip()
        nxt = out[i + 1] if i + 1 < len(out) else ''
        heading = (s and nxt.strip() and _is_centered(l) and s == s.upper() and re.search('[A-Z]', s)
                   and (len(nxt) - len(nxt.lstrip(' '))) < (len(l) - len(l.lstrip(' '))))
        if heading and lines and lines[-1].strip():
            lines.append('')                        # the PDF runs body text straight into the next heading
        lines.append(l)
        if heading:
            lines.append('')
    title = next((l.strip() for l in lines if l.strip()), '')
    return title, lines


def classify(heading):
    h = re.sub(r'\s+', ' ', heading).strip().lower()
    h = re.sub(r'^(?:[ivxlc]+|\d+|[a-z])[.)]\s+', '', h)
    for typ, pat in SECTION_PATTERNS:
        if re.search(pat, h):
            return typ
    return 'other'


def _is_centered(line):
    s = line.strip()
    if not s or '....' in s or len(s) > 90:
        return False
    indent = len(line) - len(line.lstrip(' '))
    if indent < HEADING_MIN_INDENT or re.fullmatch(r'[-=_ ]+', s):
        return False
    if s[0].islower() or s.endswith((',', ';')) or re.match(r'^\(?[a-z0-9]{1,3}\)', s):
        return False
    return True


def split_sections(lines):
    """-> list of {'heading','type','start','end','lines'(body)}; the cover is type 'front'."""
    # Headings on the cover and in the table of contents are not section starts.
    first = 0
    for i, line in enumerate(lines[:2000]):           # Appropriations reports have a 300-line contents
        t = line.strip()
        if re.fullmatch(r'C\s?O\s?N\s?T\s?E\s?N\s?T\s?S', t) or t.startswith('[To accompany'):
            first = max(first, i + 1)
        elif t.lower() == 'together with':          # cover: "together with / MINORITY VIEWS"
            first = max(first, i + 3)
    sections = [{'heading': 'front', 'type': 'front', 'start': 0}]
    i = first
    while i < len(lines):
        line = lines[i]
        prev_blank = i == 0 or not lines[i - 1].strip()
        if prev_blank and _is_centered(line):
            heading = line.strip()
            j = i + 1
            while j < len(lines) and _is_centered(lines[j]) and classify(heading) == 'other':
                heading += ' ' + lines[j].strip()
                j += 1
            typ = classify(heading)
            if typ != 'other' and (j >= len(lines) or not lines[j].strip() or typ in VIEWS_TYPES):
                sections[-1]['end'] = i
                sections.append({'heading': heading, 'type': typ, 'start': i, 'body_start': j})
                i = j
                continue
        i += 1
    sections[-1]['end'] = len(lines)
    for s in sections:
        s['lines'] = lines[s.get('body_start', s['start']):s['end']]
    # Views come last in a report, and their sub-headings ("OVERSIGHT AND ACCOUNTABILITY WINS") can look
    # like rule-XIII headings. A views section with real text absorbs what follows it, up to the next
    # views heading. A bare contents label ("ADDITIONAL VIEWS", a few chars) absorbs nothing.
    merged = []
    for s in sections:
        prev = merged[-1] if merged else None
        if prev and prev['type'] in VIEWS_TYPES and s['type'] in ABSORBABLE \
                and sum(len(l.strip()) for l in prev['lines']) >= 300:
            prev['lines'] = prev['lines'] + ['', ' ' * 10 + s['heading'], ''] + s['lines']
            prev['end'] = s['end']
            continue
        merged.append(s)
    sections = merged
    # Views sections end at their signature block; the bill text GPO appends after it is noise.
    for s in sections:
        if s['type'] in VIEWS_TYPES:
            nxt = next_document_start(s['lines'])
            if nxt:
                s['lines'] = s['lines'][:nxt]
            cut = signature_end(s['lines'])
            if cut:
                s['lines'] = s['lines'][:cut]
    return sections


def unwrap(lines):
    """Fixed-width lines -> paragraphs. A 4-space indent starts a paragraph; blank lines end one."""
    paras, cur = [], []

    def flush():
        if cur:
            paras.append(' '.join(cur))
            cur.clear()

    for line in lines:
        s = line.rstrip()
        if not s.strip() or SEP_RE.match(s):
            flush()
            continue
        indent = len(s) - len(s.lstrip(' '))
        if indent >= 4 or re.match(r'^\s*(?:•|SEC\.|Sec\.|\([a-z0-9]+\))', s):
            flush()
        t = s.strip()
        if cur and cur[-1].endswith('-') and not cur[-1].endswith('--') and t[:1].islower():
            # GPO's html edition is reflowed text: a hyphen at a line end is a real hyphen ("one-" / "sided" ->
            # "one-sided"), not a typesetter's break. Of 7,804 such joins in the 119th only ~60 even looked like split
            # words, and those were compounds too ("pre-dispute"). Until Oct 30 the hyphen was dropped ("onesided").
            cur[-1] = cur[-1] + t
        else:
            cur.append(t)
    flush()
    return paras


# ---------------------------------------------------------------- committee votes

def _header_order(s):
    pos = []
    for key, pat in (('yea', r'\b(?:ayes?|yeas?)\b'), ('nay', r'\b(?:no|noes|nays?)\b'),
                     ('present', r'\bpresent\b'), ('not_voting', r'\bnot voting\b')):
        m = re.search(pat, s, re.I)
        if m:
            pos.append((m.start(), key))
    return [k for _, k in sorted(pos)]


def parse_vote_blocks(lines):
    """-> list of {'question','rollcall','totals','votes':[(surface, vote)],'mode','missed','checksum'}"""
    blocks, cur, para, prev_para = [], None, [], []

    def new_block(question=None):
        b = {'question': question, 'rollcall': None, 'totals': {}, 'votes': [], 'order': None, 'mode': None, 'missed': 0}
        blocks.append(b)
        return b

    def para_text(src):
        """The paragraph before a vote table, as the question. Committees such as Ways and Means open it with the
        rules boilerplate ("In compliance with the Rules of the House ..., the following statement is made concerning
        the vote ... on February 12, 2025.") and state the actual question last ("The vote on the amendment offered by
        Mr. Thompson ... was not agreed to"); drop the boilerplate so the question survives the length cap."""
        text = re.sub(r'\s+', ' ', ' '.join(p.strip() for p in src))
        m = BOILERPLATE_RE.match(text)
        if m and len(text) > m.end():
            text = text[m.end():]
        return text[:600] or None

    for line in lines:
        s = line.strip()
        if not s:
            if para:
                prev_para = para
            para = []
            continue
        if SEP_RE.match(s):
            continue
        q = QUESTION_RE.match(line)
        rc = ROLLCALL_RE.match(line)
        if rc or (q and (cur is None or cur['votes'])):
            cur = new_block(q.group(1).rstrip('.') if q else None)
            if rc:
                cur['rollcall'] = int(rc.group(1))
            para = []
            continue
        if q and cur is not None and cur['question'] is None:
            cur['question'] = q.group(1).rstrip('.')
            continue
        # column header: "Member   Aye   No   Present   Member   Aye   No   Present"
        if HEADER_RE.search(s) and len(re.findall(r'\s{3,}', line)) >= 2 and not re.search(r'\d', s):
            src = para or prev_para          # the question and totals are in the paragraph before the table
            if cur is None or cur['votes']:
                cur = new_block(para_text(src))
                for k, rx in TOTAL_RES.items():
                    m = rx.search(' '.join(p.strip() for p in src))
                    if m:
                        cur['totals'][k] = int(m.group(1) or m.group(2))
            elif cur['question'] is None:
                cur['question'] = para_text(src)
            cur['order'] = _header_order(s) or ['yea', 'nay', 'present']
            cur['mode'] = 'columns'
            para = []
            continue
        cells = CELL_RE.findall(line)
        if cells:
            if cur is None:
                cur = new_block()
            order = cur['order'] or ['yea', 'nay', 'present']
            for surface, *fields in cells:
                fields = [f for f in fields if f]
                marks = [i for i, f in enumerate(fields) if f.lower() == 'x']
                vote = order[marks[0]] if marks and marks[0] < len(order) else 'not_voting'
                cur['votes'].append((re.sub(r'\s+', ' ', surface).strip(), vote))
            cur['mode'] = cur['mode'] or 'columns'
            cur['missed'] += max(0, len(re.findall(rf'\b{TITLE}\.\s', line)) - len(cells))
            continue
        rows = ROW_RE.findall(line)
        if rows:
            if cur is None:
                cur = new_block()
            for surface, v in rows:
                vote = 'not_voting' if v.startswith('.') else VOTE_MAP.get(v.upper(), v.lower())
                cur['votes'].append((re.sub(r'\s+', ' ', surface).strip(), vote))
            cur['mode'] = cur['mode'] or 'leader'
            cur['missed'] += max(0, len(re.findall(rf'\b{TITLE}\.\s', line)) - len(rows))
            continue
        if cur is not None and not cur['votes']:
            for k, rx in TOTAL_RES.items():
                m = rx.search(line)
                if m and k not in cur['totals']:
                    cur['totals'][k] = int(m.group(1) or m.group(2))
        para.append(line)
    for b in blocks:
        if b['votes'] and b['totals']:
            counts = {}
            for _, v in b['votes']:
                counts[v] = counts.get(v, 0) + 1
            b['checksum'] = all(counts.get(k, 0) == n for k, n in b['totals'].items() if k in ('yea', 'nay'))
        else:
            b['checksum'] = None
    return [b for b in blocks if b['votes']]


def vote_date(lines):
    """'The Committee considered H.R. 1382 on February 26, 2025' / 'On June 30, 2026, the Committee ...'"""
    text = ' '.join(unwrap(lines))
    m = re.search(rf'(?:considered|met in open session|met|marked up|ordered|convened).{{0,120}}?\bon ({MONTH} \d{{1,2}}, \d{{4}})', text)
    if m:
        return iso(DATE_RE.search(m.group(1)))
    m = re.search(rf'On ({MONTH} \d{{1,2}}, \d{{4}}), the (?:Full )?(?:Committee|Subcommittee)', text)
    return iso(DATE_RE.search(m.group(1))) if m else None


def votes_status(lines):
    """What a vote section without a parsable table contains."""
    text = ' '.join(unwrap(lines))
    if GRAPHIC in text:
        return 'graphic_only'
    if re.search(r'voice vote|unanimous consent|no recorded votes|were no record(?:ed)? votes|without objection', text, re.I):
        return 'voice_vote'
    return 'summary_only'


# ---------------------------------------------------------------- views

CBO_ROLE_RE = re.compile(r'^(?:Director|Deputy Director|Acting Director)\.?$')


def _cbo_zone(lines):
    """Line indexes that belong to a CBO letter's signature ("Sincerely, Phillip L. Swagel, Director.")."""
    zone = set()
    for i, line in enumerate(lines):
        if CBO_ROLE_RE.match(line.strip()):
            zone.update(range(max(0, i - 6), i + 1))
    return zone


def _name_line(line):
    """A signature line: indented >= 16, Title Case, ends with , or . and is not a role or sign-off."""
    s = line.strip()
    indent = len(line) - len(line.lstrip(' '))
    if indent < 16 or not s or s.isupper() or ROLE_RE.match(s) or SIGNOFF_RE.match(s):
        return None
    m = NAME_LINE_RE.match(s)
    return m.group(1) if m and len(m.group(1).split()) <= 5 else None


LETTERHEAD_RE = re.compile(r'^\s{8,}(?:U\.S\. )?(?:House of Representatives|Committee on [A-Z][A-Za-z ,&\'-]+|'
                           r'Congress of the United States),?\s*$')
LETTER_DATE_RE = re.compile(rf'^\s{{8,}}Washington,? DC,?\s+{MONTH} \d{{1,2}}, \d{{4}}\.?\s*$')
LETTER_OPEN_RE = re.compile(r'^\s*(?:Hon\. [A-Z]|Dear (?:Mr\.|Ms\.|Mrs\.|Madam|Chairman|Chairwoman|Chair|Ranking|Colleague))')


def next_document_start(lines):
    """Compilation reports (H. Rept. 119-106 Books 1-2, the reconciliation bill; 119-59, oversight plans) print each
    committee's submission back to back, so a views section runs straight into the next committee's transmittal letter
    ("Committee on Armed Services, / House of Representatives, / Washington, DC, May 5, 2025. / Hon. Jodey C. Arrington,
    ... Sincerely, Mike Rogers, Chairman."). Without a cut the chairman becomes the 'signer' of the Democrats' views
    (58 records in Book 1 before Oct 30). -> index of the first letterhead / addressee / 'Dear Chairman' line that comes
    after a signature block, else None."""
    seen_sig, names_run, zone = False, 0, _cbo_zone(lines)
    for i, line in enumerate(lines):
        s = line.strip()
        if not s:
            names_run = 0
            continue
        if i in zone:
            continue
        if seen_sig and (LETTERHEAD_RE.match(line) or LETTER_DATE_RE.match(line) or LETTER_OPEN_RE.match(line)):
            return i
        indent = len(line) - len(line.lstrip(' '))
        if SIGNOFF_RE.match(s) or (indent >= 16 and ROLE_RE.match(s)):
            seen_sig = True
        elif _name_line(line):
            names_run += 1
            seen_sig = seen_sig or names_run >= 2
        else:
            names_run = 0
    return None


def signature_end(lines):
    """Index just past the signature block, or None."""
    last, zone = None, _cbo_zone(lines)
    for i, line in enumerate(lines):
        if i in zone:
            continue
        s = line.strip()
        indent = len(line) - len(line.lstrip(' '))
        if SIGNOFF_RE.match(s) or (indent >= 16 and (ROLE_RE.match(s) or _name_line(line))):
            last = i
    return last + 1 if last is not None else None


def parse_signatures(lines):
    """Names in the signature block of a views section (full names, as printed)."""
    zone = _cbo_zone(lines)
    signoff = None
    for i, line in enumerate(lines):
        if SIGNOFF_RE.match(line.strip()) and i not in zone:
            signoff = i
    if signoff is not None:
        return [n for n in (_name_line(l) for i, l in enumerate(lines) if i > signoff and i not in zone) if n]
    names = []                      # no sign-off: the trailing run of name / role lines
    for line in reversed([l for l in lines if l.strip()]):
        if ROLE_RE.match(line.strip()):
            continue
        n = _name_line(line)
        if not n:
            break
        names.append(n)
    return list(reversed(names))


def views_signers_from_heading(heading):
    """'DISSENTING VIEWS OF HON. JOHN DOE AND HON. JANE ROE' -> ['John Doe', 'Jane Roe']"""
    m = re.search(r'views of ((?:hon\.|rep\.|representative|mr\.|ms\.|mrs\.|congress(?:man|woman)).+)$', heading, re.I)
    if not m:
        return []
    names = re.split(r',|\band\b', m.group(1))
    return [re.sub(r'^(?:Hon\.|Rep\.|Representative|Mr\.|Ms\.|Mrs\.|Congressman|Congresswoman)\s*', '', n.strip(), flags=re.I).title()
            for n in names if n.strip()]


# ---------------------------------------------------------------- legislative history

NTOK = r"(?:[A-Z][A-Za-z'’]+(?:-[A-Z][A-Za-z'’]+)?|[A-Z]\.)"   # token or initial; "King-Hinds" yes, "Jayapal--failed" no
NAME = rf"{NTOK}(?: {NTOK}){{0,3}}(?: of [A-Z][a-z]+(?: [A-Z][a-z]+)?)?"
HONORIFIC = r'(?:Rep(?:resentative)?s?\.?|Congress(?:man|woman)|Mr\.|Ms\.|Mrs\.|Del(?:egate|\.)|Dr\.)'
SPONSOR_RES = [
    # "was introduced on February 14, 2025, by Rep. Jared Huffman"
    re.compile(rf'introduced(?: in the (?:U\.S\. |United States )?House(?: of Representatives)?)?'
               rf'(?: on (?P<date>{MONTH} \d{{1,2}}, \d{{4}}))?,?\s+by\s+{HONORIFIC}\s+(?P<name>{NAME})'),
    # "On June 18, 2026, Representative Wagner introduced H.R. 9329"
    re.compile(rf'(?:On (?P<date>{MONTH} \d{{1,2}}, \d{{4}}),\s+)?{HONORIFIC}\s+(?P<name>{NAME})'
               rf'(?:\s*\([DRI]-[A-Z]{{2}}(?:-\d+)?\))?\s+introduced\b'),
]
OFFER_RE = re.compile(
    rf'(?i:amendment|substitute|motion)[^•\n]{{0,80}}?(?i:offered by) (?:{HONORIFIC}|Ranking Member|Chair(?:man|woman)?)\s+'
    rf"({NTOK}(?: {NTOK}){{0,2}}(?: of [A-Z][a-z]+(?: [A-Z][a-z]+)?)?)")
RESULT_RE = re.compile(
    r'\b(agreed to|not agreed to|adopted|failed|withdrawn|passed|defeated|rejected)\b'
    r'(?: by (voice vote|a (?:recorded|roll ?call) vote of (\d+)[^0-9]{1,20}(\d+)|unanimous consent))?', re.I)


def parse_legislative_history(lines, bill_label=None):
    """bill_label ("H.R. 9329") prefers the sentence about this bill over one about a prior Congress's version."""
    text = ' '.join(unwrap(lines))
    out = {'sponsor_surface': None, 'introduced_date': None, 'amendments': [], 'considered_date': vote_date(lines)}
    scopes = [text]
    if bill_label:
        scopes = [sent for sent in re.split(r'(?<=[a-z0-9)])\. ', text) if bill_label in sent] + [text]
    for rx, scope in ((rx, sc) for sc in scopes for rx in SPONSOR_RES):
        m = rx.search(scope)
        if m:
            out['sponsor_surface'] = m.group('name').rstrip('.')
            if m.group('date'):
                out['introduced_date'] = iso(DATE_RE.search(m.group('date')))
            break
    for m in OFFER_RE.finditer(text):
        window = text[m.end():m.end() + 4000].split('•')[0]
        r = RESULT_RE.search(window)
        result = r.group(1).lower() if r else None
        out['amendments'].append({
            'surface': m.group(1).rstrip('.'),
            'result': ('agreed' if result in ('agreed to', 'adopted', 'passed') else
                       'failed' if result in ('not agreed to', 'failed', 'defeated', 'rejected') else result),
            'by': ((r.group(2) or '').split(' of ')[0] or None) if r else None,
            'yeas': int(r.group(3)) if r and r.group(3) else None,
            'nays': int(r.group(4)) if r and r.group(4) else None,
        })
    return out


def committee_action(front_lines):
    """'reports favorably thereon with an amendment ...' -> 'reported favorably with amendment'"""
    text = ' '.join(unwrap(front_lines))
    m = re.search(r'reports? (favorably|unfavorably|adversely)(.{0,200}?)\bdo (?:not )?pass', text)
    if not m:
        if re.search(r'ADVERSE\s+REPORT|reports? adversely|adversely report', text):
            return 'reported adversely'
        return None
    tail = m.group(2)
    amend = ('without amendment' if 'without amendment' in tail
             else 'with amendment' if re.search(r'with (?:an )?amendments?', tail) else '')
    return f'reported {m.group(1)} {amend}'.strip()
