# Release tests

What has actually been run on a real device for the release being prepared, and
what has not. Kept because "did we test that?" is otherwise answered from memory
a week later, and memory says yes.

**Reset this file at the start of each release.** A tick is worthless if it might
be from the previous version.

Conventions: `[x]` run and passed, `[ ]` not run, `[~]` run and failed — with the
failure written next to it, not in a commit message.

---

## 1.6.4 — not yet built

Reset 29 Sep 2026. The 1.6.3 results are in git history (`git show origin/main:RELEASE-TESTS.md`).

Test devices set up on 29 Sep: **iPhone 17e simulator, iOS 27.0** (shown in
Xcode 27's DeviceHub, which replaced Simulator.app) and the **opentv-test
Android emulator** with a fresh debug build. Your TV Time ZIP is in Files →
On My iPhone on the simulator.

### Launch and install

- [x] **Opens on iOS 27** — the App Review rejection (UIScene). iPhone 17e and
      a fresh iOS 27 simulator both reach the welcome screen, 28 Sep.
- [x] **Widget cold launch on a real iPhone** — app closed completely, widget
      tapped: opens the right place. Tested by Mahmood, 29 Sep.
- [ ] **Upgrade over 1.6.3, not a fresh install** — library intact.
- [ ] **Android fresh install** on the emulator.

### Import

- [x] **New import wording** ("Find the TV Time export you downloaded before it
      shut down") — seen on iOS 27, 28 Sep.
- [~] **Fresh TV Time import, iOS 27** — first run froze on "Getting episode
      data… 115 / 116" for 10+ minutes; second run completed (117 shows, 1,105
      episodes, 304 films). One show's fetch never settled; cause not found.
      FIXED by a 90-second ceiling per show in `fetchShowMeta`. Re-run to confirm.
- [ ] **Import from another app keeps the TV Time ZIP** — import TV Time, then a
      Letterboxd/IMDb file; the self-repair copy must still be the TV Time ZIP.
- [ ] **IMDb ratings CSV** (films only; episodes skipped) and a **Letterboxd
      import-format CSV** (JustWatch extension).
- [ ] **The splash that never finishes** — launch with the network off after an
      import; must reach the app, not hang.

### Account and backup — the reason 1.6.4 matters to a paying user

A real subscriber bought Plus on 28 Sep with no account; on 1.6.3 cloud backup
simply said "Backup failed" to them.

- [x] **Plus with no account → Backup → Cloud backup → OpenTV's server** opens
      "An account" (Apple / Google / email, with "What this does not do": no
      public profile, no handle, not in the community) — not Join, and not
      "Backup failed". iPhone 17e simulator, iOS 27, 29 Sep.
- [x] **The account screen says which address they used on TV Time** ("On TV
      Time you used … Continue with Apple…"), like /join, and suggests it in
      the email form. Added 29 Sep; seen on iOS 27.
- [x] **Email sign-up → confirm → back to Cloud backup, backed up** — re-tested
      after the fix with test2@itsnoddy.dev, 29 Sep: Continue returned to Cloud
      backup showing the backup time; server holds the copy (04:15).
- [x] (was:) **Email sign-up → confirm → back to Cloud backup** — account created and
      confirmed (test@itsnoddy.dev, code by email), but Continue landed on the
      PROFILE, no backup made. The email form never read `next`, and ran the
      join steps (handle, notification ask) for a backup-only account. FIXED
      (email-sign-in + verify-email carry `next`; join steps only with
      join=1). Re-test with a new address.
- [x] **Backup from a signed-in, not-joined account** — "Backed up"; server
      holds 2.6 MB, 116 shows / 1,105 episodes / 304 films under this device's
      own key. Profile private, 0 shelf, 0 ratings, 0 comments. 29 Sep.
- [~] **"Needs Plus" said as "server could not be reached"** — `plus_required`
      and `list_full` were missing from the codes api.ts recognises, so every
      402 became `unknown`. LIVE IN 1.6.3. FIXED, with a test; now says "Cloud
      backup needs Plus".
- [ ] **Paid before sign-in, first backup right after** — the server learns of
      the purchase by RevenueCat TRANSFER a few seconds later; the backup now
      retries for ~16s while the phone holds Plus instead of switching itself
      off. Needs a real purchase to test.
- [ ] Profile of an account that never joined shows no `@user_p_…` handle and
      no "Joined" date (fixed 29 Sep, not re-checked).
- [ ] Email form: fields and button touch the screen edges (no side margin).
- [x] **Profile banner for a Plus subscriber with no working cloud backup** —
      "Cloud backup is off — your Plus includes it. Tap to set it up" first
      in the banner order; tap opens Cloud backup; after a backup lands the
      banner is gone. 29 Sep. The "stalled" variant (set up, last upload
      failed) is not yet seen; its ✕-less wording is by design.
- [ ] **Signed in, not joined**: no public handle, nothing published, the
      account appears on the dashboard with a `user_…` name.
- [ ] **Join later with one tap** from an account that already exists.
- [ ] **New profiles are private** by default.
- [ ] **One backup file per device** — back up from iOS and Android on one
      account; both files exist, and restore says there is more than one.
- [x] **Backup is one screen** — Settings → Library → Backup: iCloud Drive, back
      up now, Cloud backup, Export, JSON. 29 Sep.
- [ ] **Purchase made signed out, then sign in** — dashboard shows them as Plus
      (RevenueCat TRANSFER).

### Sync and live screens

- [ ] **An open screen refreshes** when the other device's change lands (rate
      on Android with the same episode open on iOS; no navigation).

### Sharing

- [ ] **Share card shapes** — Card, Post (default), Story; JPEG, no rounded
      corners in the file, no WATCHLIST on a film you have not added.
- [ ] **Favourites grid** — pick which favourites, Post shape, titles readable.
- [ ] **Recently watched card**.
- [ ] **Share through each platform's sheet** (Instagram Stories, Messages).

### Everyday fixes from 23 Sep

- [ ] Double-tap a poster opens ONE screen.
- [ ] ⋯ on a film works right after scrolling, and on a film not yet added.
- [ ] Swipe-down never leaves a screen stuck off the bottom.
- [ ] Explore's tick toggles off, and stays right after returning.
- [ ] A recent search opens the same film, not a namesake.
- [ ] Marking a film watched jumps to its More tab.
- [ ] A rating can be taken back.
- [ ] A show's page no longer shows an unearned 99%.
- [ ] Wrapped is reachable from Stats without Plus.
- [ ] Film titles in English (e.g. 天使のたまご reads "Angel's Egg").

### Settings, GIFs, theme

- [ ] Settings tabs renamed; notifications are one row.
- [ ] One GIF search everywhere (comments, banner, widget picker), with the
      GIPHY credit; chips follow what you type.
- [ ] **Theme applies without reopening** — change accent / light / OLED /
      profile theme; the app restarts itself in about a second (28 Sep change).

### Both platforms, Android only

- [ ] Tab bar clear of the navigation bar, gesture AND 3-button.
- [ ] Arabic, right to left.
- [ ] Google Drive backup still works.
