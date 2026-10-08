# Release tests

What has actually been run on a real device for the release being prepared, and
what has not. Kept because "did we test that?" is otherwise answered from memory
a week later, and memory says yes.

**Reset this file at the start of each release.** A tick is worthless if it might
be from the previous version.

Conventions: `[x]` run and passed, `[ ]` not run, `[~]` run and failed — with the
failure written next to it, not in a commit message.

---

## 1.6.8 — preparing 8 Oct 2026 (iOS 69)

Fresh start
- [ ] "Add your shows": step 1 grid + search, step 2 "Where are you?" (Not started / Up to date / Partway with the S·E stepper), step 3 films → library correct afterwards
- [ ] Android: "Back up to Google Drive" offered at Get started; skippable
- [ ] Profile and Shows tab: Plus/Join banners and "Tonight" hidden while the library is empty

Plus & backup
- [ ] Paywall "Have a code?": iPhone opens Apple's sheet; Android `ENBETA` shows both plans at half price (don't finish the purchase)
- [ ] Buy Plus with no account → thank-you card asks to sign in for OpenTV Backup and Sync
- [ ] Turn on OpenTV Backup with the network OFF → "Backup failed" and sync stays OFF; network on, tap again → backup lands and sync turns on
- [ ] Mark episodes, leave the app, reopen → a new backup arrives on the dashboard within a minute
- [ ] Sync row says "Paused — Plus ended" after Plus ends (sandbox)

Messages & notifications
- [ ] Settings → Message the developer → send; reply from the dashboard arrives and the notification opens the thread
- [ ] Bell opens /inbox (follows, likes, replies, requests, messages); the gear opens notification settings
- [ ] Plus with no account: reminders day 1, 4, 10; signing in cancels them

Community
- [ ] CommsUni app chips: every app shown with icon and count, zeros included
- [ ] A tall comment picture keeps its shape (not cut off)
- [ ] Not a member → comments show the Join card and nothing is fetched

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
