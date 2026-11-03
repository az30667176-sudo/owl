"""People, committees and name resolution.

Sources (cache/roster/): unitedstates/congress-legislators
  legislators-current.yaml + legislators-historical.yaml -> every House member with a 119th term
  committee-membership-current.yaml + committees-current.yaml -> seats (parent committees only)

Name resolution turns a surface form from report text ("Mr. Garcia of CA", "Scott H. Peters")
into a bioguide id. Candidate pool, narrowest first: the committee's current members, then every
member active on the given date, then every 119th member. A state suffix always filters.
"""
import json
import pathlib
import re
import unicodedata
from dataclasses import dataclass, asdict

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
R = ROOT / 'cache' / 'roster'
C119_START, C119_END = '2025-01-03', '2027-01-03'

STATES = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA', 'Colorado': 'CO',
    'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
    'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA',
    'Maine': 'ME', 'Maryland': 'MD', 'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN',
    'Mississippi': 'MS', 'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
    'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC',
    'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA',
    'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX',
    'Utah': 'UT', 'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
    'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC', 'Puerto Rico': 'PR',
    'Virgin Islands': 'VI', 'Guam': 'GU', 'American Samoa': 'AS', 'Northern Mariana Islands': 'MP',
}
PARTY = {'Democrat': 'D', 'Republican': 'R', 'Independent': 'I'}
TITLE_RE = re.compile(
    r'^(?:Mr|Ms|Mrs|Dr|Miss|Mx|Hon|Rep|Representative|Congressman|Congresswoman|Delegate|Del|'
    r'Chairman|Chairwoman|Chair|Ranking Member|Resident Commissioner)\.?\s+', re.I)


def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z]', '', s.lower())


@dataclass
class Person:
    bioguide: str
    first: str
    last: str
    nickname: str
    name_full: str
    state: str
    district: int
    party: str
    gender: str
    is_current: bool
    term_start: str
    term_end: str
    chamber: str = 'house'

    @property
    def label(self):
        d = f'{self.district:02d}' if self.district else 'AL'
        return f'{self.name_full} ({self.party}-{self.state}-{d})'


def _load_people_from_yaml():
    people = {}
    for fname, current in (('legislators-historical.yaml', False), ('legislators-current.yaml', True)):
        for p in yaml.safe_load(open(R / fname, encoding='utf-8')):
            terms = [t for t in p['terms']
                     if t['type'] in ('rep', 'del', 'res') and t['start'] < C119_END and t['end'] > C119_START]
            if not terms:
                continue
            t = terms[-1]
            n = p['name']
            people[p['id']['bioguide']] = Person(
                bioguide=p['id']['bioguide'], first=n.get('first', ''), last=n.get('last', ''),
                nickname=n.get('nickname', ''), name_full=n.get('official_full') or f"{n.get('first','')} {n.get('last','')}",
                state=t['state'], district=int(t.get('district') or 0), party=PARTY.get(t.get('party'), t.get('party', '')),
                gender=p.get('bio', {}).get('gender', ''), is_current=current,
                term_start=max(t['start'], C119_START), term_end=min(t['end'], C119_END))
    return people


def load_people():
    """Cached as house119.json because the historical yaml is 9 MB."""
    cache = R / 'house119.json'
    if cache.exists():
        return {k: Person(**v) for k, v in json.load(open(cache)).items()}
    people = _load_people_from_yaml()
    json.dump({k: asdict(v) for k, v in people.items()}, open(cache, 'w'), indent=0)
    return people


def load_committees():
    """{'HSPW': {'code', 'authority_id', 'name', 'members': [{'bioguide','role','rank','party'}]}}"""
    membership = yaml.safe_load(open(R / 'committee-membership-current.yaml', encoding='utf-8'))
    out = {}
    for c in yaml.safe_load(open(R / 'committees-current.yaml', encoding='utf-8')):
        if c.get('type') != 'house':
            continue
        code = c['thomas_id']
        members = []
        for m in membership.get(code, []):
            title = (m.get('title') or '').lower()
            role = 'chair' if title.startswith('chair') else 'ranking' if 'ranking' in title else 'member'
            members.append({'bioguide': m['bioguide'], 'role': role, 'rank': m.get('rank'), 'party': m.get('party')})
        out[code] = {'code': code, 'authority_id': code.lower() + '00', 'name': c['name'], 'members': members}
    return out


def authority_to_code(authority_id):
    """mods 'hspw00' -> 'HSPW'"""
    return authority_id[:4].upper()


def parse_surface(surface):
    """'Mr. Garcia of CA' -> ('Garcia', 'CA'); 'Mr. Larsen of Washington' -> ('Larsen', 'WA')"""
    s = surface.strip().rstrip('.,').strip()
    gender = 'M' if re.match(r'Mr\.?\s', s) else 'F' if re.match(r'(?:Mrs|Ms|Miss)\.?\s', s) else None
    s = TITLE_RE.sub('', s)
    state = None
    m = re.search(r'\s*\(([A-Z]{2})\)$', s)              # "Mr. Rogers (AL)"
    if m:
        state, s = m.group(1), s[:m.start()]
    m = re.search(r'\s+of\s+([A-Z]{2}|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)$', s)   # "Mr. Garcia of CA"
    if m:
        tok = m.group(1)
        st = tok if len(tok) == 2 else STATES.get(tok)
        if st:
            state, s = st, s[:m.start()]
    return s.strip(), state, gender


class Resolver:
    def __init__(self, people, committees):
        self.people = people
        self.committees = committees
        self.by_last = {}
        for p in people.values():
            self.by_last.setdefault(norm(p.last), []).append(p)

    SUFFIXES = {'jr', 'sr', 'ii', 'iii', 'iv'}

    def _match_name(self, name, pool):
        """-> (candidates, first_name_matched). A printed first name that matches no candidate in this pool is a
        signal to look in a wider pool before settling ("Troy A. Carter" in a Budget-committee pool that only
        holds Buddy Carter), see resolve()."""
        toks = re.sub(r"[`'’\"]+", ' ', name).replace(',', ' ').split()
        toks = [t for t in toks if t and t.rstrip('.').lower() not in self.SUFFIXES]
        for k in (1, 2, 3):
            if k > len(toks):
                break
            last = norm(''.join(toks[-k:]))
            cands = [p for p in pool if norm(p.last) == last]
            if not cands:
                continue
            prefix = [t for t in toks[:-k] if not re.fullmatch(r'[A-Z]\.?', t)]
            if prefix:
                first = norm(prefix[0])
                narrowed = [p for p in cands
                            if first in (norm(p.first), norm(p.nickname), norm(p.name_full.split()[0]))]
                if narrowed:
                    return narrowed, True
                return cands, False
            return cands, None
        return [], None

    def resolve(self, surface, committee_code=None, date=None):
        """-> (Person|None, status) with status in ok | ambiguous | unresolved"""
        name, state, gender = parse_surface(surface)
        if not name:
            return None, 'unresolved'
        pools = []
        if committee_code and committee_code in self.committees:
            pools.append([self.people[m['bioguide']] for m in self.committees[committee_code]['members']
                          if m['bioguide'] in self.people])
        if date:
            pools.append([p for p in self.people.values() if p.term_start <= date < p.term_end])
        pools.append(list(self.people.values()))
        fallback = None                              # last-name-only match whose first name did not agree
        for pool in pools:
            if state:
                pool = [p for p in pool if p.state == state]
            cands, first_ok = self._match_name(name, pool)
            if len(cands) > 1 and gender:            # "Mr. Miller" vs "Mrs. Miller" on Agriculture
                cands = [p for p in cands if p.gender == gender] or cands
            if first_ok is False:                    # keep looking; use it only if no pool has a first-name match
                if fallback is None and cands:
                    fallback = cands
                continue
            if len(cands) == 1:
                return cands[0], 'ok'
            if len(cands) > 1:
                current = [p for p in cands if p.is_current]
                if len(current) == 1 and not date:
                    return current[0], 'ok'
                return None, 'ambiguous'
        if fallback:
            return (fallback[0], 'ok') if len(fallback) == 1 else (None, 'ambiguous')
        return None, 'unresolved'


if __name__ == '__main__':
    people = load_people()
    committees = load_committees()
    ca = [p for p in people.values() if p.state == 'CA']
    print(len(people), 'House members with a 119th term;', len(ca), 'from CA;',
          sum(p.is_current for p in ca), 'current')
    r = Resolver(people, committees)
    for s in ('Mr. Garcia of CA', 'Mr. Garcia of IL', 'Mr. Huffman', 'Mr. LaMalfa', 'Scott H. Peters',
              "Robert C. ``Bobby'' Scott", 'Mr. Johnson of GA', 'Ms. McDonald Rivet', 'Mr. Larsen of Washington', 'Mr. Scott'):
        p, st = r.resolve(s, 'HSPW', '2025-02-26')
        print(f'{s:28} -> {st:10} {p.label if p else ""}')
