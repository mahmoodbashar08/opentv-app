#!/usr/bin/env python3
"""Generate mobile/src/data/seed.json from the TV Time GDPR export.

Run from mobile/:  python3 scripts/generate-seed.py
Temporary bridge until the Phase 1 SQLite importer replaces it.
"""
import csv
import json
import re
from pathlib import Path

GDPR = Path(__file__).resolve().parents[2] / 'gdpr-data'
OUT = Path(__file__).resolve().parents[1] / 'src' / 'data' / 'seed.json'

# rescued comment images (assets/comments/), keyed by TV Time image uuid
IMG_BY_UUID = {
    '18d22a76-56be-4f0c-accf-1a80c9e2f2d8': 'spiderman-nwh.jpeg',
    '4c2b1946-0b10-4817-8802-d78688d2cd13': 'toy-story-5.jpeg',
}


def read(name):
    with open(GDPR / name, newline='') as f:
        yield from csv.DictReader(f)


# ---- shows -----------------------------------------------------------------
archived = {r['tv_show_id']: r['archived'] == '1' for r in read('followed_tv_show.csv')}

shows = [
    {
        'tvdbId': int(r['tv_show_id']),
        'name': r['tv_show_name'],
        'episodesSeen': int(r['nb_episodes_seen'] or 0),
        'followed': r['is_followed'] == '1',
        'favorited': r['is_favorited'] == '1',
        'archived': archived.get(r['tv_show_id'], False),
    }
    for r in read('user_tv_show_data.csv')
]
shows.sort(key=lambda s: -s['episodesSeen'])

# ---- movies (from your ratings, emotion votes and comments) ----------------
movies = {}
for r in read('ratings-live-votes.csv'):
    name = (r.get('movie_name') or '').strip()
    if name and r.get('episode_id') == '0':
        stars = None
        m = re.search(r'-(\d+)$', r.get('vote_key') or '')
        if m and 1 <= int(m.group(1)) <= 5:
            stars = int(m.group(1))
        movies.setdefault(name, {'name': name, 'stars': None})
        if stars:
            movies[name]['stars'] = stars

for r in read('emotions-live-votes.csv'):
    name = (r.get('movie_name') or '').strip()
    if name and r.get('episode_id') == '0':
        movies.setdefault(name, {'name': name, 'stars': None})

# ---- comments ---------------------------------------------------------------
comments = []
for r in read('comments-prod-comments.csv'):
    if (r.get('type') or '') not in ('comment', 'reply'):
        continue
    img = None
    m = re.search(r'/([0-9a-f-]{36})\.jpeg', r.get('image') or '')
    if m:
        img = IMG_BY_UUID.get(m.group(1))
    entity = r.get('movie_name') or r.get('series_name') or ''
    if r.get('movie_name'):
        movies.setdefault(entity, {'name': entity, 'stars': None})
    comments.append({
        'type': r['type'],
        'entity': entity,
        'text': r.get('text') or '',
        'date': (r.get('created_at') or '')[:10],
        'likes': int(r.get('like_count') or 0),
        'replies': int(r.get('reply_count') or 0),
        'image': img,
    })

for r in read('episode_comment.csv'):
    comments.append({
        'type': 'comment',
        'entity': f"{r['tv_show_name']} S{r['episode_season_number'].zfill(2)}",
        'text': r.get('comment') or '',
        'date': (r.get('created_at') or '')[:10],
        'likes': int(r.get('nb_likes') or 0),
        'replies': 0,
        'image': 'aot-meme.gif',
    })

comments.sort(key=lambda c: c['date'], reverse=True)

# ---- seed -------------------------------------------------------------------
seed = {
    'profile': {
        'username': 'mahmoodbashar08',
        'since': '2021-05-21',
        # as displayed in the TV Time profile; recomputed by the Phase 1 importer
        'clock': {'months': 0, 'days': 25, 'hours': 14},
        'episodesWatched': 1096,
        'following': 10,
        'followers': 8,
        'comments': len(comments),
    },
    'lists': [{'name': 'avengers', 'movieCount': 22}],
    'comments': comments,
    'movies': sorted(movies.values(), key=lambda m: m['name']),
    'shows': shows,
}

OUT.write_text(json.dumps(seed, indent=2, ensure_ascii=False))
print(f"seed: {len(shows)} shows · {len(movies)} movies · {len(comments)} comments")
print('sample movies:', ', '.join(list(movies)[:8]))
