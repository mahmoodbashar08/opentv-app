# Release tests

What has actually been run on a real device for the release being prepared, and
what has not. Kept because "did we test that?" is otherwise answered from memory
a week later, and memory says yes.

**Reset this file at the start of each release.** A tick is worthless if it might
be from the previous version.

Conventions: `[x]` run and passed, `[ ]` not run, `[~]` run and failed — with the
failure written next to it, not in a commit message.

---

## 2.0.0 — in development (started 10 Oct 2026)

Built by parallel agents; nothing below has been on a device yet. Each block is
one merged branch, in the order it landed.

Stats name a show from its library row (`2.0.0-voted-rating-names`)
- [ ] iPad, a library with a 99000xx show (one TheTVDB never had): Profile → Stats → Shows, "Most voted rating per show" rows are all titles, no bare numbers
- [ ] Same screen: "Biggest marathons" and the "Watch badges" grid show titles only
- [ ] Deep Stats (Plus): "Top shows" has 8 titled rows when the period has 8+ shows; "You vs the crowd" rows are titled; check All time and one year chip
- [ ] Wrapped for a month containing that show: its top-show card carries the title
- [ ] Simulator negative case: `UPDATE shows SET name='' WHERE tvdbId=<rated show with no cached metadata>`, relaunch → that show is absent from Most voted / marathons / badges rather than printed as a number; restore the name after
Card grids grow with the width (`2.0.0-ipad-columns`)
- [ ] iPad 13", portrait: Profile → Edit profile → Profile templates: 4 columns (3 on 11"/mini), flush with both margins, equal gaps, cards the same little-phone shape as on a phone; tapping one still shows the apply alert
- [ ] Rotate to landscape: 5 columns; back: 4; the last card never wraps alone onto its own row
- [ ] Same iPad: Edit profile → banner/cover → Ours tab: 3–5 columns of banners, not two huge ones; picking one still applies
- [ ] Same screen → GIF tab (Plus): 3–5 columns; rotating re-lays out (scroll returns to top — expected); tapping a GIF still saves
- [ ] iPhone: Profile templates, Ours, GIF — still exactly two columns, same sizes as 1.6.8
- [ ] iPad Split View at phone width: Profile templates shows two columns
- [ ] iPad fresh start → Add your shows: 7 columns portrait, 9 landscape, normal posters; search, pick, Continue work; rotating mid-pick keeps the picks. iPhone: still 3
A server you run yourself needs no Plus (`2.0.0-selfhost-sync`)
Server: `cd backend && SESSION_SECRET=$(openssl rand -base64 48) DATA_DIR=/tmp/opentv-selfhost npm run selfhost` (:8787; simulator address `http://localhost:8787`). `SELF_HOSTED` is set only by `backend/selfhost/server.ts`, never by wrangler.
- [ ] Free account, no receipt, devPlus off: Settings → Appearance → a theme still opens the paywall (baseline)
- [ ] Settings → Your data → Community server → address + TMDB token + TheTVDB key → Save and switch → sign-out confirmed
- [ ] Settings → Backup → OpenTV Backup: first row reads "Your community server / The server you pointed OpenTV at. Free — your server is yours to fill." — not "OpenTV's server / Needs Plus"
- [ ] Tap it → sign-in screen, NO paywall; register with email + password
- [ ] Tap the row again → connected view: "Backing up to: Your community server" + address, "Last backup: just now", a "Last sync" row present; no "Paused — Plus ended", no "needs Plus" row
- [ ] A ZIP appears in /tmp/opentv-selfhost/backups/
- [ ] Back up now → "Backed up"; tick an episode → "Last sync" goes from "1 change waiting" to a time; server log shows POST /v1/sync
- [ ] Restore from this backup → "Restored. N added."
- [ ] Regression: Community server → Use the official server → Backup → OpenTV's server with the free account → paywall opens as before
- [ ] On the custom server: Appearance theme, Deep Stats, profile templates still open the paywall; no "OpenTV Backup is off — your Plus includes it" banner on Profile
One phone publishes the profile (`2.0.0-one-publisher`, backend 0052 must be deployed first)
- [ ] Phone A, free account, full library: publish once (Profile tab, wait a minute). Dashboard shows A's totals; D1 `profile_stats.publisher_device` is a short random id
- [ ] Phone B: fresh install, same account, restore nothing, watch 1 episode → Profile shows the "Your profile has more than this phone" alert; public profile still A's
- [ ] B: "Use this phone's library" → public profile is B's (1 show); dashboard publish state `ok`; `publisher_device` changed
- [ ] A: watch 1 episode, open Profile → "Your profile updates from your other phone" with See OpenTV Plus / Make this phone main / Not now. Not now → profile stays B's; dashboard "not sent: another of their phones publishes the profile"; relaunch A → the alert once more, and no 409 per minute (wrangler tail)
- [ ] A: "Make this phone main" → A publishes, profile is A's full library; B watches an episode → B gets the "other phone" alert, profile stays A's
- [ ] B: "See OpenTV Plus" → paywall (`from=publish`); turn Plus on → B publishes on the next change, no alert on either phone from then on
- [ ] Replacement-phone path: free account with A publishing; fresh phone restores from iCloud/Drive on welcome, then signs in → first publish claims silently, no alert; A gets the gentle message next time
- [ ] Import path: B held as "smaller" taps Import a file and imports A's export → B publishes (claims) with no further tap
- [ ] Arabic: both alerts mirror correctly

The Wrapped summary card (`2.0.0-wrapped-overlap`)
- [ ] iPhone 18 Pro, the invented 1-film + 4-shows month: first card — "2026" clear of "— TOP FILMS —", four show posters on ONE line, nothing touching the totals bar, brand line at the bottom
- [ ] Same month: Share → the sheet preview and the saved JPEG look identical, no overlap, totals bar whole
- [ ] 1 film + 1 show: two single posters the same size, label and chip not touching
- [ ] 3 + 3: two full lines of three, equal sizes
- [ ] Films-only 5: 3 + 2 centred; shows-only 7–8: 4 + 3 / 4 + 4
- [ ] 4×4 (the control): exactly as before — 65pt posters, same spacing
- [ ] Open the card, next/back once, return: posters appear with the fade-in, no flash of an empty middle (also on a slow Android)
- [ ] Pro Max and Android: taller card, slightly larger posters, nothing overlapping
- [ ] Largest text size: posters get smaller, nothing overlaps
- [ ] iPad rotated: the card re-lays out, nothing overlapping

## 1.6.8 — preparing 8 Oct 2026 (iOS 69)

Device pass 8 Oct: iPhone 17 Pro simulator, fresh install, walked by Maestro
(welcome → import chooser → start fresh → name → shows → where are you →
films → tabs); iPhone 18 Pro simulator for What's new; Android emulator
(release APK, Arabic) for profile, Seasonal look and Profile templates —
right to left correct throughout. Found and fixed on the way: a fresh install
with no account fetched /v1/links (and took the season's pumpkin) — now only
with an account; the import step repeated itself; three yellow banners at once.
- [x] What's new for 1.6.8: five cards, once (simulator)
- [x] Android, Arabic: Profile, Seasonal look, Profile templates draw right to left (emulator, release APK)

Welcome & fresh start
- [x] Get Started goes straight to "Continue with" — no iCloud / Drive screen first
- [x] iCloud off: the small note "iCloud Drive is off…" sits at the bottom, not between buttons
- [x] "Import your data" → "Where is your history coming from?" (TV Time, Trakt, Simkl, Letterboxd, IMDb); each shows its own step 1; "Another app" goes back — simulator 8 Oct; steps cut to two once an app is chosen (step 2 repeated step 1 and named TV Time to everyone)
- [x] "My data is already on this device" hidden on an empty phone
- [ ] "What should we call you?": circle has a camera badge and "Add a photo (optional)"; the photo shows in the circle and on Profile after Start
- [x] Add your shows: search "Attack on titan" → "Attack on Titan" first, in English
- [x] Where are you? (simulator 8 Oct: Partway at S1 E2 → exactly S1 E1 watched) — Not started / Up to date ("Finished" for an ended show like Game of Thrones) / Partway → card + season row + episode row; Done marks only the episodes before the chosen one
- [x] Step 3 films; then the tabs
- [ ] After a library exists: ONE "Keep your library safe" ask (iCloud off on iPhone / Drive on Android) — never again after
- [ ] Profile and Shows tab: Plus/Join banners and "Tonight" hidden while the library is empty
- [x] Plus banner reads "OpenTV Plus — save your data forever"

Plus, codes & backup
- [ ] Paywall "Have a code?": iPhone → type ENBETA → Apply opens Apple's redeem sheet with the code; Android ENBETA shows both plans at half price (don't finish the purchase)
- [ ] Buy Plus with no account → thank-you card asks to sign in for OpenTV Backup and Sync
- [ ] Turn on OpenTV Backup with the network OFF → "Backup failed" and sync stays OFF; network on, tap again → backup lands and sync turns on
- [ ] Mark episodes, leave the app, reopen → a new backup arrives on the dashboard within a minute
- [ ] Sync row says "Paused — Plus ended" after Plus ends (sandbox)
- [ ] Settings → Calendar opens its own page: switch, Last updated, Update now; refused permission offers Open Settings

Seasonal looks (the dashboard Event dropdown drives these)
- [ ] Event on (e.g. Halloween): free account → Edit profile → Avatar decoration shows the 🎃; Seasonal look: only the event's own look is usable, everything else locked → paywall; "Halloween theme" On/Off keeps or removes it
- [ ] Plus: a tab per season (all seven); a Look applies decoration, companions, ring and effect at once; each part changes on its own (decoration, up to two companions, ring colour, Glow, banner effect); the preview at the top follows
- [ ] Profile: ring + glow + decoration + companions; bats/snow cross the banner while the tab is open; NO coloured band on the banner
- [ ] A show and a film page: the season's effect crosses the banner once on opening
- [ ] Event off from the dashboard → within 5 min a free account loses it, Plus keeps it
- [ ] Rising effects: New Year 🎈, Ramadan 🏮, Valentine's 💕 go up; Day of the Dead 🦋 flies across

App icons (needs this build — native)
- [ ] Appearance → App icon: all six selectable; Halloween and Christmas switch the home-screen icon (iOS shows its own "changed the icon" alert)
- [ ] Android (EAS build): switching works; note whether the app closes when it switches

Profile templates (Plus)
- [ ] Edit profile → Profile templates: "From your shows & films" fills within a few seconds the first time, instantly after; ten made templates with persona + reason
- [ ] Apply one: banner, colours, layout and blocks change; back on Edit profile; the app restarts once to repaint; the banner IS the template's
- [ ] Apply a show template: the show's artwork is the banner; Appearance says themed on that show
- [ ] Another device / a friend sees the new profile (layout + blocks published)
- [ ] Add a new favourite show → templates page makes them again; watching an episode does not

Arranging blocks
- [ ] Hold the profile → tap Stats → Style: row / grid / compact; tap the counts row → row / grid; the choice survives reopening and shows on the public profile
- [ ] Size on a widget with more than one size; Replace → pick another → it takes the same place; Remove

Banner & banners
- [ ] Banner picker: "Take the banner's colours" off → a new banner keeps the current colours; on → takes them; remembered
- [ ] Backup banner ✕ hides it; it returns after a week
- [ ] Show page: "What interests you most" is one row of small chips (show and film)

Messages & notifications
- [ ] Settings → Message the developer → send; reply from the dashboard arrives and the notification opens the thread
- [ ] Bell opens /inbox (follows, likes, replies, requests, messages); the gear opens notification settings
- [ ] Plus with no account: reminders day 1, 4, 10; signing in cancels them

Community
- [ ] Not a member → comments show the Join card and nothing is fetched
- [ ] CommsUni app chips: every app shown with icon and count, zeros included
- [ ] A tall comment picture keeps its shape (not cut off)
- [ ] Main search names shows in the app's language

---


## 1.6.6 — built 4 Oct 2026 (iOS 50, Android 66)

Reset 4 Oct 2026. The 1.6.4 results are in git history. Simulator runs: iPhone 17
Pro (iOS 26.5) with a copy of Mahmood's library, driven by Maestro; it cannot be
signed in, so community and Plus-only items are left for the phone (TestFlight 50).

### Comments and CommsUni
- [x] An episode's comments: two tabs, OpenTV (n) first and CommsUni (byline + ⓘ + sort); a spinner, never "no comments", while loading; writing a comment switches to OpenTV
- [ ] Your own comment shows once, with the OPENTV pill; names read "display name" with "@username · date"
- [ ] Open a CommsUni comment → yellow pencil → reply → it appears; ⋯ → Delete on your reply removes it
- [ ] Write a new comment with the pencil (CommsUni share question appears the first time)
- [ ] Comment pictures load once and then open instantly

### Banner and theme
- [~] Edit profile → Adjust banner: **drag passed (simulator, 4 Oct)**; pinch and a playing GIF still to check on the phone
- [ ] Drag the yellow ↕ handle to make the banner taller / shorter
- [x] Smooth edge on/off; Banner overlay slider and a colour; Cancel restores — simulator, 4 Oct
- [ ] Upload tab: your own GIF and a photo; adjuster opens after
- [ ] A colourful artwork or GIF changes the theme; a black-and-white one gives neutral
- [~] Theme colours: **Reset to OpenTV colours passed (simulator: theme cleared, accent yellow)**; picking from Edit profile / the adjuster needs Plus → phone
- [x] Profile: scroll down keeps the banner's middle; pull down grows it, no gap — simulator, 4 Oct
- [ ] GIF search: results arrive after a pause, start at the top

### Profile and account
- [ ] Edit profile → Username → a name with a dot (taken / available as you type)
- [ ] "Joined …" shows at once on reopening
- [~] Wrapped → September: summary card first, 5 films as 3 + 2, 8h · 5 films — **passed (simulator)**; Share still to check on the phone

### Plus, backup, sync
- [ ] Backup to OpenTV turns on by itself for a Plus account (message once)
- [ ] Settings → Cloud backup shows a recent backup

### Other
- [x] "What's new" dialog once after updating (logo, 1.6.6 pill, five cards); not again after reopening
- [x] Translate under a CommsUni comment (thread and its own page); tap again → original (build 51)
- [x] Show more on an episode's CommsUni comments loads 20 more each tap (server fix — works on any build)
- [ ] Second device with Sync on turns Cloud Backup on by itself; dashboard backup time follows sync (build 51)
- [ ] Import a TV Time file → dashboard shows the totals within a minute, without reopening the app (build 51)
- [x] Dashboard: "CommsUni: on" button; "imported, not sent yet" where it applies (server)
- [ ] Stremio sign-in (needs a Stremio account)
- [x] Search → open a show → mark a whole season: no keyboard — simulator, 4 Oct (Noddy's Toyland Adventures, S2)
- [ ] Android (APK on the emulator): opens, comments, Wrapped card, Arabic right-to-left
