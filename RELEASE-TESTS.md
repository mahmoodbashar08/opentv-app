# Release tests

What has actually been run on a real device for the release being prepared, and
what has not. Kept because "did we test that?" is otherwise answered from memory
a week later, and memory says yes.

**Reset this file at the start of each release.** A tick is worthless if it might
be from the previous version.

Conventions: `[x]` run and passed, `[ ]` not run, `[~]` run and failed — with the
failure written next to it, not in a commit message.

---

## 1.6.6 — built 4 Oct 2026 (iOS 50, Android 65)

Reset 4 Oct 2026. The 1.6.4 results are in git history. Tested on Mahmood's
iPhone through Metro unless it says otherwise.

### Comments and CommsUni
- [ ] An episode's comments: OpenTV comments first, then the "Comments by CommsUni.tv" bar, then CommsUni's; no sort buttons
- [ ] Your own comment shows once, with the OPENTV pill; names read "display name" with "@username · date"
- [ ] Open a CommsUni comment → yellow pencil → reply → it appears; ⋯ → Delete on your reply removes it
- [ ] Write a new comment with the pencil (CommsUni share question appears the first time)
- [ ] Comment pictures load once and then open instantly

### Banner and theme
- [ ] Edit profile → Adjust banner: drag (sideways and up/down), pinch, GIF keeps playing
- [ ] Drag the yellow ↕ handle to make the banner taller / shorter
- [ ] Smooth edge on/off; Banner overlay slider 0–100% and a colour; Cancel restores
- [ ] Upload tab: your own GIF and a photo; adjuster opens after
- [ ] A colourful artwork or GIF changes the theme; a black-and-white one gives neutral
- [ ] Theme colours (Edit profile and adjuster) → pick → profile repaints; Reset to OpenTV colours
- [ ] Profile: scroll down — banner shrinks keeping its middle; pull down — it grows, no gap
- [ ] GIF search: results arrive after a pause, start at the top

### Profile and account
- [ ] Edit profile → Username → a name with a dot (taken / available as you type)
- [ ] "Joined …" shows at once on reopening
- [ ] Wrapped → September: the summary card first (5 films, 3 + 2), Share sends it

### Plus, backup, sync
- [ ] Backup to OpenTV turns on by itself for a Plus account (message once)
- [ ] Settings → Cloud backup shows a recent backup

### Other
- [ ] Stremio sign-in (needs a Stremio account)
- [ ] Search → open a show → mark a whole season: no keyboard pops up
- [ ] Android (APK on the emulator): opens, comments, Wrapped card, Arabic right-to-left
