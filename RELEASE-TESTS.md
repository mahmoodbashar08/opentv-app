# Release tests

What has actually been run on a real device for the release being prepared, and
what has not. Kept because "did we test that?" is otherwise answered from memory
a week later, and memory says yes.

**Reset this file at the start of each release.** A tick is worthless if it might
be from the previous version.

Conventions: `[x]` run and passed, `[ ]` not run, `[~]` run and failed — with the
failure written next to it, not in a commit message.

---

## 1.6.3 — iOS build 42, Android versionCode 55

Artifacts: `~/Downloads/OpenTV-1.6.3-build55.aab`, and
`~/Library/Developer/Xcode/Archives/2026-09-19/OpenTV 1.6.3 (42).xcarchive`.

Both REBUILT on 19 Sep after two fixes landed that build 54 and the first
archive did not have — the community offer spent on a discarded navigation, and
the meta caches surviving a wipe. The stale 18 Sep archive was deleted so it
cannot be submitted by mistake.

Both verified structurally on 18 Sep 2026: four Android widget receivers
(UpNext, Movies, UpNextMovies, Heatmap) plus `heatmap_preview.png`;
`OpenTVWidgets.appex` in the iOS archive with app and widget both at 1.6.3 (42);
all 1993 `en.json` strings in both Hermes bundles.

### Android — nothing but a real Android device can catch these

- [x] **Heatmap widget** — listed in the picker, added to the home screen, draws.
      Tested by Mahmood, 18 Sep 2026. This one had already been missing from the
      picker once, because `android/` was stale.
- [ ] **Tab bar clear of the navigation bar** — needs BOTH gesture navigation and
      3-button navigation; they report different insets and only one was reasoned
      about. Note that the AVD lies here: it reports a 24dp inset and draws 48dp
      glyphs, so Android's own Settings app looks broken on it too.
- [ ] **RESET / APPLY on the filters sheet** — same bug class, same two nav modes.
- [ ] **Notification permission** — Android 13+ asks at runtime. Denying it must
      not wedge the flow.
- [x] **Apple-on-Android sign-in** — an export whose TV Time account was Apple
      shows the "Apple sign-in doesn't exist on Android" text above Google and
      email, with no dead Apple button. Tested on the emulator, 18 Sep 2026.
- [ ] **Calendar (Plus)** — writes to the system calendar behind a runtime
      permission iOS does not have.

- [ ] **Upgrade over 1.6.2, not a fresh install** — this is what almost everyone
      gets, and a fresh install never exercises it. Library intact, no repair
      sweep. (`REPAIR_REV` is still `'11'`, unchanged since 1.1.2, so there
      should be none — this test is to confirm that holds.)
- [ ] **Plus purchase through Play Billing** — worth real attention this release:
      RevenueCat had a Google Play pub-sub incident, so a purchase that succeeds
      on the Play side may not grant `is_plus`. Buy as a licence tester, then
      check the account actually shows Plus.
- [ ] **Episode notification fires, and survives a reboot** —
      `POST_NOTIFICATIONS` and `RECEIVE_BOOT_COMPLETED` are both declared;
      whether the reschedule-on-boot path works has never been checked.
- [ ] **Widget tap-through** — the `com.insightfy.opentv.WIDGET_CLICK` receiver.
      Tapping an item in any of the four widgets must open that show, not just
      the app.
- [ ] **Hardware / gesture back** on the modal screens. Every modal is
      `transparentModal`, and Android has a back gesture iOS does not.
- [ ] **Arabic** — Android's RTL mirroring is a separate implementation from
      iOS's, and six locales ship.
- [ ] **Google Drive backup** — Android's half of the backup story; iOS's iCloud
      path does not test it.
- [ ] **Share sheet** — the ratings grid image out through Android's share sheet.
- [ ] **Play Data Safety form still matches** — the AAB pulls in `CAMERA`,
      `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW` and `ACCESS_ADSERVICES_AD_ID` from
      libraries rather than from our code. They are almost certainly unchanged
      from 1.6.2, but the declaration is rejected at review, not at upload.

### Self-hosting — tested end to end, 19 Sep 2026

- [x] **A self-hosted instance takes a real library.** `npm run selfhost` on the
      Mac, iPhone pointed at `http://<host>.local:8787`, signed in with Apple
      (which needs no configuration — `APPLE_BUNDLE_ID` defaults to ours).
      Landed: the profile, 243 ratings, 226 emotion votes, 22 character votes,
      3 comments with an image, 205 published shelf titles, a list and its 22
      items. The re-seed works because switching servers clears the published
      stamps; without that the app would think the new server already had
      everything and send nothing, for ever.
- [x] **Plain `http://` is accepted for a `.local` host**, and rejected for a
      bare LAN IP. Worth remembering when someone reports "it will not take my
      address".
- [x] **WebDAV backup works end to end** — tested 19 Sep against a wsgidav
      instance. `CONNECT` PUT a 4.5 MB `OpenTV Backup.zip` (62 files, the TV
      Time CSVs plus an 88 KB `_opentv_extras.json`) and reported "Backed up".
      Worth knowing for support: the WebDAV field accepts a bare IP over http,
      because `connectWebdav` only checks the scheme — unlike the community
      server field, which runs `normaliseServerUrl` and refuses one. And the
      Android emulator cannot resolve a `.local` name at all; it reaches the
      host as `10.0.2.2`.
- [ ] **Restore from that WebDAV backup** on a wiped install — the other half,
      and the one that matters. A backup nobody has restored is a rumour.
- [x] **Back up to your own OpenTV server** — 1.8 MB ZIP, 19 Sep, and restored
      onto Android from it. Needed a real fix first: `fsBucket` had no `head`,
      so a self-hosted backup uploaded fine and could never be found again. — `data/backups/` was still empty. This is
      the actual argument for self-hosting and has not been exercised.
- [ ] **A self-hosted community is EMPTY** — no other people, no aggregates.
      Known and by design, not yet said anywhere the user can read it.

### Checked and NOT defects, recorded so they are not chased again

- Emotion percentages missing on one device while the other showed them is the
  VOTE-SETTLING GUARD, not a lost rollup. The rollup a device holds during a
  vote is the one from before it, so a lone voter reads "100%" and then corrects
  itself to "50%" — the first number was never true and it is the one that
  sticks. `episode/[id].tsx:426` blanks the figure until it settles, and only on
  the first vote of each half. Seen 20 Sep with Android blank and the iPhone
  showing 8–9%; both read the same once settled.

- The join screen's paragraph is not clipped. The `ScrollView` has `flex: 1`
  and the buttons sit in a sibling view below it, so the text is inside a
  bounded scroll area and the cut is the scroll edge. A fade there would read
  better; nothing is unreachable.
- The heatmap widget reading "0 watched" was correct. The small widget covers
  three months ending today, the library's last episode watch is 29 May and its
  last film 24 June, so the window is genuinely empty. Worth knowing that a
  full library can produce an empty widget, which looks like a failure.

### Found on 20 Sep, all fixed

- [x] A device pointed at a self-hosted server and then back at ours kept the
      foreign cursor and went PERMANENTLY DEAF — it asked for everything after
      353 on a relay whose sequence reached 1, received nothing ever again, and
      reported itself in sync because the request kept succeeding. The cursor
      carries the account and the server now.
- [x] A second device arrived empty and waited to be told. The first sync on an
      account takes the backup by itself now, in the background, with nothing to
      press.
- [x] That seed stamped the account as done even when the lookup had FAILED, so
      a phone offline at the wrong moment would never seed again for the life of
      the install. A 404 earns the stamp; a dropped connection does not.
- [x] A restore honoured the un-tick tombstones and dropped 215 episodes of one
      show while its own diagnosis read `"verdict":"ok"`. A tombstone can be left
      by ANOTHER device's `unwatch` crossing the relay. A restore clears them
      now; re-importing an export still honours them.
- [x] The seed ran from the root effect, so a whole import landed on top of the
      first paint. It waits for the app to be idle.

- [x] Registering on a mail-less self-hosted instance was impossible — the code
      could never be delivered. Those accounts confirm themselves now and are
      marked `auto_verified`, which `linkTarget` refuses, so the provider
      takeover stays closed.
- [x] A sync cursor left over from a wiped relay silently skipped that relay's
      first ops. Caught live: one device read a season as 20/43 while the other
      read 43/43, and a film that had been removed stayed. Nothing errored.
- [x] "Create an account" was hidden whenever an address arrived with the
      screen — so a wiped server, a deleted account or an address from an export
      all left no way to register except failing a sign-in first.
- [x] An email address became a public display name and handle. Found on a store
      reviewer's profile, which was showing the owner's own review address.
- [x] Registering with a password never recorded that one existed, so Settings
      went on offering "Set a password".

### Found while testing, not fixed

- [~] **The silent re-import can sit on "Updating your library…" indefinitely.**
      On the first launch after an import, `runStartupRepairs` sees
      `reimportRev` behind `REIMPORT_REV` and re-runs the whole preserved ZIP
      through the importer. On the iPhone simulator, 19 Sep, it downloaded the
      comment images (files timestamped 01:41) and then wrote nothing for over
      fifteen minutes, holding the splash the entire time. CPU sat at ~8%,
      which is the Popcorn game animating, not import work.

      NOT new in 1.6.3: `REIMPORT_REV = '2'` was set on 11 Aug and shipped in
      1.6.1/1.6.2, so this path is already live for everybody who imported. That
      is the reason to look at it, not to ignore it — the failure is a launch
      that never finishes, and the only visible difference from a hang is that
      the game keeps moving.

      Worked around for testing by stamping `reimportRev` by hand. The real
      question is whether the metadata pass after the images has a timeout.

- [~] **Email sign-up is unreachable until a sign-in has failed.** The join
      screen passes the address from the TV Time export, which sets `locked`
      (`email-sign-in.tsx:91`), which both defaults the form to sign-in and
      hides the "create an account" toggle (line 374). The only way to register
      is to attempt a sign-in, receive `no_account`, and take the Create button
      the alert then offers.

      Deliberate — the comment says most people here are signing in to
      something that does not exist yet — but on a NEW server nobody has an
      account, so everybody meets a form that cannot succeed and no hint that
      failing it is the way through. Seen on the iPhone simulator against a
      self-hosted instance, 19 Sep.

### Device sync — the headline Plus feature, never run on two devices

Needs TWO devices signed into the SAME account, both Plus, on the official
server. Intent travels, not state, so the absences are the half that can
silently fail — and the failure mode is a resurrected library, not an error.

- [x] **On the OFFICIAL server, not just a self-hosted relay** — 20 Sep,
      afternoon. iPhone simulator and Android emulator both signed into
      `p_5a1c6a7e…`, both reading `sync.cursor = 108`, movies level at 304 on
      each. The morning's ticks below were taken against the self-host; this is
      the same behaviour against production.
- [x] **Cloud backup to the official server, read back from R2 itself** —
      20 Sep 17:03. `backups/p_5a1c6a7e….zip`, 1,937,575 bytes, and its
      `tracking-prod-records-v2.csv` holds 1,257 episode rows against the
      iPhone's 1,257 local watches, `tracking-prod-records.csv` 304 against 304
      films. Checked in the bucket rather than from the app's own stamp, which
      is the only way to tell "uploaded" from "said it uploaded".
- [~] **BOTH DEVICES WRITE TO ONE KEY.** `backups/<profileId>.zip` is per
      profile, not per device, so whichever backs up last wins. Twice today the
      cloud copy went from the fuller library to the thinner one and back. It is
      survivable only because each device keeps its own library locally — but a
      phone restoring in between would take whatever happened to be up there.
      Not a regression; the design has always been one slot per account.
- [x] **Mark watched on A → appears on B** — 20 Sep, Android → iPhone, on a
      self-hosted relay. The op crossed as `watch` carrying the ACTING device's
      timestamp, not the arrival time.
- [x] **UNmark on A → disappears on B.** 20 Sep. Crossed as its own `unwatch`
      op — an absence, not a diff — and applied. This is the one that would
      have resurrected deleted history for ever if it had failed quietly. The whole design exists for this. A
      sync built on the backup ZIP would resurrect it instead, for ever.
- [x] **Rate on A → same stars on B**, and **feel on A → same feeling on B** —
      20 Sep 17:24, BOTH directions, Adventure Time S04E01. Five stars and
      `AMUSED` set on the iPhone, read on Android; changed on Android, read back
      on the iPhone. Both screens then agreed down to the rollup: `WOW 100%`,
      `AMUSED 100%`, every other tile `0%`.
- [x] **Take a rating back on A → gone on B** — 20 Sep 17:26. The five stars and
      `AMUSED` both swept away, and both devices went to no stars, no feeling
      and NO PERCENTAGES AT ALL — the rollup has nothing left to count, which is
      the proof the removal reached the server and not just the screen. This is
      the half that fails quietly: a sync built on the backup ZIP would have
      resurrected both, for ever, because an export is made only of things you
      have.
- [x] **Delete a film on A → gone on B** — `movieWatch {on:false}`, 20 Sep.
- [ ] **Ordering**: rate then unrate leaves nothing; unrate then rate leaves a
      rating. Ordered by the clock of the device that acted, not by arrival.
- [ ] **A device offline for a while** pushes its backlog and still lands in the
      right order behind a device that acted later.
- [ ] **Plus lapses on A**: A stops sending, still receives, still holds
      everything. Renewing resumes from the outbox rather than restarting.
- [ ] **Counters derived correctly on B** — episode counts, streaks, the widget
      and the calendar all come from replaying intent through the same
      functions the screens use. If any of them disagrees between devices, the
      intent path is being bypassed somewhere.

### Both platforms — changed on 18 Sep, only ever run on the iOS simulator

- [ ] **Import + Popcorn** — play through a real import on a wiped install. The
      game must survive completion, keep its size, and offer DONE.
- [ ] **LET'S GO** → notification screen → community join.
- [ ] **Restore screen, all four buttons** — "I use my own server" and "Continue
      with email" were the dead pair.
- [ ] **Wrapped with one watched item** — the threshold is now 1.
- [ ] **Backup → restore round trip** — the headline fix, and Android is the
      platform that loses your decade.
- [ ] **Update gate** — the existing min-version check still behaves.
      (`iosSuggestedVersion` / `androidSuggestedVersion` go into `version.json`
      only AFTER 1.6.3 is live.)
