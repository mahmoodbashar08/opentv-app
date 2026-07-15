#!/usr/bin/env python3
"""Fetch movie metadata from TMDB into src/data/movie-metadata.json.

Covers watched + watchlist movies: runtime, genres, release date, synopsis,
rating, vote count, backdrop, top cast, and region providers.
Run from mobile/:  python3 scripts/fetch-movie-metadata.py
"""
import concurrent.futures as cf
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOKEN = (ROOT / 'scripts' / '.tmdb-token').read_text().strip()
IMG = 'https://image.tmdb.org/t/p'


def get(path):
    req = urllib.request.Request(
        f'https://api.themoviedb.org/3{path}',
        headers={'Authorization': f'Bearer {TOKEN}'},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


seed = json.load(open(ROOT / 'src/data/seed.json'))
movies = [m for m in seed['movies'] + seed.get('watchlist', []) if m.get('tmdbId')]
print(f'{len(movies)} movies to fetch')


def fetch(mv):
    tid = mv['tmdbId']
    try:
        d = get(f'/movie/{tid}?append_to_response=credits,watch%2Fproviders')
        cast = []
        for c in (d.get('credits') or {}).get('cast') or []:
            cast.append({
                'name': c.get('name'),
                'character': c.get('character'),
                'photo': f"{IMG}/w185{c['profile_path']}" if c.get('profile_path') else None,
            })
            if len(cast) == 8:
                break
        prov_regions = (d.get('watch/providers') or {}).get('results') or {}
        providers = []
        for region in ('IQ', 'SA', 'AE', 'US'):
            flat = (prov_regions.get(region) or {}).get('flatrate') or []
            if flat:
                providers = [
                    {'name': p.get('provider_name'), 'logo': f"{IMG}/w92{p['logo_path']}" if p.get('logo_path') else None}
                    for p in flat[:4]
                ]
                break
        return tid, {
            'runtime': d.get('runtime') or None,
            'genres': [g['name'] for g in d.get('genres') or []][:4],
            'release': d.get('release_date') or None,
            'overview': d.get('overview') or None,
            'rating': round(d.get('vote_average') or 0, 1),
            'votes': d.get('vote_count') or 0,
            'backdrop': f"{IMG}/w780{d['backdrop_path']}" if d.get('backdrop_path') else None,
            'cast': cast,
            'providers': providers,
        }
    except Exception:
        return tid, None


out = {}
with cf.ThreadPoolExecutor(8) as ex:
    for tid, meta in ex.map(fetch, movies):
        if meta:
            out[str(tid)] = meta

Path(ROOT / 'src/data/movie-metadata.json').write_text(json.dumps(out, ensure_ascii=False))
print(f'resolved {len(out)}/{len(movies)} · {(ROOT / "src/data/movie-metadata.json").stat().st_size // 1024} KB')
