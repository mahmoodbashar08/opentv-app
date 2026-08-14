# OpenTV — Changelog

A TV Time replacement: imports your TV Time GDPR export into on-device SQLite.
No account, no server, no ads.

Version history below is reconstructed from git; early releases predate detailed
commit history, so 1.0.0–1.1.1 are summarised from the initial commit and the
Play Console record rather than per-change.

| Version | Android versionCode | iOS build | Status |
|---|---|---|---|
| 1.4.0 | — | 34 | in development — Wrapped, filters, private accounts |
| 1.3.2 | — | — | folded into 1.4.0 |
| 1.3.1 | 40 | 33 | **released 13 Aug 2026, both stores** — the community fixes below |
| 1.3.0 | 37 | 30 | **released 11 Aug 2026, both stores** — the community layer |
| 1.2.1 | — | — | **released 7 Aug 2026, both stores** — languages + the fixes below |
| 1.2.0 | 26 | 22 | **released 30 Jul 2026, both stores** — fixes + lists + sharing + iPad + TheTVDB as the metadata source |
| 1.1.9 | 21 | 21 | released 24 Jul 2026 (emergency photo rescue) |
| 1.1.8 | 20 | 20 | in review (20 Jul 2026) |
| 1.1.7 | 16 | 16 | released 18 Jul 2026 |
| 1.1.6 | 13, 14 | 14 | released 17 Jul 2026 |
| 1.1.5 | 11 | — | released 17 Jul 2026 |
| 1.1.0 | 3 | — | released 13 Jul 2026 |

---


## 1.4.0 — Wrapped, filters, and private accounts

Named 1.4.0 rather than 1.3.2 because it is not a patch: three features, none
of which existed. Everything in the 1.3.2 list below shipped as part of it.

**Plus ships DARK.** Deep Stats, the profile themes and layouts, the activity
heatmap, the watch timeline, the advanced filter axes, list covers and the
supporter badge are all in this build behind `PLUS_AVAILABLE = false` — the code is here, the entry
points are not. They wait for the release that can actually take money: the
Paid Applications agreement, the store products and the RevenueCat keys all
live outside this repository.

Hidden rather than unlocked, deliberately. Shipping them free and charging
later takes something away from people who already had it, which is the most
reliable way there is to make users angry — Trakt did exactly that and it is
still the first thing anybody says about them.

### Wrapped — free, monthly and yearly
A tap-through recap of any month or any year, as 9:16 cards built for the
place they end up: Instagram Stories and TikTok crop anything else. Every
slide is its own shareable card, because the one somebody wants to post is
rarely the poster wall — "mostly comedy this month" starts more arguments.

Free on purpose, and it is the only Plus-era screen that is. Wrapped is the
one feature built to LEAVE the app: every card carries the app's name to
somebody who does not have it, and most of those people lost TV Time and are
still looking. Charging for it is charging for your own advertising. Plus
paints the cards in the owner's profile theme; everybody else gets OpenTV
yellow, which is what makes a hundred shared cards read as one brand.

A quiet month is the main case, not the edge: below three things watched it
says so kindly and offers another period, rather than printing a wall of
zeroes at somebody for using the app less.

The profile offers last month's recap from the 1st, and keeps offering until
it is answered — a prompt that lives for one day is missed by everyone who
does not open the app that day, and July is just as finished on the 4th.

### Advanced filtering
Stackable axes — progress, genre, network, decade, length, watched-in-year and
your own rating — OR within an axis, AND across them. The counts beside each
chip are FACETED: "Comedy 9" is what remains after your other choices, with
that axis excluded from its own count, so picking a second genre widens the
result instead of collapsing every number to zero.

**Sort and progress stay free; the seven new axes are Plus.** The line is
drawn where nothing is taken away — sorting and filtering by progress shipped
free long before this release and are untouched, so no control anybody already
had moves behind a price. Genre, network, decade, length, watched-in-year,
rating and saved presets are new capability, and that is what the tier is for.

The chips and their counts stay visible to non-supporters when Plus exists:
somebody has to see "Comedy 9" to want it, and a hidden feature sells nothing.
Only narrowing asks.

It also fixes a bug nobody reported: filters reset every time you left the
screen, so anyone who filters the same way daily re-did it daily.

### Reconnecting your TV Time friends — the screen that was promised
A pinned Reddit post said, four weeks before accounts existed, that old
friendships would reconnect once they did. Accounts arrived on 11 Aug; the
matching had been running the whole time — ids from the user's own export,
matched server-side, notifications written both ways — and there was nowhere to
look at it. It surfaced during the seed flow, which most people see once.

Now: **Find people → Reconnect**, and the `friend_found` notification opens it
rather than the actor's profile. Friends already here, each with a Follow chip;
friends who have not joined, each with an invite.

The empty state is the design case rather than the edge, because almost
everyone lands in it for now: *"You're early. Your friends list is checked
against every new account, so they'll appear here on their own the moment they
arrive — there's nothing to come back and check."*

Two things the build turned up. `maybeReconcileFriends` can never find a friend
who joins LATER on its own: its fingerprint is of your own library, so only a
re-import or the server's notification surfaces a late arrival — which is why
the pull-to-refresh here is the unconditional call. And the banner counts
matches rather than storing a flag, because dismissing at two would otherwise
silence the third and every one after it: the same shape as the three
publish-fingerprint bugs of 7 Aug.

### Wrapped, rewritten
The numbers were right and the sentences around them read like a report. The
rule applied throughout: the figure stays exactly as computed, the line stops
being an achievement. "412 hours watched / in front of the screen" became "412
hours / spent inside somebody else's story"; "Your biggest day / 17 things
watched" became "One day stands out / 17 things in one day. It happens."
Nothing says biggest, longest or most as praise, and no card implies that
watching more would have been better.

The quiet-period card got the most attention, because it is the one most people
will see: a slow month has to read as normal rather than as a consolation prize.

Arabic was rewritten rather than translated, and doing it found two strings in
Gulf dialect sitting in a file that is otherwise formal — now consistent. French
moved to `tu`, matching where the rest of that file already sat and suiting a
card addressed to one person.

### The app is open source, and one thing had to go first
MPL-2.0, the licence Firefox for iOS ships under: modify a file and those
changes stay open, build something larger around it and the new files are yours.
The GPL was the other candidate and was rejected for a specific reason rather
than a vague one — it conflicts with the App Store terms, which is fine while
every line is ours and becomes a problem the day somebody else contributes one.

The server stays closed. It holds other people's accounts, and "openness looks
good" is not a reason to publish the thing standing between somebody's handle
and a stranger.

**The support-bundle upload is gone, from the app, the server and the git
history.** The developer could flag an account and the phone would then upload
its preserved TV Time import — the whole library — behind a banner that informed
rather than asked. It was carefully built, and it was still the one path by
which somebody's history could leave their phone without them pressing anything.
An app whose promise is that the library stays on the device should not have
that path, least of all in a repository anybody can read, and no consent screen
fixes it: the fix is not asking better, it is not being able to.

The R2 prefix it wrote to was checked before deleting the code, and held **zero
objects**. The capability existed and was never once used, which is the cheapest
possible moment to lose it.

### Private accounts, and choosing what shows
`is_private` shipped in 1.3.0 as a switch that reached nothing — it moved, it
looked like a setting, and it wrote to no server and no storage. Anyone who
turned it on believed they were private and was fully public. That is the
worst way a privacy control can fail, and it is now real: follow requests,
accept and deny, and pending requests that never count as followers.

Eight switches decide what a visitor sees — stats, activity, lists, favourites,
shows, films, comments. The server OMITS the data rather than flagging it;
hidden enforced only in the app is a lie to anyone reading the API. Free, and
never Plus: paywalling privacy is indefensible.

## 1.3.2 — folded into 1.4.0

What 1.3.0 and 1.3.1 leave standing. Most of it was found the same way as
everything in 1.3.1 — by a user hitting it and saying so — and three of these
were promised out loud to somebody who is waiting.

### Nobody can see anybody else's comment photos
120 pictures from 4 people are in R2 right now, uploaded, indexed in
`comment_images`, and unreachable. `backend/src/routes/images.ts` has one
endpoint and it is a `POST`; there is no route that reads an image back out, so
[comment-thread.tsx:228](src/components/comment-thread.tsx#L228) falls through to
`null` for everyone but the picture's own owner, whose copy is on their disk from
import. That was deliberate — serving other people's photographs means owning
what is in them — and 1.3.0 said so out loud. It is also why the rescue only half
worked: the files survived TV Time's CDN dying and then nobody could look at them.

At this size the blocker is a decision, not an algorithm. 120 images from four
named people is one sitting:

- `GET /v1/comments/image/:id`, serving `scan_status = 'clean'` only, 404 otherwise
- the key carried in the comments feed so the app knows there is one to fetch
- a way to mark the backlog — a screen in the admin dashboard, or one statement
  once the bucket has been looked through

An automated scan is the right answer at ten thousand images and overkill at
120. What is not optional is that somebody has looked before anything is served;
`clean` must mean a person said so.

### The app says "Something went wrong" for any error it has not met before
Email sign-up was closed on 11 Aug (`EMAIL_SIGNUP: "off"`) so that no more
accounts could be created while the handle bug was in review. The server answers
that honestly — 503 `unavailable`, "Email sign-up is temporarily unavailable. Use
Apple or Google." 1.3.0 shipped before that code existed, so it matched none of
its known cases and fell through to the generic alert. The person who hit it got
*"Could not sign in / Something went wrong. Try again."* and reasonably read it
as a broken app.

*Fixed.* The bug was not the missing case, it was the fallback: any code added
to the server after a build ships is invisible to that build, for ever. The
server already sends a human sentence in `error.message` and the app threw it
away — deliberately, because `message` is English and the app has six
languages. So the sentence is carried as `serverMessage`, set only when the
envelope really contained one and never a slice of an edge error page, and
`communityErrorText` reaches for it only when the code maps to the generic
string. A known code's translation always wins; the English appears only where
the alternative was a shrug.

Email sign-up itself reopened on 13 Aug, the day 1.3.1 went live — `EMAIL_SIGNUP`
back to `"on"`, deployed. The fallback is the part still outstanding.

### There was no way to sign up that anybody could find
*Fixed.* "How do you sign up? It only has sign in" — asked on Reddit, and fair.
The email screen hard-defaulted to sign-in mode for everyone, so a phone that
had never had an account opened a page titled **Sign in** with the only route to
registering as a link at the very bottom. The reasoning in the comment above it
— an address we remember is one that has an account — is right, and only applies
when there *is* a remembered address. Now: remembered address → sign in, nothing
remembered → Create account. Someone who turns out to have an account already
gets told so by `account_exists`, which already worked.

### Seasons draw on top of each other on a show with many of them
*Fixed.* Reported with a SmackDown screenshot and answered with "I'm fixing it",
so this one was owed to somebody. The cause was one prop: `layout={CurvedTransition}`
on each season. A layout transition animates a view from where it was to where
it now belongs, and opening a season inserts up to 120 episode rows — so every
season below it is handed a new position and, for the length of that animation,
drawn at the old one, on top of the episodes that just appeared. Three seasons
settle before the eye catches it. Twenty-eight do not, and a mid-flight
re-measure can leave them there. The rows are plain views now; the expanding
block keeps its fade, which animates opacity in place and moves nothing.

### Nobody could follow anybody from a list
*Fixed.* Seventeen accounts, 8,719 comments, 16,407 ratings — and **zero
follows**. Not apathy: following required opening somebody's profile and coming
back, from every screen that could name a person. The reconnection list was the
worst case, because it exists to say "your friends are here" and then offered
nothing to do about it.

`POST /v1/me/friends/reconcile` already selected `id` and dropped it from the
reply, so the app had a handle it could not follow. It is returned now, and both
lists that name people — the matched-friends list and the Users tab of search —
carry a Follow chip. Optimistic, rolls back if the server refuses, and does not
fetch per-row follow state: a second follow is a no-op server-side, so the worst
case is a chip that says Follow for somebody already followed. That is cheaper
than one request per row to be right about a rare case.

### Old TV Time friends still have nowhere of their own to reconnect
The matching runs, the matches are stored, and they surface in two places: the
seed screen during joining, and merged into the follow list afterwards. What is
missing is a screen of their own — somewhere to go later and see who has arrived
since. `maybeReconcileFriends` only re-runs when the friend list itself changes,
which is right for the server and means a friend who joins next year is found
quietly, by their notification rather than by looking. The Follow chip above
makes the list act; a home for it is still owed.

### A sweep for "is it in my library?" used as "do I have data for it?"
Five instances of one bug turned up in a single evening, all in the show and
episode screens: every screen was written when the only titles on it were the
user's own, so the library row was a safe proxy for having any data at all. The
community broke that proxy — most titles a person now sees belong to somebody
else — and the two questions have to be asked separately: the library row for
*your* watch state, the catalogue for *what the thing is*. 1.3.1 fixed the five
that were found by screenshot. The rest should be found deliberately, starting
where they're most likely: the movie screen reached from a film comment, the
season list on a show you don't track, and anything on a public profile that
draws a poster — public-profile list collages already fall back to name cards,
because the server's list rows carry no poster at all.

### Private profiles
Announced as absent in 1.3.0, and worth doing with follow requests rather than
alone — a private profile without them is just a hidden one. The risk it leaves
standing is somebody publishing shelves believing they're private.

### A deleted account never signs the phone out
Moderation can delete a profile server-side and the device is never told. The
sign-out only fires from the `write()` wrappers, every read swallows its error
(see the empty catch in `(tabs)/profile.tsx`), and a deleted profile answers
`not_found` — which is not `unauthenticated`, so it never reads as `needsSignIn`.
The device shows itself signed in for ever. The comment in `community-session.ts`
claiming the mismatch "resolves itself" is wrong, and should go with the fix.

### Also standing, smaller
- Lists can't be reordered — asked for on Discord, twice; TV Time had it
- Public profile Stats row has no `›` though it navigates
- `agg:title:1917|` cache keys written before the year settles
- A deliberate Arabic pass over the community screens — they were translated,
  never read end to end by someone reading Arabic

## 1.3.1 — the community's first day

Everything here was found by using 1.3.0 on the day it shipped.

### Nobody who signed up with an email could get a username
`POST /v1/me/handle` refuses an unverified session, and the claim ran the
instant the account was made — before the address was confirmed. The 403 was
caught, `false` returned, and the user kept `user_p_…` for ever: the claim only
ran at sign-in, and 1.3.0 removed the ability to sign out. Since search matches
handles, those people were unfindable by the people looking for them. Retried
now after confirmation and on every launch, which repairs accounts made before
the fix without asking anything of their owners.

### A handle had to resemble the name it came from
The slug rule kept `[a-z0-9_]` and turned everything else into an underscore —
right for spaces, wrong for whole writing systems. "محمود" reduced to nothing;
"محمود123" reduced to "123", a valid handle claimed silently on somebody's
behalf. A suggestion now needs at least one latin letter, and anything else goes
to the handle screen where the person chooses. The rule for a handle somebody
types themselves is unchanged.

### The name people chose never left their phone
`Profile → Edit` wrote to local meta and stopped. The server had accepted
`display_name` since the beginning and nothing sent it, so every public profile
showed a bare `@handle` whatever its owner had called themselves. Sent now on
edit, when the TV Time name is claimed, and as a catch-up on launch. Search
reads it too — a handle is a slug, so typing the name you know found nobody.

### Signing in with an email skipped everything that runs once per sign-in
Apple and Google reach `afterJoin()` from the join screen; the email path
reached nothing. The notification permission ask and the display-name catch-up
silently never ran for anybody who used an address.

## 1.3.0 — in development

The community layer (sign-in, profiles, comments, ratings, follows, publishing),
**OpenTV Plus**, and personalisation asked for on Reddit.

### OpenTV Plus (~$14.99/yr) — launch batch

Per the decided plan in `../opentv-plus-features.md` (the whole app stays free;
Plus funds the server):

- Deep Stats & Personality dashboard (Taste DNA, binge report, rating
  personality, watch clock)
- You vs The Crowd — your ratings vs TMDB averages, shareable Contrarian Score
- Custom app icons + themes (accent colours, OLED black)
- Unlimited custom lists + cover art (free tier caps at ~3)
- Supporter badge & flair on profile and share cards

### Personalisation

- **Choose which tab the app opens on.** Settings → App → "Opening tab":
  Profile (default), Shows, Movies or Explore. A Reddit user who mostly tracks
  shows asked to land there instead of Profile.
- **The Shows tab remembers the grid/list choice** across launches instead of
  resetting to list.

---

## 1.2.1 — released 7 Aug 2026, both stores

Five languages, plus a run of bugs found by the owner and a tester using the
app rather than reading the code.

### Languages

English, Arabic, French, Italian, Spanish and Portuguese (Brazil). 777 keys
across six files, with real plural forms — Arabic needs six CLDR categories
and the type generator had to learn them, and French puts 0 in `one` where
English does not. The layout mirrors for Arabic.

French was added late: a user left an App Store review titled "FR Language
please" and had been told publicly it was on the roadmap. Shipping four new
languages while omitting the one that was promised in public would have been
worse than shipping none.

### Fixes found on a device

- **Arabic text rendered in a left-to-right layout.** `initI18n()` resolved the
  language at startup but never applied the direction — only the Settings
  picker did. So anyone whose phone was already in Arabic got Arabic words in
  an English layout, permanently, and had no reason to open the picker that
  would have fixed it. This was the root cause of most of what looked like
  separate RTL bugs.
- **The popcorn game ran backwards in Arabic.** The pan gesture reports a
  physical left-to-right offset while the bucket is positioned with `left:`,
  which RTL mirrors — so the bucket chased the finger the wrong way.
- **Two films sharing a title were treated as one.** Adding "Amado" (2022)
  ticked "Amado" (2011) as well, and the second could never be added at all:
  `movies.name` is a primary key and the insert was silently ignored. Opening
  either one opened whichever was found first. Four places had to agree on
  "is this the same film" and none of them did — the search tick, the add, the
  route resolver and the match banner all asked "do we have a TMDB id?" when
  the question was "do we know which film this is".
- **A film matched via TheTVDB was labelled unidentified.** The match banner
  read "not matched to the movie database" above a screen showing a poster,
  genres, runtime and release date TheTVDB had just supplied.
- **Copy named the catalogue.** Messages still told users about "the movie
  database" — an implementation detail 1.2.0 deliberately stopped surfacing.
- **A tap that resolved no TheTVDB id did nothing, silently.** Six call sites
  across Search, Explore and Discover. New titles reach TMDB before TheTVDB,
  so a just-aired show cannot be tracked yet — the app now says so instead of
  ignoring the tap.
- **Movie detail came only from TMDB.** TheTVDB became the primary catalogue
  in 1.2.0 but this screen was never updated, so a TheTVDB-only film opened
  blank. It now reads runtime, genres, release date and artwork from TheTVDB.
- **Search asked one catalogue or the other, never both.** If TheTVDB returned
  anything at all, TMDB was never queried. Now the fallback runs per kind: if
  TheTVDB returned no series for a query, TMDB is asked for series.

### Known limitations

- **Search relevance, not coverage.** TheTVDB's fuzzy matching can return four
  loosely-related series for a query and none of them the right one. The app
  reads that as "covered" and does not consult TMDB. This is why a specific
  mini-series a tester wanted still does not appear. Fixing it means judging
  relevance rather than presence, which is a design change, not a patch.
- **The reorderable poster grid does not mirror under RTL.** `gridGeometry`
  computes column 0 at physical pixel 0, so the grid reads left-to-right in
  Arabic. Presentation only; it degrades to a usable grid.
- **TheTVDB-only shows still cannot be added.** The library keys shows by
  TheTVDB id. There is nothing to key on until TheTVDB lists the title.

---

## 1.2.1 — original plan: languages

The app is English-only. Every string is written inline in the component that
shows it — there is no translation layer, no locale files, and no RTL handling
anywhere in `src/`. That is the work.

### Scope

- **A translation layer first.** Strings move out of the components into locale
  files behind a lookup. Nothing user-visible changes in this step, and it is
  the majority of the effort — the app has screens dense with copy (import,
  settings, the "why some shows look empty" explainer).
- **Arabic, and therefore RTL.** Arabic is not a translation job with a
  dictionary attached; it flips the entire layout. `I18nManager` mirrors the
  system automatically, but every hand-placed `marginLeft`, every absolutely
  positioned badge, every chevron pointing forward, and the swipe-to-dismiss
  direction all need checking by eye. Budget more time for the mirror pass than
  for the words.
- **Dates and numbers.** `toLocaleDateString('en-US', …)` is hardcoded in at
  least the movie and show screens. Episode counts, runtimes and the stats
  screen all format numbers as English.
- **Store listings.** Each language needs its own listing text and screenshots
  in App Store Connect and Play Console, or the localisation is invisible to
  anyone browsing.

### Open questions

- **Which languages?** Arabic is the obvious first (the author's, and an
  underserved audience), but every added language is a permanent maintenance
  cost — each new feature needs its strings translated before release.
- **Who translates?** Machine translation of a privacy explainer is a real risk:
  the app's whole argument is trust, and stilted or wrong copy undermines it.
- **What about imported data?** Show and film titles come from TheTVDB, which
  has per-language translations (`/series/{id}/translations/{lang}` is already
  used, hardcoded to English in `tvdb.ts`). Switching that to the user's locale
  is a small change with a large effect — and a decision, because a user may
  well prefer the English titles they logged.

Nothing here is started.

---

## 1.2.0 — released (30 July 2026, both stores)

The biggest release since 1.1.8 — bug fixes, a full lists overhaul, TV Time-style
sharing, and TheTVDB replacing TMDB as the database the app runs on.

### Shipped

**Fixes**
- **Anime seasons are right again (critical).** TV Time numbers episodes the way
  TheTVDB does — that is what your export contains — but OpenTV built its episode
  lists from TMDB, which numbers them differently. TMDB files Detective Conan as
  a single 1208-episode season and Jujutsu Kaisen as one season of 59; TheTVDB,
  and your export, has 34 and 3. So anime rendered with collapsed seasons and
  watches landed on the wrong episodes.

  Shows now take their seasons, episode numbers, titles and air dates from
  TheTVDB, matching what TV Time showed you. Checked against a real export:
  388 of 389 watch rows line up exactly.

  This also removes the code that used to shuffle watch rows around to fit
  TMDB's layout — the only thing in the app that could quietly drop an episode
  rating or a character vote. Existing libraries are repaired automatically on
  update, behind a progress screen; nothing to re-import.
- **Everything else comes from TheTVDB too** — names, descriptions, artwork,
  genres and cast. Anime finally gets real characters instead of a list of voice
  actors, because TheTVDB carries character art directly (the old TVmaze and
  AniList workarounds are gone). TMDB is now called only for the three things
  TheTVDB has no equivalent for: streaming providers, similar shows, and the star
  rating. A show TMDB has never heard of now looks complete.
- **A dead key can't break your library.** Every show's data is stored on your
  device, so if the shared TheTVDB key ever stops working, nothing you already
  have changes. New imports fall back to TMDB for display only — clearly labelled
  on the show screen — and never rewrite what's stored.
- **Refresh all metadata** (Settings → Metadata) re-downloads every show's
  episodes, artwork and cast, for when something looks stale or wrong.
- **Unreleased episodes show the wait, not a checkbox.** A future episode used
  to render a mark-watched circle you could tick by accident; it now reads
  "Tomorrow" / "in 5 days" / "in 3 months", like TV Time. Episodes you've
  already watched keep their control whatever the air date says.
- **A film can't be "watched" inside and "not watched" outside.** An import
  could leave two rows for one film — the watched "Dune (2021)" and a bare
  "Dune" from the watchlist — so the grid showed one and opening it showed the
  other. They're folded into a single row now, keeping whichever holds your
  history. Genuine remakes with different years stay separate.
- **Upcoming movies actually works.** The tab was empty by design — it was
  never finished. Films you've added that aren't out yet now live there with a
  countdown, sorted by release date, and stop cluttering the Watch List.
- **Smaller download.** The metadata shipped inside the app dropped from 3.9 MB
  to 0.37 MB, since episode data now always comes from TheTVDB.
- **Episodes you never watched are gone (critical).** TV Time's per-show counter
  is unreliable — it claimed 84 watched episodes of a show whose own records
  listed one, logged seconds after following it in 2021 and dropped from TV
  Time's current data entirely. OpenTV believed the counter and invented the
  other 83. On the reference library that was 136 fabricated episodes across two
  shows. The importer now checks the counter against what the export actually
  lists and refuses to invent, and existing libraries are cleaned up
  automatically on update — episode counts may drop, and that drop is the fix.
- **Movies match far better.** The export gives a film's name and nothing else,
  so "Superman" or "Ghostbusters" matched several real films and OpenTV gave up
  on all of them — roughly a quarter of a library. The date you watched it now
  settles which one it is (you can't watch a film before it exists), taking a
  measured sample from 73% matched to 100%. Anything decided by inference rather
  than certainty is listed under Settings → **Review matched movies**, so a
  library of unmatched films is a short confirmation list instead of hundreds of
  manual searches.
- **Two films with the same name no longer overwrite each other.** "Ghostbusters"
  (1984) and "Ghostbusters" (2016) are different films; only one survived the
  import. Five were missing from a real 546-film library because of it.
- **Browser-extension exports import properly.** That format states each film's
  database id and year outright — OpenTV was ignoring both and guessing from the
  title instead. Those libraries now match exactly, with nothing to review.
- **"Stop watching" now leaves the Watch List.** Selecting "Stop watching" on a
  show archives and unfollows it, but the Watch List still queued any show with
  watch history, so a stopped show stayed put (reported by a user). The Watch
  List now excludes archived shows — they drop out immediately and live in the
  Stopped filter with their history intact, matching Up Next, the widgets, and
  the Upcoming tab, which already skipped them. Movies were unaffected (no
  archive concept — marking watched or removing already moves them out).
- **Same-named remakes no longer swallow each other (critical).** The duplicate-
  cleaner that runs after every import merged year-suffixed remakes into their
  same-named sibling whenever database identities weren't cached yet — e.g.
  "Avatar: The Last Airbender (2024)" was folded into the 2005 animated show,
  its watches dropped and its row deleted. It now refuses to fold any entry
  with real watch history unless both shows' TMDB identities are known and
  equal, and the importer persists every resolved TMDB id so that evidence
  exists from the very first import. REPAIR_REV 11 silently re-imports every
  user's preserved export on update, restoring anything the old logic ate —
  no user action, no re-upload.
- **TV Time's announced-year placeholders fold away.** An empty "(2021)"-style
  entry (0 watches, no database match) with a watched same-name sibling merges
  into it silently instead of nagging in "Needs attention" forever.
- **Real history can't be skipped by a stale deletion.** A show flagged deleted
  that still has watch rows in the export is revived at import instead of its
  history being silently dropped.
- **Fix match actually fixes.** Matching a show now re-keys it to the current
  TheTVDB id (TV Time exports often carry deprecated ids), creates the library
  row if missing, restores its watches straight from the preserved export, and
  splits candidates into Shows/Movies tabs (defaulting to Shows) so a show
  can't be mismatched to a movie by accident. Search terms strip trailing
  "(YYYY)" so the initial lookup isn't sabotaged.
- **Library search.** Shows and Movies grids have a search box — type to filter
  your own library instead of scrolling.
- **Bring-your-own TheTVDB key (optional).** OpenTV ships a shared key for show/
  movie matching; if it ever stops working, Settings → Metadata lets you add your
  own free TheTVDB key for reliable matching. Ignore it and everything still works
  via TMDB. A dismissible profile nudge appears only if the shared key fails.
- **Imports fail loudly instead of "0".** A ZIP we can't read now shows a real
  error naming the files it contained, rather than a cheerful "Import completed"
  with an empty library. Also automatically unwraps double-zipped exports (.zip containing a .zip) and matches CSV filenames case-insensitively so no valid export is dropped.
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
- **iPad rotates.** The app was locked to portrait everywhere. iPad now supports
  all four orientations while iPhone stays portrait — done with the
  iPad-specific `UISupportedInterfaceOrientations~ipad` key rather than
  unlocking `orientation` globally, which would have put phones into landscape
  too. Eleven screens read the window width at module load and kept portrait
  proportions after a rotation; they now derive their geometry per render from
  the live width. Share cards are deliberately excluded — they are captured as
  an image, so a fixed size is correct, and they are clamped so a tablet no
  longer renders an enormous card.

**Lists** — create, rename, delete; add via a real "Add shows & movies" search or
a show/movie's ⋯ → "Add to list"; remove items; **drag to reorder** (with
drag-to-edge auto-scroll for long lists). All merge-safe, so re-importing never
undoes your edits. Private lists TV Time exported without a name are kept with a
dated placeholder instead of being dropped.

**Notifications** — new-episode reminders now come with season and series
finale alerts (🔥 / 🎬), an "almost done" nudge when you're an episode or two
from finishing a season, a Friday movie-night reminder when your watchlist
isn't empty, and a come-back reminder after a week away — but only if episodes
are actually waiting. Each is separately switchable in Settings, so one you
don't like doesn't cost you the rest. All scheduled on-device; no server.

**Sharing** — TV Time-style share cards (yellow TRACKED/WATCHED card, poster,
S×E, star rating) for shows, episodes and movies, saved as a real image.

**Favorites** — a red heart badge on a favorited show/movie's banner.

**TheTVDB is the metadata source** — TV Time was built on TheTVDB and its export
keys everything on the TheTVDB id, so matching is a direct hit rather than a
fuzzy name guess, and the episode numbering is the same one your history already
uses. Shows, movies and anime all resolve there; Fix-match shows both databases;
titles say honestly how they matched. Uses our own free-tier key (attribution in
About). TMDB remains only for streaming providers, similar shows and star
ratings — everything else, Discover included, now comes from TheTVDB.

**Safety net** — the episode-numbering update keeps a verbatim copy of every
watch, rating, emotion and character vote it touches, taken before it changes
anything. It's never deleted automatically. Settings → "Undo the
episode-numbering update" puts your history back exactly as it was.

**Offline** — every tracked show's full metadata (episode names, air dates,
seasons) is pre-cached locally so the library is browsable without a connection
(staggered 25 shows/launch). You still need internet to add new titles.

**Under the hood** — extracted the tricky logic (version compare, list merge,
movie matching, import diagnostics) into a tested module (12 unit tests).


**Tablet + late fixes** — added after the 1.2.0 branch was cut, shipping in
the same release.

- **An iPad gets a proper layout, not a stretched phone one.** Poster grids
  pick up more columns at a bigger poster size on a wider screen — five or six
  in portrait, eight or nine in landscape — rather than the same three
  posters blown up to fill the width. Poster shelves, season lists and settings
  rows use the whole screen, so a tablet shows more at once instead of the same
  handful with black bars either side. Only prose stops at a readable width —
  a show's description doesn't become one enormous line on a 13" screen, while
  the rows beneath it still span the display. An iPad in Split View, which is
  genuinely phone-width, correctly gets the phone layout rather than a cramped
  tablet one.
- **The comments screen opens on a big library.** Every comment rendered at
  once, images and GIFs included, so a library with thousands of them locked
  up — the same failure as the 1207-episode crash fixed in 1.1.8. The list is
  virtualized now, and reads the table once instead of on every render.
- **Nothing in "Needs attention" is out of reach.** The list stopped at 60 and
  showed the rest as plain text, so on a large import hundreds of entries could
  not be opened or fixed at all. It expands now. Entries with no title — which
  rendered as blank rows with a FIND button that searched for nothing — are
  rejected outright.
- **The app opens on Profile** rather than Movies.
- **Hold a show to manage it.** Long-press any poster in the Shows grid for
  follow, favourite, mark finished and stop watching, without opening the show
  first — the sheet already existed, the gesture didn't.
- **Rewatch counts.** The episode list showed a bare ↻ whether you watched
  something twice or nine times; it now shows the number.

**Checked and found already correct** — no change needed: character voting saves
properly (the report was that the section never appeared, which the move to
TheTVDB fixed by giving 110 of 115 shows real character data), replies are
already marked in the comments list, and the comment-image backfill past the
first 100 is unbounded and resumable.

- **Lists fill a rotated screen.** The reorder grid was the last screen still
  sized at module load, so on a landscape iPad it drew three portrait-width
  columns with empty space beside them. It now reads the live viewport and
  picks its column count from it — three on every phone in portrait, as before,
  and up to nine on a landscape iPad, at the same poster size rather than
  three stretched ones. This was deferred because the slot geometry is read
  inside Reanimated worklets that compute drop targets, and getting it wrong
  drops a tile in the wrong slot and silently reorders a list; the drag maths
  moved to `src/pure.ts` and is now covered by tests, including a round-trip
  over every slot under both a phone and a tablet geometry.
- **A film you added by hand can't be deleted by the next import.** The
  duplicate-cleaner that runs after every import merged rows sharing a title.
  Shows got a guard for this in 1.2.0 — a Discover-added show with no watches
  yet was being folded away — but movies never did, so a film added from search
  could vanish the same way. Films holding history (watched, rated, favourited)
  or added in-app now fold only on proven identity, tracked by a new
  `movies.userAdded` column.
- **"Erase everything" now erases everything.** The pre-TheTVDB snapshot — a
  verbatim copy of every watch, rating, emotion and character vote, kept so the
  1.2.0 numbering migration could be undone — lived in its own table, which the
  erase walked straight past. A user who asked for a clean start kept their
  entire old history on disk.
- **A fix-match no longer costs a show its episode ids.** Re-keying a show to
  its current TheTVDB id deleted the `tvdbRowIds` map behind it — the TheTVDB
  episode id for every watch row, which only an import can produce and which the
  export round-trip writes back. Those ids now move with the watches.
- **An import that finished in the background tells you what it found.** An
  import cut short resumes on the next launch, but with no screen in front of it
  its summary was discarded — including the "Needs attention" list, so shows
  that failed to match were never reported. Settings now offers that summary
  until it has been read.
- **Your screen reader can read your library.** A poster is artwork with no
  text, so every tile came back to VoiceOver as an unlabelled element — the
  whole grid was unnavigable. Tiles now read out the title and how far through
  you are, spoken as a percentage, with "not started" and "finished" for the
  two ends.
- **Popcorn challenges.** The game keeps a best score; it can now dare you to
  beat it on a Saturday afternoon. Only if you have actually played, and it is
  the one reminder that starts switched off — it is an easter egg, not the
  reason you installed a TV tracker.
- **The app works in a window on iPad.** It declared itself full-screen-only,
  so Split View, Stage Manager and the window tiling controls could not resize
  it at all — iPadOS scaled it instead and clipped the edges. It resizes
  properly now, and the back button no longer hides beneath the system's own
  window controls.
- **Reordering a list no longer disturbs the items you didn't move.** On a
  tablet a list short enough to fit one row let the dragged poster travel below
  that row, into a row that doesn't exist. The app read that as "the last slot",
  and as the finger wandered the target flipped back and forth — each flip
  shuffling the posters it passed. Moving one film could quietly swap two
  others. The dragged poster now stays inside the grid, so it only ever aims at
  a real slot. Phones were never affected: their grids are tall enough that
  there is always a row under your finger.
- **A show missed by a metadata fetch is retried.** The background pre-cache
  stamped itself complete after processing its last batch even when fetches had
  failed, so a show left without episode structure by a dropped connection was
  never picked up again in the background (it still healed when opened). It now
  measures whether the shows actually got their structure, matching the check
  its sibling already used.

- **Fix match looked like a dead button.** Picking a TheTVDB entry saved
  correctly, but the yellow bar it came from was unchanged afterwards, so the
  tap read as having failed. The bar decided whether to appear from a sentinel
  value (`tmdbId = 0`) that is deliberately falsy, and took its wording from
  whether the movie had a poster — which the automatic artwork backfill had
  already supplied. Both states therefore rendered the identical bar. The bar
  now appears only while a title is genuinely unmatched, and re-matching moved
  to the ⋯ menu.
- **Matching could erase the artwork it was meant to improve.** A TMDB entry
  with no poster wrote NULL over the poster column, so a film with a perfectly
  good TheTVDB poster came back from Fix match blank. Both writers now leave an
  existing poster alone when the new record has none.
- **Two seasons can stay open at once.** Opening one closed the last, so
  comparing seasons — or glancing at the next — cost your place and a scroll
  back. The row cap moved with them and had to: shared, one "Show more" would
  have lifted it on every open season at once and mounted the thousands of rows
  it exists to prevent.
- **Pull-to-dismiss triggers on overscroll, not on arrival.** Earlier it armed
  the moment the list reached the top, which is a different event — the finger
  is still travelling downwards then, so scrolling up read as "go back".

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

**Full Local Notifications Engine & Settings UI.**
Expand on-device notifications beyond the basic backend logic:
- Add UI Toggle controls in Settings to enable/disable notifications.
- New Episode Reminders (8:00 PM on air dates).
- Season & Series Finale Alerts ("🔥 Season Finale tonight!").
- Inactivity / Re-engagement Reminders (scheduled 7 days out, auto-pushed on each app open).
- Friday Night Movie Watchlist Reminders ("Movie Night 🍿").
- Catch-Up / Almost Done Alerts ("Only 2 episodes left in Season 4!").
- High Score Popcorn Game challenges.

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

## Backlog — not scheduled to a release

> Lower-priority usability, requested, and platform items. `1.2.1` was only
> ever a branch name — everything built on it ships inside 1.2.0 above.

### Deferred

- Nothing outstanding — the deferred list was cleared.

### P1 — user-reported (beta feedback, 26 Jul)

All six issues from this report **shipped in 1.2.0** — the anime season collapse
and phantom watched episodes (fixed at source by moving episode data to
TheTVDB), refresh-all metadata, unaired-episode countdowns, the duplicate-movie
mismatch, and the Upcoming movies tab.

### P1 — correctness

- **Comments screen freezes.** Every comment renders into a `ScrollView` via
  `.map()` with no cap or virtualization. At 800+ comments with GIFs it locks
  up — the same failure as the 1207-episode crash fixed in 1.1.8. Promoted from
  P2: a hard lock-up on a real user's library is not a polish item.
- **Character voting reported as non-functional** (external reviewer). Unverified
  — needs the save path in `app/episode/[id].tsx` checked end to end.

### P2 — usability

- **"…and N more" is a dead end.** The Needs attention list caps at 60 and
  renders the remainder as inert text, leaving hundreds of entries unreachable.
- **Nameless rows in Needs attention.** Entries push `m.name` with no empty
  guard, producing blank rows with a FIND button that has nothing to search.
- **Comment-image cap.** The in-import download stops at the first 100
  (`importer.ts` `slice(0, 100)`); `downloadPendingCommentImages()` backfills the
  rest afterward, but a tester with ~5,000 comments needs that background fill
  confirmed unbounded so none stay pointed at TV Time's dying CDN.

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
