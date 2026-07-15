#!/usr/bin/env python3
"""Character art for non-anime shows from TVmaze (keyless, supports TVDB ids).

Fills the gaps MyAnimeList left: western animation + live action get real
CHARACTER images (not actor headshots) wherever TVmaze has them.
Run from mobile/:  python3 scripts/fetch-characters-tvmaze.py
"""
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
META = ROOT / 'src/data/metadata.json'


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'our-tv-time/1.0'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


meta = json.loads(META.read_text())
targets = [(tvdb, m) for tvdb, m in meta.items() if not m.get('characters')]
print(f'{len(targets)} shows without character art — trying TVmaze')

hits = 0
for tvdb, m in targets:
    name = m.get('name') or ''
    try:
        found = get(f'https://api.tvmaze.com/lookup/shows?thetvdb={tvdb}')
        time.sleep(0.5)
        cast = get(f"https://api.tvmaze.com/shows/{found['id']}/cast")
        time.sleep(0.5)
        picked, seen = [], set()
        for c in cast:
            ch = c.get('character') or {}
            img = (ch.get('image') or {}).get('medium')
            cname = ch.get('name')
            if img and cname and cname not in seen:
                seen.add(cname)
                picked.append({'name': cname, 'image': img})
            if len(picked) == 10:
                break
        if picked:
            m['characters'] = picked
            hits += 1
            print(f'  ok: {name} -> {len(picked)}')
    except Exception as e:
        print(f'  miss: {name}: {e}')
        time.sleep(1)

META.write_text(json.dumps(meta, ensure_ascii=False))
print(f'done: +{hits} shows · {META.stat().st_size // 1024} KB')
