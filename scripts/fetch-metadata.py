#!/usr/bin/env python3
"""Fetch show metadata from TMDB into src/data/metadata.json.

Uses the TVDB ids from the GDPR export via TMDB's /find endpoint.
Run from mobile/:  python3 scripts/fetch-metadata.py
Requires scripts/.tmdb-token (git-ignored).
"""
import concurrent.futures as cf
import json
import time
import urllib.request
from pathlib import Path

FETCHED_AT = int(time.time() * 1000)  # ms epoch, same clock the app uses
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
records = json.load(open(ROOT / 'src/data/records.json'))

# the show list: seed.json in personal builds; in public builds (empty seed)
# the current bundle itself is the authority — refresh what's already there
existing = json.load(open(ROOT / 'src/data/metadata.json'))
show_list = seed['shows'] or [{'tvdbId': int(k), 'name': v.get('name')} for k, v in existing.items()]

# seasons we need episode titles for: every (show, season) you have watches in
watched_seasons = {}
for w in records['watches']:
    watched_seasons.setdefault(w['showId'], set()).add(w['season'])


def fetch_show(s):
    tvdb = s['tvdbId']
    try:
        found = get(f'/find/{tvdb}?external_source=tvdb_id').get('tv_results') or []
        if not found:
            return tvdb, None
        tmdb_id = found[0]['id']
        d = get(f'/tv/{tmdb_id}?append_to_response=aggregate_credits,recommendations,watch%2Fproviders')

        # top cast with the character they play (aggregate = across all seasons)
        cast = []
        for c in (d.get('aggregate_credits') or {}).get('cast') or []:
            roles = c.get('roles') or []
            cast.append({
                'name': c.get('name'),
                'character': (roles[0].get('character') if roles else None),
                'photo': f"{IMG}/w185{c['profile_path']}" if c.get('profile_path') else None,
            })
            if len(cast) == 12:
                break

        # "people also watched" — TMDB recommendations
        similar = [
            {
                'tmdbId': r['id'],
                'name': r.get('name'),
                'poster': f"{IMG}/w342{r['poster_path']}" if r.get('poster_path') else None,
            }
            for r in ((d.get('recommendations') or {}).get('results') or [])[:8]
        ]

        # streaming providers: prefer the user's region, fall back westward
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

        meta = {
            'tmdbId': tmdb_id,
            'fetchedAt': FETCHED_AT,
            'name': d.get('name'),
            'poster': f"{IMG}/w342{d['poster_path']}" if d.get('poster_path') else None,
            'backdrop': f"{IMG}/w780{d['backdrop_path']}" if d.get('backdrop_path') else None,
            'year': (d.get('first_air_date') or '')[:4] or None,
            'endYear': (d.get('last_air_date') or '')[:4] or None,
            'status': d.get('status'),
            'inProduction': bool(d.get('in_production')),
            'totalEpisodes': d.get('number_of_episodes') or 0,
            'totalSeasons': d.get('number_of_seasons') or 0,
            'genres': [g['name'] for g in d.get('genres') or []][:5],
            'network': (d.get('networks') or [{}])[0].get('name'),
            'runtime': (d.get('episode_run_time') or [None])[0],
            'overview': d.get('overview') or None,
            'rating': round(d.get('vote_average') or 0, 1),
            'votes': d.get('vote_count') or 0,
            'lastAir': d.get('last_air_date'),
            'cast': cast,
            'similar': similar,
            'providers': providers,
            'seasons': {
                str(x['season_number']): {'count': x.get('episode_count') or 0, 'name': x.get('name')}
                for x in d.get('seasons') or []
                if x.get('season_number', 0) >= 0
            },
            'episodes': {},
        }
        # every season the show has, not just watched ones — a partially
        # watched show must still render its later seasons (Devil May Cry S2)
        all_seasons = sorted(
            {x['season_number'] for x in d.get('seasons') or [] if x.get('season_number', 0) >= 0}
            | watched_seasons.get(tvdb, set())
        )
        for season in all_seasons:
            try:
                sd = get(f'/tv/{tmdb_id}/season/{season}')
                for ep in sd.get('episodes') or []:
                    key = f"{season}-{ep['episode_number']}"
                    meta['episodes'][key] = {
                        'title': ep.get('name'),
                        'air': ep.get('air_date'),
                        'still': f"{IMG}/w300{ep['still_path']}" if ep.get('still_path') else None,
                        'rating': round(ep.get('vote_average') or 0, 1),
                        'overview': ep.get('overview') or None,
                    }
            except Exception:
                continue
        return tvdb, meta
    except Exception as e:
        return tvdb, None


out = {}
with cf.ThreadPoolExecutor(8) as ex:
    for tvdb, meta in ex.map(fetch_show, show_list):
        if meta:
            out[str(tvdb)] = meta

# a run that lost a big chunk of shows (rate limit, outage) must never
# replace a good bundle with a hollow one
if len(out) < max(1, int(len(show_list) * 0.9)):
    raise SystemExit(f"ABORTED: only {len(out)}/{len(show_list)} shows resolved — bundle left untouched")

Path(ROOT / 'src/data/metadata.json').write_text(json.dumps(out, ensure_ascii=False))
size = (ROOT / 'src/data/metadata.json').stat().st_size // 1024
resolved = len(out)
with_eps = sum(1 for m in out.values() if m['episodes'])
print(f"resolved {resolved}/{len(show_list)} shows · {with_eps} with episode titles · {size} KB")
missing = [s['name'] for s in show_list if str(s['tvdbId']) not in out]
if missing:
    print('unresolved:', ', '.join(missing[:10]))
