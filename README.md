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

## Running it

```bash
npm install
npx expo start
```

Four config files are gitignored because they hold credentials. Copy each
`.example` and fill in your own:

| file | what it needs |
|---|---|
| `src/tmdb-token.ts` | a TMDB v4 read token |
| `src/tvdb-key.ts` | a TheTVDB v4 API key |
| `src/api-config.ts` | the community Worker's URL (omit to run tracker-only) |
| `src/auth-config.ts` | Google/Apple client ids, for community sign-in |

The tracker works without the last two — the community simply stays unavailable.

```bash
npm test              # jest
npx tsc --noEmit      # must stay clean
npm run lint
npm run i18n:types    # REQUIRED after editing any src/locales/*.json
```

### iOS

**Do not run `npx expo prebuild`.** It regenerates the Xcode project from
`app.json` and deletes the `OpenTVWidgets` extension, which was added by hand
and no plugin reproduces. It also removes `FirebaseApp.configure()` from
`AppDelegate.swift` and two required Podfile edits. Build iOS locally; Android
builds fine on EAS.

## Licence

MPL-2.0. See [LICENSE](LICENSE).

File-level copyleft: if you modify a file from this project and distribute it,
those changes stay open. You may build something larger around it — including
proprietary parts in new files — which is what keeps this compatible with App
Store distribution, unlike the GPL. Firefox for iOS ships under the same
licence for the same reason.

The intent is narrow and deliberate: the import pipeline exists so people can
get their history *out* of a service that shut down. Improve it and the
improvements stay available to the people who need them.

Contributions are welcome — MPL was chosen partly so they are straightforward.
Open an issue before a large change so we can agree the shape of it first.

Copyright © 2026 Insightfy LLC.
