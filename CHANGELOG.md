# OpenTV — Changelog

A TV Time replacement: imports your TV Time GDPR export into on-device SQLite.
No account, no server, no ads.

Version history below is reconstructed from git; early releases predate detailed
commit history, so 1.0.0–1.1.1 are summarised from the initial commit and the
Play Console record rather than per-change.

| Version | Android versionCode | iOS build | Status |
|---|---|---|---|
| 1.1.9 | — | — | planned |
| 1.1.8 | 20 | 20 | in review (20 Jul 2026) |
| 1.1.7 | 16 | 16 | released 18 Jul 2026 |
| 1.1.6 | 13, 14 | 14 | released 17 Jul 2026 |
| 1.1.5 | 11 | — | released 17 Jul 2026 |
| 1.1.0 | 3 | — | released 13 Jul 2026 |

---

## 1.1.9 — planned

### P0 — critical

**Startup repair freezes the splash screen.**
Bumping `REPAIR_REV` makes every updating user silently re-import their whole
export at launch. The importer runs ~66 synchronous SQLite calls plus a
`withTransactionSync` block, which monopolises the JS thread — React Native
cannot render, so the app sits on the splash screen until it finishes. On a
large library that is minutes with no progress indicator. One tester assumed it
had hung, reinstalled, and lost all the matches they had fixed by hand.
*Fix: a real progress screen, defer the repair until after first render, or
chunk the work so the thread yields.*

**Movie watch time undercounts.**
`getMovieTotals()` still sums `runtime` with no fallback. The same bug was fixed
for shows in 1.1.8 but never applied to movies, because the reference library
had only 2 of 154 movies missing a runtime. A tester whose library is mostly
missing them reports movie time roughly five months short.
*Fix: fall back to `movieMeta` runtime, mirroring the show-side fix.*

### P1 — correctness

**Episode count treats rewatches as separate episodes.**
`COUNT(*) FROM watches` counts every row, so an episode watched 8 times counts
as 8 episodes, and the total drifts further from TV Time the more you rewatch.
Time *should* count rewatches; the episode count should not — currently both do.
*Fix: `COUNT(DISTINCT showId, season, episode)` for the episode statistic.*

**Most custom lists are dropped on import.**
The list parser accepts only `type === 'list'`. A tester with 30-something lists
had 3 import; a second TV Time-importing app showed all of theirs, which points
to a second list type being discarded. Note the contents may be unrecoverable
regardless — TV Time stored list items as bare UUIDs and only included a name
when the title was also tracked or rated, so many lists will import empty.
*Fix: accept other list types, and show empty lists with an honest count rather
than dropping them.*

### P2 — usability

- **"…and N more" is a dead end.** The Needs attention list caps at 60 and
  renders the remainder as inert text, leaving hundreds of entries unreachable.
- **Nameless rows in Needs attention.** Entries push `m.name` with no empty
  guard, producing blank rows with a FIND button that has nothing to search.
- **Comments screen freezes.** Every comment renders into a `ScrollView` via
  `.map()` with no cap or virtualization. At 800+ comments with GIFs it locks
  up — the same failure as the 1207-episode crash fixed in 1.1.8.

### P2 — usability (cont.)

- **Comment-image cap.** The in-import download stops at the first 100
  (`importer.ts` `slice(0, 100)`); `downloadPendingCommentImages()` backfills the
  rest afterward, but a tester with ~5,000 comments needs that background fill
  confirmed unbounded so none stay pointed at TV Time's dying CDN.
- **Character voting reported as non-functional** (external reviewer). Unverified
  — needs the save path in `app/episode/[id].tsx` checked end to end.

### P3 — requested

- Show how many times an episode was rewatched, not just that it was
- Open on Profile rather than Movies
- Mark replies consistently in the comments list
- Long-press a show to open its manage menu (TV Time muscle memory; the ⋯ sheet
  exists, the long-press gesture doesn't)

### Notes from external review (already addressed or by-design)

- **Compare Stats** was flagged as out of place; 1.1.8 already hides it
  (`stats.tsx` `compare: { display: 'none' }`) until accounts exist.
- **Creating new comments / seeing others' comments** requires the community
  server — intentionally deferred, not a bug.

### P4 — platform and infrastructure

- Android cloud backup (needs Google OAuth) — the headline feature
- R8 shrinking: the AAB is 75 MB
- Edge-to-edge for Android 16
- A permanent Ruby ≥ 2.7 and JDK install (see 1.1.8 build notes)

---

## 1.1.8 — in review (20 July 2026)

The largest release so far. Shipped as **iOS build 20 / Android versionCode 20**
with identical code on both platforms.

### Features

- **Custom lists** import from the export and appear in Lists and on the profile,
  preserving unresolved entries so the true list size is shown
- **Poster & backdrop picker** — choose any artwork for a show; survives backup
  and restore
- **Mark a show as finished**, which also marks every aired non-special episode
- **Catch-up time** — how long is left to finish a series
- **Character voting on every show**, with real character art for anime from
  AniList instead of TMDB's voice actors, fetched automatically
- **Live import counters** — shows, episodes and movies animate as they land
- Rewatch dates listed under the first-watch date

### Fixes

- **Much faster imports.** Every phase parallelised, 15s timeouts added so one
  stuck request can no longer stall the run
- **Watch time was reading far short of the truth.** TV Time's export only
  carries a per-episode runtime for some rows — roughly 40% arrive empty — and
  those counted as *zero* minutes. On the reference library this read 448 hours
  instead of 645, about 8 days of history missing. Gaps now fall back to the
  show's runtime (metadata stores minutes, the column stores seconds), then to a
  24-minute average
- **Tapping a show opened the wrong episode.** The watch-list card displayed the
  next episode via a season-aware helper but took its metadata, artwork and tap
  target from a raw `maxEp + 1` counter with no season bound. Finish a season and
  the two disagreed: the card read "S06 | E01" while the tap opened a phantom
  "S05 | E25" of a 24-episode season. The missing metadata also made the subtitle
  fall back to "Last watched <date>" on an unwatched episode. All coordinates now
  resolve through one helper
- **TV movies can be matched.** TV Time tracked TV movies as shows back when it
  was TV-only, so those entries exist in TMDB only as movies and the match screen
  could never surface them. It now searches both and stores a movie pick as the
  one-episode season a TV movie actually is
- **Fix match silently did nothing** on any show that already had metadata: the
  fetch returned the cached copy while it was fresh, discarding the hand-picked
  id. Picks now force the re-fetch, persist even if a season request fails, and
  are detected by cached metadata rather than by the presence of a poster
- **Sharing the profile card sent an empty payload on Android.** React Native's
  `Share` only honours `url` on iOS, so the image was dropped and apps received
  nothing — WhatsApp reported it as a blank message. Now shares the real file via
  `expo-sharing`, which is also where the missing "Save Image" option comes from
- **Profile card** — the brand bar no longer covers the bottom stats, and type is
  sized against the card so long usernames stop truncating and clock values stop
  wrapping
- **Duplicate shows.** TV Time keeps deprecated duplicate entries; watched shows
  could appear unwatched. Empty ghosts are dropped and split watches merged
- **Crash on mega-seasons** (Detective Conan, 1207 episodes) — episode rows are
  capped with a "Show more" control
- Show menu rebuilt as a bottom sheet of icon rows
- Fix match searches as you type, with out-of-order responses guarded
- Popcorn arena sizes to the space left rather than a fixed height, and the
  bucket's rim sits flush against its body

### Build notes

- CocoaPods runs on macOS system Ruby 2.6, which predates `Enumerable#filter_map`
  (added in 2.7). `expo-modules-autolinking` uses it to read precompiled-module
  configs; on 2.6 every read fails, the React Native xcframeworks are skipped, and
  `ExpoModulesCore` links without them — surfacing as
  `Undefined symbols: facebook::react::Sealable::Sealable()`. Worked around with a
  polyfill at the top of `ios/Podfile`, which must use `module ::Enumerable` —
  CocoaPods evaluates the Podfile in its own scope, so an unqualified name defines
  a nested module and changes nothing. `ios/` is gitignored and `expo prebuild`
  regenerates the Podfile, so building via Xcode avoids losing it
- EAS free-tier Android build quota was exhausted; `eas build --local` produces the
  AAB without consuming cloud quota while still using the correct upload keystore

---

## 1.1.7 — 18 July 2026

- Delete shows and movies from the library, zombie-proof (deletion covers
  `episode_watched_on`, and a deleted show cannot reappear)
- Stop following a show
- Episode notifications
- Upcoming and Trending
- Filters
- The popcorn mini-game

## 1.1.6 — 17 July 2026

- Home-screen widgets on both platforms: **Up Next** (shows) and
  **Movies to Watch**
- Large Up Next widget also lists movies — episodes above, watchlist below
- A third combined widget: Up Next + Movies side by side
- iOS widget extension target added by hand (`ios/OpenTVWidgets`), force-tracked
  because `ios/` is gitignored
- Fixed blank Android widgets: `'use no memo'` — React Compiler's transform breaks
  `react-native-android-widget`'s tree builder

## 1.1.5 — 17 July 2026

- Fixed the season-unmark counter
- Imports are resumable — an import cut short by a backgrounded or killed app
  finishes on next launch instead of being lost
- Show first-watch and rewatch dates; absolute episode numbers only for anime

## 1.1.4

- Favourite characters, with character art for every show
- Recover mismatched shows

## 1.1.3

- Retract phantom episodes invented by the ≤1.1.2 bulk fill from TV Time's
  inflated `nb_episodes_seen` counter
- TVDB → TMDB episode remap, putting imported rows onto their true episodes
- Self-updating metadata

## 1.1.2

- Movie and episode rewatches
- TV Time legacy vote formats
- Watched-on sources
- Versioned self-repair (`REPAIR_REV`): bumping it re-runs a silent merge
  re-import from the preserved original export, so libraries heal as the importer
  improves without anyone re-importing by hand
- Optional iCloud backup
- Ghost-episode fix
- Rating labels matched to TV Time (GREAT → SUPER)
- Progress colours: purple only for genuinely ended shows

## 1.1.0 — 13 July 2026

First public release. Import a TV Time GDPR export into on-device SQLite: shows,
episodes, movies, ratings, emotions, comments and profile. Watch list, episode
tracking, stats and profile screens.

## 1.0.0

Initial build.
