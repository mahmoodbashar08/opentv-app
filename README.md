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

GPL-3.0-or-later. See [LICENSE](LICENSE).

You may use, study, modify and redistribute this, and any distributed
derivative must also be GPL-3.0. That is deliberate: the import pipeline exists
so that people can get their history *out* of a service that shut down, and it
should not be possible to fold it into something closed.

**A note if you want to contribute:** the GPL and Apple's App Store terms are in
tension, so a GPL fork cannot straightforwardly be published there. Insightfy
LLC holds the copyright on the existing code and can distribute its own builds;
outside contributions would need a contributor agreement before they could ship
in the store version. Open an issue before a large change so we can sort that
out first.

Copyright © 2026 Insightfy LLC.
