"""Where things are. The ingest code runs from two places: ../module1 next to a clone named owl/ (development) and
owl/services/ingest/govinfo/ inside the team repo (where it lands; services/ingest/ itself holds Ben's csv-to-json.mjs). Nothing else should hard-code either layout."""
import os
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]          # the ingest directory (module1/ or services/ingest/govinfo/)
CACHE = ROOT / 'cache'
STATE = ROOT / 'state'
OUT_FULL = ROOT / 'out_full'


def repo_root():
    """The OWL repo (has packages/contract/validate.mjs and data/taxonomy.json), or None when not around."""
    env = os.environ.get('OWL_REPO')
    candidates = ([pathlib.Path(env)] if env else []) + list(ROOT.parents) + [ROOT.parent / 'owl']
    for c in candidates:
        if (c / 'packages' / 'contract' / 'validate.mjs').exists():
            return c.resolve()
    return None
