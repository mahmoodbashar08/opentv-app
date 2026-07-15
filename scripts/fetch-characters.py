#!/usr/bin/env python3
"""Fetch character art for anime shows from Jikan (MyAnimeList) into metadata.json.

TMDB only has actor photos; TV Time showed character art. MAL covers anime
(most of this library); non-anime shows keep the actor-photo fallback.
Run from mobile/:  python3 scripts/fetch-characters.py
"""
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
META = ROOT / 'src/data/metadata.json'


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'our-tv-time/1.0'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def norm(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


meta = json.loads(META.read_text())
targets = [(tvdb, m) for tvdb, m in meta.items() if 'Animation' in (m.get('genres') or [])]
print(f'{len(targets)} animated shows to try')

hits = 0
for tvdb, m in targets:
    name = m.get('name') or ''
    try:
        q = urllib.parse.quote(name)
        res = get(f'https://api.jikan.moe/v4/anime?q={q}&limit=5')
        time.sleep(0.7)
        best = None
        want = norm(name)
        for cand in res.get('data') or []:
            titles = [t.get('title') for t in cand.get('titles') or []]
            if any(norm(t) == want or (want and want in norm(t)) or (norm(t) and norm(t) in want) for t in titles if t):
                best = cand
                break
        if not best:
            print(f'  skip (no MAL match): {name}')
            continue
        chars = get(f"https://api.jikan.moe/v4/anime/{best['mal_id']}/characters")
        time.sleep(0.7)
        main = [c for c in chars.get('data') or [] if c.get('role') == 'Main']
        rest = [c for c in chars.get('data') or [] if c.get('role') != 'Main']
        picked = []
        for c in main + rest:
            img = ((c.get('character') or {}).get('images') or {}).get('jpg', {}).get('image_url')
            cname = (c.get('character') or {}).get('name')
            if img and cname and 'questionmark' not in img:
                # MAL names come "Last, First" — flip them
                if ', ' in cname:
                    last, first = cname.split(', ', 1)
                    cname = f'{first} {last}'
                picked.append({'name': cname, 'image': img})
            if len(picked) == 10:
                break
        if picked:
            m['characters'] = picked
            hits += 1
            print(f'  ok: {name} -> {len(picked)} characters ({best["title"]})')
    except Exception as e:
        print(f'  err: {name}: {e}')
        time.sleep(2)

META.write_text(json.dumps(meta, ensure_ascii=False))
print(f'done: {hits}/{len(targets)} shows got character art · {META.stat().st_size // 1024} KB')
