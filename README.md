# OpenTV

A privacy-first TV and film tracker, built as a home for people leaving TV Time.
It imports your full TV Time GDPR export and rebuilds your history locally.

**The database on your phone is the source of truth.** The tracker needs no
account and makes no request to any server of ours. There is an optional
community — comments, ratings, follows — and joining it is the only thing that
ever sends anything. Your episode-by-episode history, with its dates, never
leaves the device either way.

- iOS and Android, native, with home-screen widgets on both
- Six languages: English, Arabic (RTL), French, Italian, Spanish, Portuguese (BR)
- Import from the official GDPR ZIP or the community browser-extension exports
- Export everything, any time, in TV Time's own format — you are never locked in
- Metadata from [TheTVDB](https://thetvdb.com) with [TMDB](https://www.themoviedb.org) as fallback

## What is here, and what is not

This repository is the **app**. The community server — a Cloudflare Worker with
its own database — is not open, and this is the honest reason: it holds other
people's accounts, and its behaviour is the thing standing between somebody's
handle and a stranger. Publishing it later, once it has been read properly for
that, is on the table; publishing it because openness is a good look is not.

The app talks to it over a plain HTTP API you can read in
[src/api.ts](src/api.ts). Point `src/api-config.ts` at your own Worker, or leave
it out entirely — the tracker is complete without it, which is the whole design.

**There is no way for anybody, including us, to fetch your library off your
phone.** Not a route, not a flag, not a support path. Bug reports get reproduced
from a description, like every other bug in this project.

## Running it

```bash
npm install
npx expo start
```

Config files are gitignored because they hold credentials. Copy each `.example`
and fill in your own:

| file | what it needs | needed for |
|---|---|---|
| `src/tmdb-token.ts` | a TMDB v4 read token | metadata fallback |
| `src/tvdb-key.ts` | a TheTVDB v4 API key | metadata (primary) |
| `src/api-config.ts` | your community Worker's URL | the community |
| `src/auth-config.ts` | Google/Apple client ids | community sign-in |
| `src/rc-keys.ts` | RevenueCat **public** SDK keys | OpenTV Plus |

Only the first two matter for a tracker-only build. Leave the rest and the
community and Plus simply stay unavailable — every one of them fails to
"not configured", never to a crash.

```bash
npm test              # jest — 978 tests
npx tsc --noEmit      # must stay clean
npm run lint
npm run i18n:types    # REQUIRED after editing any src/locales/*.json
```

### Things that have already cost someone hours

**The React Compiler is on.** It memoises render-time calls against their
arguments, so a counter meant to force a re-read of SQLite is deleted silently —
naming it in a `useMemo` dependency list does not save it, because the call does
not use it. Invalidate with state React sets, or read in a callback. Verify in
the compiled bundle, not the source.

**Arabic needs all six CLDR plural categories**, and French puts 0 in `one`
where English does not. `npm run i18n:types` regenerates the key union; skipping
it leaves the types lying about what exists.

**Long lists use `FlatList`**, never `ScrollView` with `.map()`. A 1207-episode
library found that one the hard way.

### iOS

**Do not run `npx expo prebuild`.** It regenerates the Xcode project from
`app.json` and deletes the `OpenTVWidgets` extension, which was added by hand and
no plugin reproduces. It also removes `FirebaseApp.configure()` from
`AppDelegate.swift` and two required Podfile edits.

`ios/` is gitignored apart from the Podfile and the project file, so **a fresh
clone does not have `AppDelegate.swift`** — the app builds and runs, and its
analytics are silently dead. Moving the widget extension into a config plugin is
the real fix and is not done yet. Until then: build iOS locally, Android on EAS.

## OpenTV Plus

The app has a paid tier. Since you are reading the source, you already know you
can turn it on in one line, and that is fine — nobody who can build an Expo app
from source was ever going to be the customer. Two things are worth saying
plainly rather than leaving you to find out:

- The **on-device** features — the advanced filter axes, the activity heatmap,
  the watch timeline, Deep Stats — run against your own database and answer to
  your own build. Flip the flag and they work.
- Anything **other people see** is decided by the server against a `is_plus`
  column that only the payment webhook writes. A local build cannot grant itself
  a supporter badge on somebody else's screen, and it is not meant to be able to.

Wrapped is free for everybody, on purpose. It is the one screen built to leave
the app.

## Licence

MPL-2.0. See [LICENSE](LICENSE).

File-level copyleft: if you modify a file from this project and distribute it,
those changes stay open. You may build something larger around it — including
proprietary parts in new files — which is what keeps this compatible with App
Store distribution, unlike the GPL. Firefox for iOS ships under the same licence
for the same reason.

The intent is narrow and deliberate: the import pipeline exists so people can get
their history *out* of a service that shut down. Improve it and the improvements
stay available to the people who need them.

Contributions are welcome — MPL was chosen partly so they are straightforward.
Open an issue before a large change so we can agree the shape of it first.

Copyright © 2026 Insightfy LLC.
