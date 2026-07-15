#!/usr/bin/env python3
"""Resolve lists + favorites from the GDPR export into seed.json.

- avengers list: item uuids → names via ratings/emotions/comments/tracking
- favorite shows: ordered tvdb ids (untracked ones resolved via TMDB)
- favorite movies: item uuids → names → posters from seed.movies

Run AFTER fetch-movies.py (uses its canonical names/posters).
Run from mobile/:  python3 scripts/fetch-lists.py
"""
import csv
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GDPR = ROOT.parent / 'gdpr-data'
TOKEN = (ROOT / 'scripts' / '.tmdb-token').read_text().strip()
IMG = 'https://image.tmdb.org/t/p'


def get(path):
    req = urllib.request.Request(
        f'https://api.themoviedb.org/3{path}', headers={'Authorization': f'Bearer {TOKEN}'}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


rows = list(csv.DictReader(open(GDPR / 'lists-prod-lists.csv')))
seed = json.load(open(ROOT / 'src/data/seed.json'))

# ---- uuid → movie name from every file that has both -------------------------
uuid_name = {}
for fname, ucol in [
    ('ratings-live-votes.csv', 'uuid'),
    ('emotions-live-votes.csv', 'uuid'),
    ('comments-prod-comments.csv', 'entity_uuid'),
    ('tracking-prod-records.csv', 'uuid'),
]:
    for r in csv.DictReader(open(GDPR / fname)):
        u, n = (r.get(ucol) or '').strip(), (r.get('movie_name') or '').strip()
        if u and n:
            uuid_name[u] = n

by_original = {m['originalName']: m for m in seed['movies']}


def movie_items(uuids):
    out = []
    for u in uuids:
        n = uuid_name.get(u)
        if not n:
            continue
        m = by_original.get(n)
        out.append({'name': (m or {}).get('name', n), 'poster': (m or {}).get('poster')})
    return out


# ---- avengers list -------------------------------------------------------------
for r in rows:
    if (r.get('name') or '').strip() == 'avenger':
        uuids = re.findall(r'uuid:([0-9a-f-]{36})', r.get('objects') or '')
        seed['lists'] = [{'name': 'avengers', 'movieCount': len(uuids), 'items': movie_items(uuids)}]

# ---- favorite shows (ordered tvdb ids) ------------------------------------------
by_id = {s['tvdbId']: s for s in seed['shows']}
fav_shows = []
for r in rows:
    if (r.get('s_key') or '') == 'favorite-series':
        for tid in [int(x) for x in re.findall(r'id:(\d+) type:series', r.get('objects') or '')]:
            if tid in by_id:
                s = by_id[tid]
                fav_shows.append({'tvdbId': tid, 'name': s['name'], 'poster': s['posterUrl']})
            else:
                try:
                    found = (get(f'/find/{tid}?external_source=tvdb_id').get('tv_results') or [{}])[0]
                    fav_shows.append({
                        'tvdbId': tid,
                        'name': found.get('name') or f'Show {tid}',
                        'poster': f"{IMG}/w342{found['poster_path']}" if found.get('poster_path') else None,
                    })
                except Exception:
                    fav_shows.append({'tvdbId': tid, 'name': f'Show {tid}', 'poster': None})
seed['favoriteShows'] = fav_shows

# ---- favorite movies --------------------------------------------------------------
for r in rows:
    if (r.get('s_key') or '') == 'favorite-movies':
        uuids = re.findall(r'uuid:([0-9a-f-]{36})', r.get('objects') or '')
        seed['favoriteMovies'] = {'count': len(uuids), 'items': movie_items(uuids)}

json.dump(seed, open(ROOT / 'src/data/seed.json', 'w'), indent=2, ensure_ascii=False)
print('lists:', [i['name'] for i in seed['lists'][0]['items']][:6])
print('favorite shows:', [f['name'] for f in seed['favoriteShows']])
print('favorite movies:', [m['name'] for m in seed['favoriteMovies']['items']][:8])
