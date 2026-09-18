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
- [ ] **Back up to your own server** — `data/backups/` was still empty. This is
      the actual argument for self-hosting and has not been exercised.
- [ ] **A self-hosted community is EMPTY** — no other people, no aggregates.
      Known and by design, not yet said anywhere the user can read it.

### Device sync — the headline Plus feature, never run on two devices

Needs TWO devices signed into the SAME account, both Plus, on the official
server. Intent travels, not state, so the absences are the half that can
silently fail — and the failure mode is a resurrected library, not an error.

- [ ] **Mark watched on A → appears on B**
- [ ] **UNmark on A → disappears on B.** The whole design exists for this. A
      sync built on the backup ZIP would resurrect it instead, for ever.
- [ ] **Take a rating back on A → gone on B**
- [ ] **Delete a film on A → gone on B**
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
