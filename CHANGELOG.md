# OpenTV — Changelog

A TV Time replacement: imports your TV Time GDPR export into on-device SQLite.
No account, no server, no ads.

Version history below is reconstructed from git; early releases predate detailed
commit history, so 1.0.0–1.1.1 are summarised from the initial commit and the
Play Console record rather than per-change.

| Version | Android versionCode | iOS build | Status |
|---|---|---|---|
| 1.2.1 | — | — | planned (usability + polish) |
| 1.2.0 | 22 | 22 | in review (26 Jul 2026) — fixes + lists + sharing + TheTVDB |
| 1.1.9 | 21 | 21 | released 24 Jul 2026 (emergency photo rescue) |
| 1.1.8 | 20 | 20 | in review (20 Jul 2026) |
| 1.1.7 | 16 | 16 | released 18 Jul 2026 |
| 1.1.6 | 13, 14 | 14 | released 17 Jul 2026 |
| 1.1.5 | 11 | — | released 17 Jul 2026 |
| 1.1.0 | 3 | — | released 13 Jul 2026 |

---

## 1.2.0 — in review (26 July 2026)

The biggest release since 1.1.8 — bug fixes, a full lists overhaul, TV Time-style
sharing, and a TheTVDB hybrid so almost nothing stays unmatched. iOS build 22.

### Shipped

**Fixes**
- **Imports fail loudly instead of "0".** A ZIP we can't read now shows a real
  error naming the files it contained, rather than a cheerful "Import completed"
  with an empty library.
- **No more lag after switching apps.** The iCloud auto-backup was rebuilding the
  whole library ZIP on every backgrounding; it now skips instantly when nothing
  changed (exact change-detection via a row-change counter).
- **Favorites & search refresh live.** Removing a favorite, or adding/removing
  from a detail screen, now updates the grid / the ＋/✓ state immediately.
- **Movie watch-time no longer undercounts** (runtime fallback, matching the
  1.1.8 show-side fix). **Rewatches no longer inflate the episode count**
  (counted distinct; time still counts rewatches).
- **The ↻ button on a show** jumps to your next episode to watch (was a silent
  metadata refresh that looked broken).
- **Startup repair no longer freezes the splash** — it runs after first paint
  with a progress overlay.

**Lists** — create, rename, delete; add via a real "Add shows & movies" search or
a show/movie's ⋯ → "Add to list"; remove items; **drag to reorder** (with
drag-to-edge auto-scroll for long lists). All merge-safe, so re-importing never
undoes your edits. Private lists TV Time exported without a name are kept with a
dated placeholder instead of being dropped.

**Sharing** — TV Time-style share cards (yellow TRACKED/WATCHED card, poster,
S×E, star rating) for shows, episodes and movies, saved as a real image.

**Favorites** — a red heart badge on a favorited show/movie's banner.

**TheTVDB hybrid** — TMDB stays primary; when it can't match a show, movie or
anime, we fall back to TheTVDB (which TV Time was built on, so it's a 1:1 id
match). Missing posters/backgrounds are backfilled from TheTVDB on launch;
Fix-match shows both databases; titles say honestly how they matched. Uses our
own free-tier key (attribution in About). **Note:** episode *structure* still
comes from TMDB — TheTVDB fills matching + artwork only, no renumbering.

**Offline** — every tracked show's full metadata (episode names, air dates,
seasons) is pre-cached locally so the library is browsable without a connection
(staggered 25 shows/launch). You still need internet to add new titles.

**Under the hood** — extracted the tricky logic (version compare, list merge,
movie matching, import diagnostics) into a tested module (12 unit tests).

### Background / detail on the fixes above

### P0 — critical

**Import silently reports success but adds nothing (all counts "0").**
Reported on the App Store (v1.1.7, US): a user submits their TV Time ZIP, the
importer finishes and says done, but every counter stays 0 — the whole library
fails to import with no error surfaced. This is the single most damaging bug
possible for a "bring your TV Time history" app. Root cause not yet diagnosed;
most likely an unhandled ZIP/CSV layout the parser skips silently.
*Fix: reproduce with the user's export, add per-file diagnostics in `importer.ts`,
and surface a real error instead of a silent 0. Highest priority.*

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
Root cause confirmed from a tester's `lists-prod-lists.csv`: every row is
`type: 'list'`, so the type filter was a red herring. The real cause is the
`(r.name || '').trim()` requirement — **TV Time only exports a name for *public*
lists**; private lists arrive with an empty `name` (the name was held
server-side and is gone). Her one public list imported; all 15 private ones were
dropped for having no name.

Crucially the **contents are intact** — the dropped lists carry 619 items
(371 series with resolvable TVDB ids, 248 movie-UUIDs that resolve only where
the movie was also tracked). So the items are recoverable; only the names are
lost.
*Fix: keep nameless lists and give them a placeholder — the `created_at` date is
the most identifiable ("Untitled · Dec 2024"), helped by the cover art of the
first items. Do NOT gate on name. Series items populate fully; movies follow the
existing UUID limitation.*

### Tester feedback — 24 Jul 2026 (on 1.1.9)

- **Share should produce an image card, not a text file (likely 1.1.9
  regression).** Tester got a text/`.json` file where they expected a shareable
  picture. The share must generate a TV Time-style card image (the classic
  yellow card — "TRACKED · S03 | E11 · I VOTED ★★★★★", show-rating card, etc.).
  Reference designs to match: `design/referance/cards/…/000_*.jpg` (episode
  TRACKED + vote), `001_*.jpg` (show TRACKED), `541AB627-*.jpg` (show rating card
  with added/reviews). *Fix: the share action must render + share the card PNG
  (via `captureRef` → `expo-sharing`, `image/png`), never `shareLibraryExport()`
  or the JSON export. Verify a real image reaches the share sheet on both
  platforms.*
- **↻ button: repurpose to "jump to next episode" (not a metadata refresh).**
  Decided with the tester: on the show screen, when you scroll ahead through the
  episode list without checking anything, tapping ↻ should **snap back to the
  next episode to watch** = (last checked episode) + 1; if fully caught up, the
  latest aired episode. Today the button silently force-refreshes TMDB metadata
  and gives no visible feedback, so it reads as broken. *Fix: rewire ↻ to scroll
  to the next-to-watch episode; drop the manual metadata refresh (background sync
  already keeps metadata fresh). The `refreshing` spinner is no longer needed.*
- **Lists section doesn't work properly.** Can't edit list details or delete
  items — lists CRUD is incomplete. Related to the P1 "lists dropped on import"
  work; the editing/deleting path needs to be built or repaired end to end.
- **Favorites don't update live.** Removing a favorite only shows after leaving
  the homepage and returning — the favorites view isn't re-querying on focus.
  *Fix: `useFocusEffect` re-read (the cross-screen reactivity pattern), or
  invalidate on the mutation.*
- **Input lag after returning from background (new regression). ROOT CAUSE
  CONFIRMED.** Backgrounding then reopening leaves the bottom nav unresponsive
  for several taps, then queued taps all fire at once ("wakes up"). Confirmed
  from a 63s tester video: the JS thread is briefly blocked on resume — not low
  FPS, not a crash. Trigger is the `background` transition, but the work bleeds
  into the resume window. `initAutoBackup` (`backup.ts`) fires `backupNow()` on
  *every* background; `backupNow()` runs synchronous JS — `buildTvTimeZip()`
  (reads ~15 tables, embeds every image file, zips) + `hashBytes()` + base64 —
  and only *then* checks the hash to decide whether to skip the iCloud write. So
  the whole library+images ZIP is rebuilt on the JS thread on every app switch,
  even when nothing changed; switch back quickly and taps queue behind it.
  (On iOS only — on Android `backupNow()` early-returns `unavailable`, so the
  Android equivalent, if any, is `syncWidgets()`/`syncEpisodeNotifications()` in
  `_layout.tsx`.)
  *Fix: gate `backupNow()` on the cheap `librarySig()` signature BEFORE building
  the ZIP (early-out when unchanged), and defer the real backup off the
  background handler so it never collides with an immediate resume. Verify on the
  iPhone simulator: background→foreground with no edits should have zero lag.*

### TheTVDB as the single metadata source (shows + movies + anime) — MAJOR (own release, ~1.2.0)

**Move matching + metadata to TheTVDB, using our own bundled key.** TV Time was
built on TheTVDB — the export keys *everything* on `tvdbId` — so TheTVDB is a
1:1 match with no missing titles and no fuzzy-guessing, which is what fills the
"Needs attention" pile under TMDB. Verified live against the v4 API:
`/search`, `/series/{id}`, `/series/{id}/episodes`, **and `/movies/{id}` +
movie search all work** — TheTVDB v4 covers **shows, movies AND anime** (anime
via absolute ordering), so it can be the *single* source, keyed on `tvdbId`
throughout. (Earlier note said "TV-only, keep TMDB for movies" — that was the
old TheTVDB; corrected after testing v4.)

Decisions locked in:
- **Bundle OUR OWN key** (like the existing TMDB token) — NOT per-user (that
  needs a paid TheTVDB subscription + onboarding friction, rejected).
- **Single source: shows + movies + anime all via TheTVDB.** TMDB can remain a
  fallback where TheTVDB artwork is thin — decide per-field after eyeballing a
  real library. Do NOT rip TMDB out in one pass.
- Later (Phase 6) this moves server-side so the key isn't bundled.

**Done already (safe foundation, inert — nothing in the app imports it yet):**
- `src/tvdb.ts` — v4 client: token login (+ 401 re-login), `tvdbSeries`,
  `tvdbEpisodes` (paginated), `tvdbSearch`. Typechecked; API proven live.
- `src/tvdb-key.ts` — key wired like the TMDB token (gitignored; `.example.ts`
  template). Env vars aren't available at RN runtime, hence a source module.

**Remaining (the risky migration — its own release):**
- **Episode/season renumbering.** Show + anime watch history hangs off
  season/episode numbers; TVDB and TMDB order differently (specials, absolute
  anime order, split seasons). Existing libraries need a `REPAIR_REV`-guarded
  remap (the 1.3-era TVDB→TMDB remap, in reverse) — and it must land *after* the
  splash-freeze fix, with the progress overlay.
- **Movies are keyed by `name`** today (PK), with an optional `tmdbId`. Using
  TheTVDB for movies means carrying a tvdb movie id and rewiring movie
  match/artwork.
- **Artwork QA** — confirm TheTVDB poster/still coverage on a real library
  before switching; keep TMDB fallback where thin.
- **Licence** — confirm the key's terms permit bundling in a distributed app
  (stricter than TMDB). Hard gate before shipping.

---

## 1.1.9 — released (24 July 2026)

Emergency release — rescue TV Time photos before TheTVDB's own CDN can die too.
Shipped on iOS (App Store) and Android (Google Play).

**Profile cover rescued from TheTVDB (time-sensitive).** TV Time's CloudFront
CDNs were deleted with the shutdown (hosts no longer resolve), so any import
run after ~15 Jul 2026 gets no avatar, no cover, and no comment images — the
GDPR ZIP holds only URLs, not files. Avatars and comment images pointed at TV
Time's own CDN and are gone for good, but covers are TheTVDB fanart, and the
same file still exists on `artworks.thetvdb.com` under the legacy banners path.
Added `tvdbRescueUrl()` (dead `dg31sz3gwrwan.cloudfront.net/fanart/…` →
`artworks.thetvdb.com/banners/fanart/original/…`), used as a fallback during
import and as a one-shot startup repair (`recoverProfileCover()`, wired in
`_layout.tsx`) that backfills existing libraries. Urgent because TheTVDB is
owned by the same company that shut TV Time down — covers should be saved
on-device before that CDN can die too. Verified end-to-end on emulator.

**Orphaned comment images re-linked.** An in-app erase → re-import keeps the
Documents folder but rebuilds every comment row; with the CDN dead the
re-download can't refill them, so images that were sitting on the device
showed as black boxes. `relinkOrphanedCommentImages()` (runs inside
`downloadPendingCommentImages`, i.e. on every launch and after every import)
matches rows back to their files: `comment-img-bg-<id>.<ext>` exactly, else
`comment-img-<stamp>-<i>.<ext>` by the row's position among image-bearing
comments (stable for the same export), newest stamp first. Verified on
simulator: two dead-CDN comment images restored. Third-party-hosted images
(e.g. Tenor GIFs) still download normally — only TV Time-hosted ones are gone.

**Backups and exports now carry the images themselves.** The export ZIP (and
therefore the iCloud backup, which is the same ZIP) stored only image URLs —
all dead now — so a restore or new phone silently lost every picture even when
this device still had the files. The exporter now bundles the actual files
(avatar, cover, comment images, friends' avatars) under `_opentv_images/` with
an exact url→file map in `_opentv_extras.json`; the importer restores them to
Documents up front and prefers a bundled copy over re-fetching a dead URL
(live URLs still download fresh). Images are stored zip-level 0 — they're
already-compressed media. This closes the last "it only lived on a URL" gap:
once a user's images are on any device, they survive backup → restore → new
phone forever.

**Data export was broken on Android (silent).** Settings → "Export my data"
built the ZIP then shared it with `Share.share({ url })` — but RN only attaches
a file `url` on iOS, so on Android the share sheet opened empty and the backup
never left the phone (the same trap already fixed for the profile card). Since
manual export is Android's only backup path, this meant Android users had *no*
working backup at all. Fixed by routing both the ZIP and JSON exports through
`expo-sharing` (`shareLibraryExport()` in `manual-backup.ts`). Verified on
emulator: the share sheet now shows the real `opentv-export-*.zip` with Drive
as a target, and the ZIP contains the bundled images.

**Android backup nudge.** Android has no iCloud auto-backup, so the profile now
shows a "Back up your library — export a copy to keep it safe" banner (mirrors
the iOS iCloud banner) that walks the user through exporting to Drive/Files.
Fires only when there's new, un-exported data (`manualBackupOverdue()` compares
a cheap row-count signature), so it clears right after an export and never
nags. A proper Google Drive auto-backup module — real parity with iCloud, no
25 MB Android Auto Backup cap — is planned as its own later release.

**Profile fields now editable on Android** — the `Alert.prompt` bug below,
fixed via cross-platform `PromptModal`.

---

## 1.2.1 — planned (usability / polish)

> Lower-priority usability, requested, and platform items deferred out of 1.2.0
> so that release stayed focused on the high-priority fixes + TheTVDB matching.

### P2 — usability

- **"…and N more" is a dead end.** The Needs attention list caps at 60 and
  renders the remainder as inert text, leaving hundreds of entries unreachable.
- **Nameless rows in Needs attention.** Entries push `m.name` with no empty
  guard, producing blank rows with a FIND button that has nothing to search.
- **Comments screen freezes.** Every comment renders into a `ScrollView` via
  `.map()` with no cap or virtualization. At 800+ comments with GIFs it locks
  up — the same failure as the 1207-episode crash fixed in 1.1.8.
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
- **Landscape on iPadOS** (external reviewer liked the local-first concept, asked
  for this). The app is `supportsTablet: true` but locked to
  `orientation: "portrait"` in app.json. Unlocking it is a one-line config change,
  but every screen's layout needs checking in landscape first — several use
  fixed widths and portrait-tuned card sizes, so this is a layout pass, not just
  a flag flip.

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
