#!/usr/bin/env python3
"""Build the real movies dataset: watch dates from the GDPR tracking file,
canonical titles + posters from TMDB search. Updates seed.json movies and
show posterUrls. Run from mobile/:  python3 scripts/fetch-movies.py
"""
import concurrent.futures as cf
import csv
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GDPR = ROOT.parent / 'gdpr-data'
TOKEN = (ROOT / 'scripts' / '.tmdb-token').read_text().strip()
IMG = 'https://image.tmdb.org/t/p'


def get(path):
    req = urllib.request.Request(
        f'https://api.themoviedb.org/3{path}',
        headers={'Authorization': f'Bearer {TOKEN}'},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


# ---- movies with real watch dates from the v1 tracking file ------------------
movies = {}
for r in csv.DictReader(open(GDPR / 'tracking-prod-records.csv')):
    name = (r.get('movie_name') or '').strip()
    if not name:
        continue
    date = (r.get('watch_date') or r.get('created_at') or '')[:19]
    cur = movies.get(name)
    if cur is None or date > cur['watchedAt']:
        rt = r.get('runtime') or ''
        movies[name] = {
            'originalName': name,
            'watchedAt': date,
            'runtime': int(rt) if rt.isdigit() else None,  # seconds
        }

print(f'movies with watch dates: {len(movies)}')

# ---- your star ratings, keyed by the same original names ---------------------
stars = {}
for r in csv.DictReader(open(GDPR / 'ratings-live-votes.csv')):
    name = (r.get('movie_name') or '').strip()
    m = re.search(r'-(\d+)$', r.get('vote_key') or '')
    if name and m and 1 <= int(m.group(1)) <= 5:
        stars[name] = int(m.group(1))

# ---- canonical titles + posters from TMDB search ------------------------------
def resolve(item):
    q = urllib.parse.quote(item['originalName'])
    try:
        res = get(f'/search/movie?query={q}').get('results') or []
        if not res:
            return item, None
        # prefer exact title matches (case-insensitive) — "Up" must not
        # resolve to "Balls Up"; among exact matches take the most-voted
        want = item['originalName'].strip().lower()
        exact = [
            r for r in res
            if (r.get('title') or '').strip().lower() == want
            or (r.get('original_title') or '').strip().lower() == want
        ]
        pool = exact if exact else res
        best = max(pool, key=lambda r: r.get('vote_count') or 0)
        return item, {
            'name': best.get('title') or item['originalName'],
            'poster': f"{IMG}/w342{best['poster_path']}" if best.get('poster_path') else None,
            'year': (best.get('release_date') or '')[:4] or None,
            'tmdbId': best.get('id'),
        }
    except Exception:
        return item, None


resolved = []
with cf.ThreadPoolExecutor(8) as ex:
    for item, hit in ex.map(resolve, movies.values()):
        entry = {
            'name': (hit or {}).get('name', item['originalName']),
            'originalName': item['originalName'],
            'stars': stars.get(item['originalName']),
            'poster': (hit or {}).get('poster'),
            'year': (hit or {}).get('year'),
            'tmdbId': (hit or {}).get('tmdbId'),
            'watchedAt': item['watchedAt'],
            'runtime': item['runtime'],
        }
        resolved.append(entry)

resolved.sort(key=lambda m: m['watchedAt'], reverse=True)
with_poster = sum(1 for m in resolved if m['poster'])
print(f'resolved posters: {with_poster}/{len(resolved)}')

# ---- update seed: movies + canonical show posters -----------------------------
seed = json.load(open(ROOT / 'src/data/seed.json'))
meta = json.load(open(ROOT / 'src/data/metadata.json'))

seed['movies'] = resolved
for s in seed['shows']:
    m = meta.get(str(s['tvdbId']))
    if m and m.get('poster'):
        s['posterUrl'] = m['poster']

minutes = sum((m['runtime'] or 0) for m in resolved) // 60
seed['profile']['movieMinutes'] = minutes
print(f'movie time: {minutes} min = {minutes // (60*24)}d {(minutes // 60) % 24}h')

json.dump(seed, open(ROOT / 'src/data/seed.json', 'w'), indent=2, ensure_ascii=False)
print('seed.json updated · first 5 by last watched:', ', '.join(m['name'] for m in resolved[:5]))
