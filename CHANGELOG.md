# OpenTV — Changelog

A TV Time replacement: imports your TV Time GDPR export into on-device SQLite.
No account, no server, no ads.

Version history below is reconstructed from git; early releases predate detailed
commit history, so 1.0.0–1.1.1 are summarised from the initial commit and the
Play Console record rather than per-change.

| Version | Android versionCode | iOS build | Status |
|---|---|---|---|
| 1.6.1 | — | 39 | in development — the films TV Time left out of your lists, the backups that were deleting them, and the popcorn game |
| 1.6.0 | 48 | 38 | **released — Play 31 Aug, App Store 1 Sep 2026** — the light theme, Memories, Plex, the handle guard |
| 1.5.1 | — | — | never shipped — the handle guard went into 1.6.0, the popcorn game into 1.6.1 |
| 1.5.0 | 46 | 37 | **released 30 Aug 2026, both stores** — shared lists, Plus, profile widgets, links, translation |
| 1.4.2 | — | 36 | **hotfix, 18 Aug 2026** — opening anybody's profile crashed |
| 1.4.1 | 44 | 35 | **released 18 Aug 2026** — Google Drive backup, and profile widgets shipped dark |
| 1.4.0 | 43 | 34 | **submitted 14 Aug 2026, both stores** — Wrapped, filters, private accounts |
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


## 1.6.1 — planned

### The films TV Time never gave you back — and the backups that were deleting them

**A LIST ARRIVES WITH HOLES IN IT AND NOTHING SAYS SO.** `lists-prod-lists.csv`
stores a list item as `map[type:movie uuid:d42b395b-…]` and nothing else — no
title, no year, no poster. The importer can name one only if the same uuid
happens to reappear in `tracking-prod-records.csv`, which does carry
`movie_name`. So a film is nameable **if and only if you watched, rated or
commented on it** — and a list is mostly things you have NOT watched. That is
the whole shape of it: the entries that make a list a list are exactly the ones
that cannot be resolved.

Measured on a real export rather than guessed. One list, `avenger`, 22 films:
**8 resolvable, 14 not.** The 14 are the MCU running order — The Incredible
Hulk, The Avengers, Iron Man 3, Thor: The Dark World, The Winter Soldier, both
Guardians, Age of Ultron, Ant-Man, Civil War, Black Panther, Ant-Man and the
Wasp, Infinity War, Endgame. Films anybody would recognise, and the app could
not name one of them. What the owner saw was eight films in an order that made
no sense, because every film that explains the order was missing.

**IT IS NOT AN IMPORTER BUG, and that had to be established before building
anything.** Another developer's importer read the same file with completely
different code and resolved the same 8. The information is not in the export.
TV Time kept those titles server-side and did not put them in the ZIP.

### THE EXPORTER WAS DELETING THEM, and that is the more serious half

`exporter.ts` wrote a custom list from `items` only. The unnamed films were not
in `items` — they are held separately as raw uuids — so **every backup and
every "export my library" dropped them**, and `totalCount` was recomputed from
the survivors, so the result looked correct. Restore from that backup and the
list is permanently shorter, with nothing to indicate anything was lost.

Measured on the author's own phone: a 22-film list stored as
`items=8, totalCount=8, unresolved=0`. Two round trips through our own export
and a 22-film watch order is 8 for ever. That is data loss in the one file
whose entire job is to be a safe copy, and it predates this feature entirely.
The unnamed films are now written out in TV Time's own
`map[type:movie uuid:…]` shape, so they survive a round trip and can still be
named afterwards.

### Where the names come from

**A CATALOGUE THE SERVER ALREADY HOLDS.** `movie_uuids` carries 13,355
`uuid → title` rows with TMDB and TheTVDB ids where they are known. The phone
asks `POST /v1/movie-names/resolve` in batches of 200, and a failed batch does
not abandon the rest.

**WHAT LEAVES THE PHONE IS THE SAFE HALF.** The request carries the uuids of
films the owner **listed and never watched** — unauthenticated, no token, no
profile id, and the same answer comes back for everybody who asks about the
same film. It cannot describe what anyone watched, which is the thing this
server refuses to hold, and that is what lets it run for somebody who declined
the community: no account is involved and nothing in it is about them.

The alternative was downloading the whole catalogue and matching on-device —
no question ever sent, but 474 KB gzipped per phone for a screen most people
open once. The uuids of unwatched films were the cheaper thing to give up.

**THE IDS TRAVEL WITH THE TITLE.** A name alone makes every screen SEARCH for
the film: the detail screen draws its first guess, then corrects itself when a
better match lands, which reads as the app malfunctioning. An id settles it
before anything is drawn. They are sparse across the catalogue (9% TMDB, 2%
TheTVDB) but dense where it matters — 13 of the 14 films in the real list
carried one.

Two consequences of that, both found on a device:

- the list tapped through on `item.tvdbId ? show : movie`, which was correct
  while only shows carried an id. A restored film carries a TheTVDB **movie**
  id, and the same number is a different title in the two databases — so
  tapping Guardians of the Galaxy would have opened an unrelated series. It
  routes on `kind` now;
- `fillMissingListNames` repairs SHOWS, because a list stores a series as a
  TheTVDB id. Films had no name to search on and so had no equivalent, and a
  restored film drew as a grey card with two letters on it. `fillMissingList
  Posters` fetches by id where there is one and falls back to the same
  two-database title search the rest of the library uses.

### Reaching the people who already have the app

**THEIR LISTS DO NOT MERELY LACK NAMES, THEY LACK THE UUIDS.** The older
importer dropped an unresolvable entry outright, so there is nothing to ask the
server about and the banner correctly offers nothing. Without this step the
whole feature works perfectly for new imports and is invisible to every
existing user — the failure mode that is hardest to notice.

`rebuildImportedListsFromZip` reads **one 50 KB csv** back out of the preserved
export. The obvious alternative was a `REIMPORT_REV` bump, and it was wrong: it
re-runs the entire import behind a blocking overlay, which on a real library is
a long wait imposed on everybody to recover a single file.

Three things it gets right that the first attempt did not, each found on a real
phone rather than in the simulator:

- **the export is usually not in `Documents`.** On a phone with iCloud backup it
  lives in the iCloud container as `TV Time Original.zip`. A version that read
  only the local path returned 0 on exactly the devices that most needed it,
  silently, looking like "nothing to recover";
- **which uuid is missing cannot be answered, so it does not try.** A stored
  item carries no uuid to match against, and the obvious guess — take the last
  n to make up the shortfall — is wrong in the ordinary case: on the real list
  the nameable films sat at positions 1–4, 6, 16, 17 and 19, scattered rather
  than clustered. It hands back ALL of them and lets the naming step drop the
  duplicates;
- **the done-marker is versioned, not a boolean.** The first version stamped
  itself finished after finding nothing, and every later fix then skipped,
  because a plain flag cannot tell "I finished the job" from "I gave up before
  I could do it".

It runs from the Profile screen's focus effect rather than the launch chain.
That chain is one long `await` sequence behind `runAfterInteractions`, and
anything throwing earlier in it skips everything after with no error anywhere —
which is exactly what happened, through two builds, while it looked like the
code was not deployed. Put where the result is used, it either works or is
visibly broken.

### What the user sees

**A NEW IMPORT REPAIRS ITSELF ON THE WAY IN**, before Lists is ever opened, and
the artwork is fetched while the progress screen is still up — a list that
opens full of grey cards reads as broken however correct it is.

**EVERYBODY ELSE GETS A STRIP ON THE PROFILE**, in the shape the other notices
use: *"14 films in your lists have no name."* It is the only banner in that
stack that is **not dismissible**, because unlike the invitations around it, it
describes something already wrong that one tap repairs — a fix nobody can find
again is worse than a bar somebody sees twice. It removes itself by being used.

It says what it ADDED, not what it named. The recovery hands back every uuid in
the list, so the ones that resolve to films already present are answered but
not added — counting those made it claim "Restored 22 films" over a list that
gained 14, which is a number a user can check.

"Nothing found" is a real answer and does not read as a failure: the catalogue
does not have every film, and the strip stays so it can be tried again.

### The counter, because a public endpoint is otherwise invisible

`counters` holds `list_repair_calls` and `list_repair_films`, and the dashboard
shows both beside the catalogue size. **Films is the number that matters** — a
call that resolves nothing still counts as a call, so calls alone would read as
success. Two numbers and no row per request: no ip, no user agent, no profile
id. This table cannot answer WHO or WHICH films, because no such column exists;
a public endpoint that logged per-request would have become a record of who is
repairing what.

The app's own event carries the same two counts and no identifiers. Note that
`analytics.ts` is gated on community consent, so people who never joined are
absent from it — and they are a large share of who this helps. The app-side
number is a floor, not a total; the server counter is the honest one.


### The popcorn game, and a shuffle button beside it

**Where it goes is the whole idea.** Startup repair is the one place in this app
where somebody waits with nothing to do: a big library re-importing can hold
that progress overlay for minutes, and right now the only thing to look at is a
number going up. That is the Chrome dinosaur situation exactly — a wait nobody
chose, on a screen that otherwise just asks you to watch it. Popcorn belongs to
a TV app the way a cactus belongs to a browser with no connection.

Not a menu item, not a settings easter egg. A game nobody stumbles into is a
game nobody plays, and it becomes code that is maintained for ever for the few
who find it. If it is not on the waiting screen it should not be built.

**Test the frame rate FIRST, not last.** The repair overlay runs while
`migrations.ts` is working through the library, and that work is on the JS
thread — the same thread a naively built game would animate on. A game that
stutters exactly when it is meant to distract you is worse than the progress bar
it replaced. So the first commit is a spike: can it hold a steady frame while a
real re-import runs? Reanimated on the UI thread, or a canvas driven off the JS
loop, are the two answers worth trying. If neither holds up, the feature is a
progress bar and that is a fine thing to be.

**Held back twice, then built.** It was cut from 1.5.0, which was already
carrying shared lists, Plus, widgets, links, translation and three importers,
and again from 1.6.0, which took the light theme, Memories, Plex and the handle
guard.

**THE FRAME LOOP RUNS ON THE UI THREAD, and that decided the shape of every
file.** The rules live in `games.ts` as pure functions marked `'worklet'` — no
timers, no components, no drawing — so `useFrameCallback` can tick them from the
UI thread while the repair blocks the JS one. The board is drawn by
`useAnimatedStyle` reading shared values, from a FIXED POOL of views moved
rather than created: mounting a view per snake segment would put React renders
back on the thread that is busy. Only the score crosses the boundary, and only
when it changes.

**TWO GAMES AND ONE SHUFFLE BUTTON.** Snake eating popcorn, and a catch game —
popcorn falls, a bucket slides, three misses ends it. The button cycles rather
than opening a picker: two games do not justify a menu, and a menu on a waiting
screen is one more thing to read.

Two rules worth writing down. **The walls wrap** — a game that ends because
somebody glanced away is a punishment on a screen they are already stuck on. And
the snake is `colors.brand`, never `colors.yellow`: that token becomes INK in
the light theme, and a board of black squares is a redaction rather than a game.
The same trap that made every progress bar black in 1.6.0.

The 17 tests are not ceremony. This runs inside the animation loop of an app
that is mid-repair, so a crash there is not a caught exception in a screen — it
is a frozen phone with an unfinished library on it.

---

## 1.6.0 — released: Play 31 Aug, App Store 1 Sep 2026

### A light theme, because somebody who pays for this asked for one

**IT CAME FROM A COMPLAINT, not a roadmap.** A subscriber said the dark
interface was "kind of difficult" for them. An app whose whole pitch is that
your library belongs to you should not be one you have to squint at, so this
is free and always will be — it is legibility, not decoration, and that is why
it sits in Settings rather than behind Plus with the accent and OLED black.

**ONE CONTROL, THREE ANSWERS.** Settings → App → Theme: Light, Dark, or Device.
There used to be a row here that said "Dark mode / Light theme arrives later"
and did nothing when tapped, and for one build the light theme shipped as a
SECOND switch further up — two controls for one setting, and the state they
could disagree in was the bug. There is one now.

**Device required a native change**, and it is worth writing down because it
looked like a JS bug for a long time. `UIUserInterfaceStyle = Dark` was pinned
in `Info.plist`, which makes `Appearance.getColorScheme()` answer with the pin
rather than with the phone — so "follow my device" could never work no matter
what the JavaScript did. The pin is gone. Native chrome — keyboards, alerts,
share sheets — now follows the app's own theme through a runtime override set
AFTER the system value is read, because doing it the other way round has the app
ask itself what the phone is set to and believe its own answer.

**THE SURFACE STACK RUNS THE OTHER WAY ON PAPER.** On black, a card rises above
the page. On white, a white card on a white page is nothing at all — the
provider tiles on the episode screen simply disappeared. So each surface now
SINKS below the page instead: `bg` #FFFFFF, `panel` #FAFAFA, `card` #EFEFF2,
`raise` #E5E5EA. Two cards that were painted with the page colour on purpose —
black on black, read by their shadow and their thumbnail — sink only in light,
so dark is byte-identical.

**THE ACCENT BECOMES INK, AND THAT IS THE WHOLE TRICK.** `colors.yellow` is
black in the light theme, which turns every filled CONTROL into black-on-white
and covers 244 call sites in one line. It is also the source of every bug in
this release, because a control is not the only thing that gets filled:

- a PROGRESS BAR is a surface reporting a status, and ink made every show still
  being watched a black stripe. `progressColorOf` paints the bar on every poster
  in the app, so one function was wrong everywhere at once;
- a full-width NOTICE BAR is a surface too, and a black stripe across the top of
  a white page reads as an error rather than a notice;
- a POLL ANSWER records what somebody thought and does not do anything, so the
  emotions and the interests now wear the brand like the rating stars beside
  them always did — with `onBrand` for the label, because an accent pulled out
  of artwork can be pale and white on pale is the failure that pairing exists to
  prevent.

**AND TEXT ON A PICTURE IS NOT TEXT ON A PAGE.** Show titles, film titles, the
episode code, the back arrow, the ••• menu, the match percentage, the badge on a
similar-show poster — all were painted with the page's ink while sitting on
artwork, which on paper is black on a photograph. They take `onArt`, which is
white in both themes because over an unknown image only one colour is ever safe.
This class of bug appeared three times in three screens before it was swept for
deliberately.

**The launch splash follows the phone** — white on a light device, black on a
dark one. Done in the iOS asset catalogue directly rather than in `app.json`,
because prebuild is not safe in this project; `app.json` carries the same change
so the Android build EAS regenerates matches.

### Memories, and "On this day"

**A memory is a fact about today, not an inbox item.** One line at the top of
the profile — "seven years ago today you watched six episodes of Game of
Thrones" — drawn as one of the full-bleed strips this screen already uses for
iCloud, backup and Discord, because that is what it is: something to glance at
and put away. It went through a padded card and a notification row first; both
were shapes this screen does not otherwise use.

Tapping it opens what it names — an episode memory opens the EPISODE, not the
show — and puts it away until tomorrow. What is stored is the DATE it was
dismissed, never a flag: tomorrow is a different memory and has to arrive on its
own, and the stamp is the phone's own day rather than UTC's, which would roll it
over hours early for anyone west of Greenwich.

**Memories** (••• → Memories) is the page behind it. It leads with **ON THIS
DAY** in the strip's own words, then everything else as a dated archive — and
that split is the difference between this and an activity log. A flat list of
dates is a log. What makes a memory a memory is the coincidence of the date.

It is in the ••• menu and not under Stats on purpose: Stats is the library
MEASURED, and it is the screen whose sections a profile publishes. A memory is
built from watch history, which never leaves the phone.

The evening notification now carries `data: { kind: 'memory' }` and lands on
Memories. Without it the notification carried nothing, so the router saw no
kind and returned — the app opened on whatever tab it opened on, which is
indistinguishable from routing being broken.

### Plex, and why not Trakt

**Trakt was built first and works.** Every item it returns carries a TheTVDB id,
so matching is a lookup and never a title guess — a fuzzy match that ticks the
wrong episode corrupts the one thing this app exists to protect. Then Trakt made
registering an OAuth application a VIP feature: `401 invalid_client`, and a paid
gate in front of something this app gives away.

**Plex has no gate.** A client generates its own identifier and asks for a PIN —
no registration, no approval, no fee, verified against the live API before any
of it shipped. And it keeps the property that made Trakt safe: library items
carry GUIDs like `tvdb://121361`. `tvdbIdFromGuids` accepts `tvdb://` and
nothing else, so a show Plex matched to TMDB instead has no id, is absent from
the map, and its episodes are dropped before the decision layer sees them.
`tmdb://1399` returning null has its own test, because 1399 is Game of Thrones
on TMDB and something else entirely on TheTVDB.

Every refusal — season 0, untracked shows, already-watched, duplicates within a
batch — lives in `externalWatchesToApply`, shared with the Trakt path and
renamed because it never knew which source it was deciding about. A scrobbler's
failures are silent and cumulative: a duplicate tick looks like nothing on
screen while every total, streak and chart drifts.

Syncs once per launch, costing nothing at all for anyone who has not connected
it, and stops at the first row older than its watermark. Trakt's modules stay in
the tree; only its screen is gone.

### The startup repair could greet you for ever

`originalZipBytes()` answered `null` — "not available right now, retry later" —
for a device with no preserved export AND no iCloud. That condition never
changes, so the revision was never stamped and **"Updating episode data…" ran on
every single launch**, for every user with iCloud Drive switched off. Three
attempts and it settles, with the budget scoped to one `REPAIR_REV` so a later
bump gets fresh tries rather than inheriting a spent one.

### Your TV Time name: one export, one profile

Claiming a handle has always been first come, first served. `claimImportedHandle`
reads the username out of somebody's GDPR export and asks for it; if it is free
they get it, and **nothing checked that the person claiming `@amanda` was the
Amanda who wrote nine years of comments under it.** The export carries a
`tvtime_user_id`, the server has had a column for it since the first migration,
and no route compared the two.

The claim now sends that id, and `POST /v1/me/handle` refuses one already held
by another live profile. It is recorded write-once and only after the handle is
actually won — `reconcile.ts` writes the same column the same way, so whichever
lands first wins and the other is a no-op.

**WHAT THIS DOES NOT DO, said plainly because it is easy to oversell.** An id
proves you hold an export, not that you are the person in it: somebody who
imports a friend's export passes this as easily as its owner. Handles claimed
before this shipped have no id recorded and are grandfathered, unverifiable
either way. Somebody whose TV Time account is already gone has nothing to prove
anything with.

What it does fix is the cheap version of the attack — one export used over and
over to take name after name. A squatter now needs a distinct real export per
name, which is the difference between a script and a project. That mattered
little at 75 accounts; it matters the day this is where TV Time people are
moving, because the names worth squatting are exactly the recognisable ones and
the person who loses their own name has no way to appeal.

The honest description of the outcome is "your old name is claimed automatically
if it is still free" — not "your identity is protected", and the marketing copy
should say the first one.

A deleted profile's id is ignored on purpose: somebody who deleted their account
and signed up again is the same person with the same export, and holding their
own id against them would lock them out of their own name for ever.

### Fixes

- **The interests poll never saved anything.** Reported from the outside, with a
  screen recording. It wrote React state and nothing else, so an answer lasted
  exactly as long as the screen did — on shows and on films. Nothing looked
  broken, which is why it went unnoticed: a tap that means nothing looks the
  same as a tap that means something. Stored per title now, with the trap under
  test: a cleared answer is `''` and `Number('')` is `0`, which is a real option.
- **The artwork picker was pulling a quarter of a megabyte to show forty
  pictures.** `extended?short=false` returns every artwork a series has — 746 for
  Game of Thrones, 544 for Adventure Time, 247–325 KB. The dedicated endpoint
  filters server-side: 44–53 KB. The poster picker calls it twice, so it was
  fetching ~600 KB for one screen.
- **The GIF picker could not see all your shows.** It was borrowing
  `artworkChoices()`, which requires a stored poster and caps at 300 — correct
  for choosing ARTWORK and wrong for choosing a search term. A show was hidden
  from it for having no poster, which has nothing to do with whether GIPHY can
  find a GIF of it.
- The Edit pill on the profile was the only piece of cover chrome ignoring the
  profile theme, with a black ring around white text.

---

## 1.5.1 — never shipped, split into 1.6.0 and 1.6.1

### Your TV Time name, and whether anybody else can take it

**WHAT HAPPENS TODAY, and it is weaker than it sounds.** `claimImportedHandle`
reads the username out of somebody's GDPR export and asks the server for it the
moment their account exists. If it is free they get it, and their old name
follows them across. If it is taken — by anyone, for any reason — the claim
fails and they are sent to `/handle` to choose something else.

So the rule is **first come, first served**. Nothing checks that the person
claiming `@amanda` is the Amanda who wrote nine years of comments under it. The
export contains a `tvtime_user_id`, the server has a column for it, and no
route compares the two.

That has not mattered yet at 75 accounts. It matters the day OpenTV is the
place TV Time people are moving to, because the names worth squatting are
exactly the ones people would recognise — and the person who loses their own
name has no way to appeal it. There is no support flow for "that was mine".

**THE FIX IS SMALL AND THE POLICY IS NOT.** Technically: record
`tvtime_user_id` on the profile at claim time and refuse a handle whose
`tvtime_user_id` is already held by a different id. The questions underneath it
are harder and want answering before any code:

- somebody who imports a friend's export, or a scraped one, would pass this
  check as easily as the real owner — it proves you hold an export, not that
  you are the person in it;
- names claimed BEFORE this ships have no id recorded, so they are grandfathered
  and unverifiable either way;
- and a person whose TV Time account is gone has nothing to prove anything with.

Worth doing, worth not overselling. The honest description of the outcome is
"your old name is claimed automatically if it is still free", not "your identity
is protected" — and the marketing copy should say the first one.

## 1.5.0 — planned

**Read this section against the code before acting on it.** Four of its bug
entries were already fixed when it was next opened — the join screen, the watch
region, the nameless profile and the watch-date editor — and two of those were
fixed by mechanisms other than the ones proposed here. A plan written before a
release describes the app that existed when it was written. Verify, then fix.

The release that can take money, and therefore the one the store paperwork
gates rather than the code: the Paid Applications agreement, the Play payments
profile and the RevenueCat products all live outside this repository and nothing
here starts without them.

### Shared lists — written, on the `shared-lists` branch, not merged
A list two people build together. Both add to it, both tick things off, and
every row says who suggested it — which is the part that matters, because a bag
of titles nobody is attached to is a bookmark folder and "Sara added this" is
why somebody opens the app on a Tuesday.

**The paywall is on the door handle, not the door.** Past the first list,
starting one needs Plus; JOINING never does, at any tier, for ever. That is the
whole design rather than a kindness: a list whose invitees must pay to accept is
a list of one person, and the member who paid has bought an empty room. One
subscription pulls three people into the app and they meet the feature by using
it.

It is also **the first table this server owns** — every other one mirrors a
phone. Two people write to one list, so neither copy can be authoritative
without silently eating the other's edits. That stays inside the rule rather
than breaking it: the rule is about a user's own library, and a list two friends
build together was never one person's private history.

### ~~Where to watch~~ — SHIPPED, see 1.4.0. Region comes from the phone's locale
(`watchRegion()` in `show-meta-fetch.ts`), with a stale stamp forcing the refetch.
Left below for the reasoning, which is still the reasoning.

### Where to watch — reported from Discord, twice by the same person
Three findings from one message, and the reporter was right about all three even
where the diagnosis was off.

**The settings button beside "Where to watch" does nothing.** A bare `Ionicons`
with no `Pressable` and no handler — the same shape as the `+` in People also
watched that the same person reported this morning. Two of these in one file
tree means the rest should be looked for deliberately rather than waited for: a
sweep for icons that look like controls and are not.

**The streaming list is not stale, it is American.** The region is hardcoded:

```
providers: d['watch/providers']?.results?.US?.flatrate
```

So everybody, everywhere, is told their show is on fuboTV and Peacock. The fix
is a watch region taken from the phone's own locale, with the dead settings
button finally opening the picker that changes it. (The suggestion to switch to
JustWatch would change nothing — TMDB's provider data *is* JustWatch, licensed.
What is missing is the country.)

**And only `flatrate` is read**, so a film you can rent, buy, or watch free with
adverts reads as "not available to stream" — a different and much more
discouraging sentence than the truth.

Two smaller things from the same message, both nearly free because the data is
already here: **provider logos instead of a text list** (the logos are already
stored, and the "where did you watch" tiles already draw them), and **a trailer
thumbnail** that opens the official video — TMDB's `/videos` marks trailers
`official: true`, so filtering on it gives exactly the safety asked for, the
studio's own channel rather than a reupload wrapped in adverts.

Changing region needs a refetch, since providers are cached inside each show's
metadata. `showMetaIsStale` gains a region stamp — the same mechanism that
healed `personId` on the day the actor page shipped.

### Live translation of comments
A comment written in Arabic gets a Translate row for a French reader, and taps
into French. In-app, on demand, per comment.

**On Cloudflare Workers AI**, which is the whole reason this is two days rather
than a project: the comment is already sitting on this server, so translating it
here sends nothing anywhere new — which would not be true of Google Translate or
DeepL, where every comment would leave for a third party to bill us for. Cached
in D1 by (comment, language), so each one is translated once per language ever
and the running cost stays near zero.

Six languages shipped and no way to read across them is the gap somebody was
always going to point at.

### A web page for a profile
`theopentv.com/@handle` — the published shelves, lists and stats that are
**already on this server**, rendered as a page. No sync needed and no new data:
that shelf was published for exactly this kind of reading.

Built for the funnel rather than for a feature table: sharing a profile with
somebody who does not have the app currently shows them nothing, which is a
strange thing for the one screen designed to be shared.

### A real web app — after sync, and only after
The browser has no SQLite on somebody's phone to read, so a web client that
shows YOUR library cannot exist before sync does. The order is forced.

And when it comes, it decrypts **in the browser**, with the user's own key —
the way Proton and Standard Notes do it. Anything else would mean the server
reading what it has spent this entire project not reading, and a web app is not
worth that.

Plus-only, which costs nothing on the comparison table: locked features score
the same as open ones there.

**A note on ordering.** Building this against sync that has never run in anger
is how a bad sync design becomes permanent — the web client is a second consumer
that freezes the format. If 1.5.0 gets heavy, this is the piece to move.

### Comments and likes on lists — an idea, not a commitment
A list is currently something you look at. With a thread on it, it becomes
somewhere you go back to — which is the gap the server data says matters most:
**38 accounts, 9,877 comments, and zero likes and zero follows ever recorded.**
Both paths were checked end to end and both work. Nothing in the app puts two
people in the same place, and a list with replies on it is the cheapest place
that could ever happen.

Free, at every tier. The rule the whole tier is built on is **charge for
creating, never for participating** — joining a shared list is free forever for
the same reason, and commenting on an episode is already free, so charging for
the identical action on a list would price the same tap differently depending on
which screen it happened on. The paid line on lists stays where it is and is
about REACH, not participation: how many lists get published, how many shared
lists get started, list covers.

**Most of it already exists.** `comments` is keyed by `(target_source,
target_key)` and `comment-thread.tsx` takes a `ThreadTarget`, so adding `'list'`
as a source with the list id as the key inherits replies, comment likes, spoiler
hiding, reporting, blocking, editing, moderation and the admin dashboard for
nothing.

The one real cost is a migration: `target_source` carries
`CHECK (target_source IN ('tvdb','tmdb','title'))` and SQLite cannot alter a
CHECK, so the table has to be rebuilt — create, copy, drop, rename. Routine at
this size, and the only part worth being careful with.

A like on the LIST itself is separate and equally small: one table and a count,
the same shape as `comments.like_count`.

### "On this day" — the one that gives a reason to open the app
A tracker is opened to mark an episode and then has no reason to be opened
again until the next one. It reacts; it is never a habit.

So: a memory from the same date in the user's own history.

> A year ago today you finished Dark. Last episode, 2am.
> Four years ago you watched 7 episodes in one day. It was a Friday.
> On this day two years ago you wrote: "I can't believe what just happened"

**Nobody else can build this.** Trakt and Letterboxd do not have anybody's TV
Time past. This app holds 33,133 ratings and 9,877 comments with their ORIGINAL
dates, imported from a service that no longer exists. It is the one thing the
import pipeline bought that no competitor can copy.

**It works on day one with no second person**, which is what every social idea
on this page fails at — 38 accounts and zero follows means anything needing a
friend converts nobody. This needs only the user's own archive.

**Local, and therefore for everybody.** Same machinery as `notifications.ts`,
computed on the device from its own SQLite. No server, no account, nothing
leaves the phone — so the people who declined the community entirely, who are
most users, get it too.

Free, and never Plus. It shows a person their own past, on their own phone,
and charging for that breaks the rule the whole app stands on. It is also built
to LEAVE the app, exactly like Wrapped: the card is what somebody screenshots.
Plus paints it in the profile theme and everyone else gets OpenTV yellow —
the precedent Wrapped already set, so no new decision is needed.

**Four rules that decide whether this is loved or muted in a week:**

1. **The notification carries the memory, it does not promise one.** "A year
   ago today you finished Dark" is worth reading even untapped. "You have a
   memory, open the app" is not.
2. **Not every day.** Most days hold nothing. A daily notification is six weak
   ones for every good one, and the six are what get it turned off. Fire only
   on a real event — a finale, a day with five or more episodes, a comment, a
   round-numbered anniversary. In practice that is roughly fortnightly, and
   every one of them earns its place.
3. **Evening, not morning.** People decide what to watch at nine at night.
4. **Its own switch**, separate from episode alerts. Wanting to know an episode
   aired and wanting to be reminded of three years ago are different people.

### "I have 45 minutes", and a Today screen — the same screen, not three
Both were considered as features and both are really the same question as the
memory card: *what do I do right now?*

- **"I have 45 minutes"** — pick the time available, get what actually fits.
  A 22-minute episode, two of them, a short film. Runtimes are already stored.
- **Today** — what aired across followed shows, and what was missed.

**None of these gets a new screen or a new tab.** The app already has the place
that answers "what now": the Watch Next tab is the first thing anybody opens.
Today is what that tab should already be, the time picker is a control on it,
and the memory is a card on it.

This is worth stating as a rule, because the app is at the size where it starts
to sprawl: **a new idea either replaces something, or it lives inside a surface
that already exists.** Three ideas that arrive as three tabs is how a tracker
becomes a menu. The same three inside the screen people already open is how it
becomes a habit.

### Import from Trakt, Simkl and Letterboxd — the only idea here that fixes distribution
Everything else on this page makes the app better for people who already have
it. This is the only one that goes and gets more of them.

The TV Time importer reaches people whose app **died**. A Trakt or Simkl or
Letterboxd importer reaches people whose app is **alive and annoying them** —
and there are millions of those, they exist right now, and they ask about
alternatives every week in their own subreddits. The bottleneck is not features,
it is 613 store visitors in a month.

**The expensive half is already built.** `importer.ts` is a parser, a merge-safe
writer and a self-repair pass, and none of that cares where the rows came from.
What a second source needs is a mapper into the same shape. Trakt's API app is
already registered with a device-code flow, parked since July.

**It is also a release with a headline**, which almost nothing else here is:
"move over from Trakt in one tap." That is a sentence that can be posted in
r/trakt, r/Simkl and r/letterboxd — three large communities this app has never
reached, where a link to an importer is help rather than an advert.

Letterboxd is the odd one out and the easiest: it exports plain CSV, no OAuth,
no API key, no rate limit. Films only, but it is an afternoon.

Order by cost, not by size of audience: **Letterboxd (CSV) → Simkl (JSON export)
→ Trakt (OAuth device code)**.

### ~~A profile can be born nameless and stay that way~~ — MOSTLY FIXED, by a
different mechanism than the one proposed below: `retryHandleClaim()` runs from
`_layout.tsx` on EVERY launch for EVERY provider, so a `user_p_…` account is sent
back to the handle screen until it picks one. What is still true: `claimImportedHandle`
reads only the TV Time import name, and `community-auth.ts` never touches the
provider's. Somebody who signed in with Google and never imported has nothing to
claim, so they meet that screen every launch, for ever. THAT is the ten-line fix.

### A profile can still be born nameless, and go on being used
Two of the first forty accounts are called `user_p_79fbc76e` and
`user_p_2fdcddb4`. One of them has **3,242 ratings, 13 comments and an uploaded
GIF** — an active user whose public profile is a hex string.

Every profile is born with a placeholder by design: `pure.ts` refuses to invent
a pretty name server-side, because the user picks it and a taken one must be
refused. The app then repairs it on the way in — `claimImportedHandle()` takes
the TV Time username out of the import and claims it, and for thirty-eight of
forty that worked silently.

**Why it fails, and it is usually not "the name was taken."** The username is
read from `routing-prod-users.csv`, which exists only in the **official GDPR
export**. The third-party browser-extension export — `tvtime-series.csv`,
`tvtime-episodes.csv`, `tvtime-movies.csv` — has no such file, so there is
nothing to claim and the screen is the only route left. There are three ways to
land on a placeholder and the interesting one is invisible from the dashboard:
no username in the import, the name already taken, or any network error at all
(the `catch` swallows every case identically).

**But the actual hole is that the screen can be walked away from.** The server
already answers this question — `needsHandle()` exists for exactly this — and
the app consults it **only on the email path**. Apple and Google sign-in never
check it again after joining, so killing the app on the handle screen and
reopening leaves somebody free to comment, rate and publish a profile for ever
under a hex string.

Two fixes, and the second is the one that matters:

- **Fall back to the provider's display name.** Apple and Google both hand over
  a full name, and `suggestedHandle()` already turns "Mahmood Bashar" into
  `mahmood_bashar`. That reduces the case to people who declined name sharing.
- **Make the handle a precondition of anything social**, checked in one shared
  place rather than on one sign-in path. A single call, on the route that
  already knows the answer.

Until it ships those two can still repair themselves: `community-prompt.ts`
pushes them back to the handle screen. Nobody is stranded — they just look like
a bug to everyone who sees them.

### ~~The join screen can push its own buttons off the bottom~~ — FIXED. `join.tsx`
line 145 carries `style={{ flex: 1 }}`.

### The join screen can push its own buttons off the bottom of the phone
Reported on Reddit, and worth reading in the reporter's words because they
described the mechanism without knowing it:

> "I didn't see continue with Apple or Google, I didn't see those buttons.
> Maybe I overlooked it because the app kept jumping — it was hard getting to
> sign up at the bottom but it kept going back to the top. I got frustrated."

Both halves of that are one bug. The provider buttons live in a `View` **below**
the `ScrollView`, not inside it, and the ScrollView carries only a
`contentContainerStyle` — **no `style={{ flex: 1 }}` of its own.** A ScrollView
without it takes the full height of its content, so on any phone where the
content runs long — a longer translation, large accessibility text, the
"last signed in" card being present — it expands and pushes the entire action
row past the bottom edge. The buttons are rendered, reachable by nothing.

And the snapping back is the second half: `contentContainerStyle` is
`{ flexGrow: 1, justifyContent: 'center' }`, which re-centres the content the
moment it overflows, so a scroll gesture returns to where it started.

One line fixes both:

```jsx
<ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
```

**This is the only door into the community**, which makes it the most expensive
screen in the app to get wrong. One person was annoyed enough to write it down.
Nobody knows how many hit the same wall, decided the app was broken, and said
nothing — and the answer to "why does nobody join" might partly be this.

Worth a sweep afterwards for the same shape: any `ScrollView` with a sibling
pinned below it and no `flex: 1` on the scroller.

### ~~Editing when you watched something~~ — SHIPPED 16 Aug (`6bca586`). A month
calendar on the mark-as sheet, `setEpisodeWatchDate` / `setMovieWatchDate` in `db.ts`.
`markWatched` still writes now, deliberately: you mark, then correct.

### Editing when you watched something
`markWatched(showId, season, episode)` takes no date. It writes "now", always,
and there is no screen anywhere that changes it afterwards.

Which is a hole in the one promise this app is built on. "It remembers the day
you watched it" is the line on the store listing, in the launch posts, and in
the import that rescued nine years of somebody's dates to the day. Then someone
watches three episodes on Friday, opens the app on Sunday, and the app writes
Sunday — quietly making the archive it just rescued less accurate than the
export it came from.

Every serious tracker has this, and it is regularly the top request on their
forums. Simkl called editing watch dates one of its most requested features.

**Small:** an optional date on `markWatched`, and a date picker on the
`mark-as` sheet that already exists and currently offers only "Rewatched".

### The emotion calendar — the largest thing on this server that nothing reads
There are **57,287 emotion votes** in `episode_emotions` and **36,377 ratings**.
People recorded how something *felt* more often than they recorded how good it
was — and ratings appear on every screen while emotions appear on none.

The app already asks "how did this episode make you feel?" and stores the answer
against twelve values: shocked, frustrated, sad, reflective, touched, amused,
scared, bored, understood, thrilled, confused, tense.

**The calendar is that question read backwards.** Join `watches` (when) to
`episode_emotions` (what it felt like) — two tables nobody has ever put together
— and a year becomes a grid of days, each carrying the feeling of what was
watched on it. Tap a day, get the episodes and the feelings.

The app answers *"how did this episode make me feel?"*. This answers one nobody
has asked: **"what was my year like?"** — and "February was all sad" means
something to the person it belongs to, computed from marks they made years ago
inside an app that has since died.

**No competitor can build this**, and not because it is hard. They do not have
the data. TV Time collected it and took it down with them; this app imported it.

The form is already proven — the same grid as the history field drawn across the
three launch posts, coloured by feeling rather than by density.

**FREE TO SEE, PLUS TO SEARCH.** The calendar and its shareable card are free,
for the same reason Wrapped is free: it is built to LEAVE the app, and charging
for that is charging for your own advertising. What Plus adds is the line
already drawn on filtering — **filtering the library by emotion.** "Everything
that ever made me cry" is new capability and belongs beside the advanced filter
axes. Looking at your own feelings is not.

### Profile widgets — the profile stops being a template
Today a profile is one of three presets: `classic`, `cards`, `poster`. Every
profile in the app is one of three pictures, and that is the quiet reason
nobody visits a second one.

**38 accounts, 9,890 comments, and zero follows ever recorded.** Part of that is
that there is nothing to discover on somebody's page — you have already seen it
on your own.

So: **the owner builds their own page out of blocks**, and reorders them.

    NOW WATCHING          the three things in flight
    TOP FIVE              chosen, not computed
    THE EMOTION CALENDAR  a year of how it felt
    A WRAPPED CARD        pinned, any month or year
    ON THIS DAY           today's memory
    STREAK                days in a row
    RECENT COMMENTS       the last few things written
    A LINE OF TEXT        a status, a favourite quote

**This is the right thing to charge for, for once, and not because it costs
money to run.** Expression is what people actually pay for on a profile —
Letterboxd Patron, Discord, Linktree, and MySpace before all of them. A person
who has arranged their own page has made something, and people pay to keep the
thing they made.

**Most of the tier is private — this is not.** Deep Stats, the advanced filter
axes, the heatmap and the timeline are all seen only by the person who bought
them. A profile is the one surface other people look at, so the subscriber does
the arranging and every visitor enjoys the result — and almost every visitor is
on the free tier.

Published lists, favourites, the badge and the themes are visible to visitors
too, so this is not the first of its kind. It is the strongest: those let a
visitor see MORE of somebody's things, this lets them see something the person
actually made.

**The constraint to design inside:** `components/profile-template.tsx` owns the
entire profile body and both the Profile tab and public profiles render through
it, precisely so they cannot drift. Widgets are a change to the template, never
a second renderer. Get that wrong and there are two profiles to keep in step for
ever.

The stored layout goes in `theme_layout`, which already exists and already
carries the three presets — so the free tier keeps them and Plus turns that
column into an ordered list.

### Three bug reports, one bug: nothing agrees on what "in my library" means
Two people on Discord, five symptoms, and the same cause under all of them —
**the app answers "is this in my library?" in several places, by several
different rules.**

| screen | how it decides |
|---|---|
| `search.tsx`, shows | by **name string** |
| `search.tsx`, movies | by tmdbId + name + year |
| `show/[id].tsx` | by **tvdbId** |

**Search "romance", tap + on the first result, the LAST one ticks.**
~~`movies.name` is the PRIMARY KEY, so six films called *Romance* are one row.~~
**That was the wrong diagnosis, and the fix needed no schema change at all.**

Adding already handles collisions: `addMovieToWatchlist` asks
`movieIdentityMatches` whether the row it found is the same film, and takes a
year suffix through `disambiguatedMovieName` when it is not — the same repair
that recovered five films silently lost from a real 546-film export.

The bug was in the matcher's last line, which read `return true` when neither
side carried a year. **One function was answering two questions with opposite
right answers.** Adding asks "is this the film I already hold?" and should err
toward YES, because a false no duplicates something already there. A tick asks
"is this exact result the film I hold?" and must err toward NO — and it did not,
so every yearless *Romance* claimed to be the one in the library and tapping the
first appeared to tick the last.

It takes a `strict` flag now: display demands positive evidence, adding stays
forgiving. Four tests pin both directions.

**Shows already being tracked offer "ADD SHOW".** Reported for Reacher, One
Piece, Bleach and Re:Zero. Search decides membership with
`showNames.has(r.name.toLowerCase())` — a string compare — and every one of
those is a title the search source spells differently from the stored one.
Anime is the worst case, and three of the four reported are anime.
**The result already carries `tvdbId` and it is simply not used.** One line.

**The "+ Add show" inside a title and the "+" outside it disagree**, and on a
film, marking it watched without adding removes the inner one while leaving the
outer one. Two controls, two checks, one truth.

**Two more arrived from the same two people, and one is the same bug again.** A
show six seasons deep still offered "Add show" in search — Reacher, One Piece,
Bleach and Re:Zero, every one a title the search source spells differently from
the stored one, which is what a name comparison cannot survive.

**"Partner" (2007) could not be found at all**, and this one is NOT the same
bug: the year went to the catalogue as part of the TITLE, so it looked for a
film called "Partner 2007", found nothing like it, and returned whatever else
shared a word. `splitYearQuery` lifts a trailing year out and uses it to RANK
rather than to filter — somebody misremembering a year by one should still see
the film, and a search that silently drops the right answer is worse than one
that ranks it second.

**Still open: One Piece shows no "+20" badge, and the cause is not the badge.**
`episodesLeft` returns nothing when `airedTotalOf` holds no aired total,
deliberately, so a caught-up show never displays a phantom remainder. For One
Piece that number is missing, so the badge is correctly suppressed for an
incorrect reason. The fix belongs where the aired total comes from.

**Also still open: the inner "+ Add show" and the outer "+" disagreeing.** The
outer one is fixed by the identity change below; the pair has never been tested
together, and a film marked watched without being added still leaves the two
saying different things.

**This is not three fixes.** It is one function that answers the question, called
from everywhere, keyed on identity and never on a display name. Exactly the shape
of the three publish-fingerprint bugs of 7 Aug: not three bugs that resembled
each other, one missing abstraction that produced three.

Worth a sweep afterwards for anywhere else comparing a title string to decide
what something IS.

### Where to find us — links the server owns, at the end of the release
Discord, Reddit, Instagram, TikTok and X, in Settings. The point is not the
rows, it is that **a link baked into a shipped build is a link that cannot be
fixed** — and a Discord invite expires after seven days by default, which would
be dead in every copy already on a phone.

So: `key`, `label`, `url`, `sort`, `enabled` in a `links` table, `GET /v1/links`
edge-cached with a long TTL. It is the same for everybody, which makes it the
one thing a shared cache is genuinely right about, unlike aggregates.

**Defaults ship in the app; the server may only override them.** That is forced
by the rule the community rests on — somebody who declined it never contacts the
server at all — so the list is refreshed only when the app is ALREADY talking to
the server, on a joined user's launch sync. A decliner keeps the bundled list
and reaches nothing. Releases are frequent and this changes rarely, so they lose
almost nothing.

Keyed, not positional, so an icon can be chosen per platform and a deleted row
disappears rather than shifting the rest. `https://` only: a URL the server
hands to `Linking.openURL` is a redirect that must stay safe if the table is
ever wrong.

Not onboarding and never a notification. A prompt to join a chat server on first
launch contradicts the thing the app just promised, and a push about it would
make every other notification read as marketing.

### Also planned
- **Sync** — a Plus feature, and NOT end-to-end encrypted. Decided 19 Aug 2026,
  against the recommendation on this page, and the reasoning is worth keeping
  because the trade was made with open eyes.

  E2E needs a recovery code, and a recovery code nobody saves is not security —
  it is an elegant way to lose somebody's data. The owner's words: "I literally
  don't save it at all." Weighed against that, the cost of plaintext is that the
  server can read a synced library.

  **Which is survivable ONLY because the door is double.** Sync needs Plus, and
  then needs turning on. Somebody who does neither — nearly everybody — is
  exactly where they were: the phone holds the history and the server has no
  table for it. So the general claim stays true for the general case, and there
  is no blanket caveat in the marketing about a feature almost nobody has.

  **The disclosure lives at the moment of switching it on**, and must be plain:
  "a copy of your library is stored on OpenTV's server", never "secure cloud
  sync". Same principle as the support bundle, where the banner IS the
  disclosure and ships with the upload. Honesty there is what makes silence
  before it legitimate.

  It also buys the WEB, which is the other half of what is being paid for: a
  browser cannot read a phone's SQLite, so a web client shows your own library
  only if a server has it.

  Still not a 1.5.0 item. The hard part is no longer key recovery — that is
  gone with the encryption — but conflict resolution remains: two devices
  editing the same library offline is its own release.
- ~~**A deleted account never signs the phone out**~~ — **already fixed, and
  this entry was stale.** It is caught in two places now: `refreshSession()`
  runs first on launch and signs out on `not_found`, and `(tabs)/profile.tsx`
  catches the same code — but only for the owner's OWN handle, because a 404 for
  somebody else means they blocked you, you blocked them, or they are gone, and
  none of that says anything about your session.
- ~~**The comments screen freezes** at 800+ comments: `ScrollView` with `.map()`,
  no virtualisation.~~ **Fixed, and the diagnosis was wrong.** `CommentsList`
  had been virtualised for a while. The freeze came from filtering and mapping
  the whole archive on every render BEFORE the list saw it — ~25,000 iterations
  plus 8,534 allocations and 8,534 file lookups on the heaviest account, for
  state changes that could not alter the result. A `FlatList` governs what gets
  DRAWN; it cannot help with work done before it is handed anything.

---

## 1.4.2 — opening a profile crashed

**Every public profile crashed the moment it finished loading**, on both
platforms, in the build that went out yesterday.

`profile/[handle].tsx` reads the owner's published widget arrangement through a
`useMemo`, and that memo sat **below** the screen's early returns. A profile
starts in `loading`, which returns before reaching it, then flips to `ready`,
which runs it. One extra hook on the second render, every time, so React threw
`Rendered more hooks than during the previous render` on literally every profile
anybody opened.

The memo now sits above the returns and reads `state` rather than `p`, because
`p` does not exist until the screen knows it is ready.

**Why nothing caught it.** Rules of hooks is a lint rule and it was firing, but
this repo has a standing baseline of 48 lint errors, and one more error in a
list of 48 is invisible. The rule is the useful part of that lint run and it was
buried in noise it was never meant to share a list with.

**And the shape of it is worth keeping.** Every early return in a component is a
line above which all hooks must live, and this file has two of them 30 lines
apart. Anything added to the bottom of a screen like this one is added below
that line by default.

---

## 1.4.1 — a backup Android actually has

### Google Drive backup — real parity with iCloud
iOS has had silent automatic iCloud backup since 1.1.x. Android has had an
export button and a banner asking people to press it, which is not a backup —
it is a chore, and the person who most needs one is the least likely to repeat
it. **Android was the platform that loses your decade**, and it is where most
OpenTV users are.

Same ZIP, same restore path, same trigger and the same skip logic as iCloud:
both clouds share `librarySignature()` and the content hash, so an unchanged
library is never built twice and the two copies cannot disagree about whether
there was anything to send. The only difference is where the file lands.

Three decisions worth keeping:

- **Signing in for backup is not joining the community.** The Drive permission
  is asked for on its own with `addScopes`, at the moment somebody turns backup
  on. If it rode on the community sign-in, "keep my library safe" would mean
  "publish a profile".
- **`drive.file` and nothing wider** — files this app created, nothing else in
  the user's Drive. And the backup stays VISIBLE rather than in `drive.appdata`,
  because a backup you cannot open is one you cannot trust. iCloud's copy sits
  in Files; this one sits in Drive the same way.
- **Not Android Auto Backup**, which caps at 25 MB *without telling anyone*. A
  1,105-watch library is already 20 MB, so the casual user is quietly protected
  and the person with ten years of history quietly is not — exactly backwards
  for the audience this app exists for.

Turning it off leaves the files alone.

### It could not sign in, for three reasons in a row
Each one presented as an unregistered signing certificate, which is where the
afternoon went. All three are the sort that hide behind a truthful-looking
error:

- **`signInSilently()` resolves with an object either way.** v13+ returns
  `{type:'success'}` or `{type:'noSavedCredentialFound'}` — both truthy — so
  `if (!current) await signIn()` never fired, nobody was ever signed in, and
  `addScopes()` failed against an account that did not exist. `accessToken()`
  had the identical bug, which would have stopped the *background* backup
  silently and for ever. `community-auth.ts` already documents this trap for
  `signIn()`'s cancellation response: it is the shape of this SDK, not an
  accident in one file.
- **`configure()` was only ever called from the community path.** Drive
  deliberately does not go through it, so on a phone that had never joined, the
  SDK was never configured — and an unconfigured SDK does not say so, it fails
  as `DEVELOPER_ERROR`. The feature was broken for precisely the user it was
  written for.
- **And the error said "check your connection" whatever had happened**, because
  `connectDrive()` returned a bare boolean behind an empty `catch`. Every retry
  confirmed the wrong diagnosis. It now returns a reason and prints the raw code
  under the generic message. Cancelling says nothing at all — backing out of the
  account sheet is an answer, not an error.

### The nudge knows about it
The "back up your library" banner no longer fires once Drive is connected: a
phone backing itself up nightly does not need to be told to keep a copy safe,
and a banner that is wrong is a banner people learn to dismiss. Its dialog now
leads with turning Drive on, with the manual export second, and deep-links to
Settings → Data rather than leaving somebody to hunt for it.

### Profile widgets — the whole feature, shipped inert
Fourteen widgets over data the phone already had, arranged the way a home screen
is arranged: hold anything, drag it where you want, minus to take it off, plus
to add. None of it fetches anything; they are queries over an archive that
existed — the oldest date in the import, the hour of the evening somebody
actually watches at, the character votes that have sat in SQLite since the first
import and appeared nowhere.

**Nobody will see it in 1.4.1.** The only entry point is a long press and that
asks `requirePlus('profile_widgets')`, which does nothing while
`PLUS_AVAILABLE` is false. Shipping it dormant is the point: the risky code
lands now, with a release's worth of time to find what it breaks, and 1.5.0
becomes a one-line flip rather than a launch.

**The default profile is unchanged**, deliberately and after getting it wrong
once. Every widget here is opt-in; a reset returns the page people arrived from
TV Time already knowing. Nobody who never opens the arranging mode sees a
different profile than they did yesterday.

**The gate is on building, never on seeing.** A visitor who is not Plus still
gets the profile its owner made — a thing to show off is worthless if only the
people who already pay can see it.

**The server half is in place too** (backend migration 0022): one `widgets`
column holding the arrangement as opaque JSON. It carries VALUES and not only
places, because this server has no watch-history table by design and cannot work
out "12 days in a row" for a visitor. Which makes what is absent from that
column the privacy decision: the widgets marked `private` — the hour somebody
watches at, their first ever episode, their watchlist — never leave the phone,
and a test exists whose only job is to fail if that changes.

Four classes of bug cost most of the time building it, and all four were the
same shape — something ABOVE the thing that looked broken:

- a transparent modal draws over whatever is pushed on top of it (three screens)
- `flex: 1` beats an explicit height when the parent is content-sized
- a `Pressable` claims the touch on START while a ScrollView only asks on MOVE,
  so any Pressable ancestor silently kills a pager
- a component that asks the WINDOW how wide it is, having been told, is right on
  the page it was written for and wrong in every card since



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

### What an hour on a real phone found
Everything below was written, tested and green before any of it had run on
hardware. An hour of tapping produced eight bugs, two of which would have
shipped.

**The tick in "People also watched" was answering a file that is always empty.**
It read `seed.shows` — the bundled seed, which public builds ship with nothing
in it — so for every real user it never lit for a show they track, never cleared
when they removed one, and reflected only what had been added during that visit,
in memory. It reads the database now. Taking a show back out asks first when
there is history to lose, and names the number: removing a show deletes its
watches, its ratings and its votes with it, and one small badge cannot tell
"undo the tap I made ten seconds ago" from "throw away six years".

**The theme survived the subscription.** Turning the entitlement off left the
profile fully painted. That was this project's stated rule — cosmetics are not
stripped off people — and seeing it work proved the rule wrong: one paid month
bought the look for ever. The theme is nulled on the way out now, on the server
as well as in the app, and the chosen colour is *kept*, so resubscribing
restores the profile instead of asking somebody to pick it all again as a
penalty for having lapsed.

**And the theme was invisible anyway.** Ten per cent of a colour mixed into
black is not a colour: held up beside an unthemed profile you could not tell
which was which. The show's own artwork sits behind the whole page now, blurred,
the page ramps from strong at the top to black by the posters, and a second
colour is taken from the artwork — because one hue used for every accent reads
as a filter, and two in different roles is the difference between a tint and an
identity.

Also: the actor page built all 121 of Bob Odenkirk's credits before painting the
first one; the Wrapped card sat too low and had no edge against a black screen;
Appearance was unreachable because its door was hidden behind the same flag that
hides the features; a private profile said so nowhere on the profile itself; the
reconnection screen was five taps deep behind an unlabelled icon; and the share
card — the one image in this app built to be posted somewhere else — spent a
fifth of its line printing "0mo".

### Two dead taps on a show page, reported with a screenshot and an arrow
Both from one Discord message, and both real.

**"People also watched" did nothing, anywhere.** The cards resolved their
TheTVDB id through `tvdbIdForTmdb`, which reads a reverse index built from the
shows in your library — so it could only answer for a show you already track, in
the one section whose entire purpose is showing shows you do not. It returned
undefined for nearly every card and the handler's `tvdb && ` swallowed the press
in silence. The same line appeared in three places on that screen.

The `+` was worse: not a broken button but a `View` drawn over the poster, with
no handler ever attached. It looked like a control and was reported as one,
which is exactly right — if it draws as a button it has to behave like one.

Now `showTvdbIdForTmdb` asks the library map first, because it costs nothing and
is right when it answers, and TMDB's `/external_ids` second. The poster opens the
show; the `+` adds it and turns into a tick. A title TheTVDB genuinely does not
carry says so, rather than absorbing a second tap.

**The Cast row was not tappable and had nowhere to go.** No actor screen
existed, and the stored cast carried no person id to build one from — a name, a
character and two photographs, nothing to follow.

So `personId` now rides along from TheTVDB's character records, and there is an
actor page: photograph, years, birthplace, biography, and every series and film
they are credited in, newest first, each series opening in the app. The
biography is picked in the reader's own language before falling back to English,
because the app ships in six and TheTVDB returns all of them.

Cast cached before this has no id, and those cards stay flat rather than
responding to a tap by doing nothing — the exact bug being fixed. One forced
refetch per show fills them in, the same mechanism `charPhoto` used.

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
