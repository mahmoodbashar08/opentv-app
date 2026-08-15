# OpenTV — Roadmap

What is being built, what is not, and why. Updated 15 Aug 2026.

Shipped work lives in [CHANGELOG.md](CHANGELOG.md). This file is only about
what is ahead.

**Now:** 1.4.0, live on both stores — Wrapped, private accounts, TV Time friend
reconnect.

---

## The one rule everything here is measured against

> Your library lives on your phone. The server is a convenience, never a
> dependency.

There is no watch-history table on the server, by design. If it vanished
tomorrow every user would keep their complete history and lose only other
people's comments and ratings. Anyone who does not want the community layer
never contacts it at all.

Every item below either respects that or does not get built. It is also why
some obvious features are in [Not planned](#not-planned) rather than here.

---

## 1.5.0 — next

### Shared lists
A list two people build together. Both add to it, both tick things off, and
every row says who suggested it.

The paywall is on the door handle, not the door: past your first list, starting
one needs Plus — **joining never does, at any tier, ever**. A list whose
invitees have to pay to accept is a list of one person.

### Where to watch, fixed
Three real bugs, all reported in Discord:

- The region is hardcoded to the US, so everybody everywhere is told their show
  is on Peacock. It will come from your phone's locale, with a picker.
- The settings button next to it does nothing — a control with no handler.
- Only `flatrate` is read, so a film you could rent, buy, or watch free with
  adverts reads as "not available".

Plus provider logos instead of a text list, and a trailer thumbnail that opens
the studio's official video rather than a reupload.

### Live translation of comments
A comment in Arabic gets a Translate row for a French reader. In-app, on
demand, per comment.

Run on Cloudflare Workers AI, where the comment already sits — so translating
it sends nothing anywhere new. Google Translate or DeepL would mean every
comment leaving for a third party.

Six languages and no way to read across them was always going to be the gap.

### A web page for a profile
`theopentv.com/@handle` — the shelves, lists and stats that are *already*
published to the server, rendered as a page.

No sync and no new data. Sharing your profile with somebody who does not have
the app currently shows them nothing, which is odd for the one screen designed
to be shared.

---

## After 1.5.0

### Sync — end-to-end encrypted
A lost phone should not be a lost decade.

The hard parts are conflict resolution and key recovery, not the uploading.
It will be encrypted on the device with a key the server never has, because
the alternative is the server reading exactly what this project has spent its
whole life not reading.

### A real web app — after sync, and only after
The browser has no SQLite on your phone to read, so a web client that shows
**your** library cannot exist before sync does. The order is forced.

When it comes it decrypts in the browser with your own key, the way Proton and
Standard Notes do it.

### Images and GIFs in new comments
Old imported TV Time photos already come across. Attaching a new one does not
exist yet, and the honest blocker is not the picker — it is that every upload
has to be looked at by a human before anyone else sees it. Serving other
people's photographs means owning what is in them.

---

## Known bugs, openly

- **A deleted account never signs the phone out.** The oldest correctness hole
  in the community layer. A deleted profile answers `not_found` rather than
  `unauthenticated`, so the device shows itself as signed in indefinitely.
- **The comments screen freezes at 800+ comments** — a `ScrollView` with
  `.map()` and no virtualisation. The only open bug that can lock up a real
  library.

---

## OpenTV Plus

Not on sale. The code ships dark behind a flag; the entry points are hidden.

When it arrives it will be about **what the server does for you**, never about
your own data:

| Free, forever | Plus |
|---|---|
| The whole tracker — import, history, stats, Wrapped, widgets, notifications, offline | Deep Stats and personality |
| The community — comments, ratings, follows, profiles | Unlimited published lists and favourites |
| Privacy controls | Profile themes and app icons |
| Publishing 20 favourites and 10 lists | Supporter badge |

Two commitments:

**Nothing that is free today becomes paid.** The publish caps were set *before*
the community shipped, deliberately — a cap added later takes something away
from people who already had it, which is the mistake Trakt is still known for.

**Privacy is never paid.** Private accounts and per-section visibility are free
and will stay free. Paywalling privacy is indefensible.

Wrapped is free too, and always will be: it is the one feature built to leave
the app, and charging for it would be charging for your own advertising.

---

## Not planned

Listed so nobody has to ask twice.

- **Watch history on the server.** The entire point. See the rule at the top.
- **Automatic tracking / scrobbling.** Would mean a server watching what you
  watch.
- **Ads.** Not now, not at any size.
- **A native anime database (AniDB / Anilist).** TheTVDB is the metadata source
  and covers anime as Western seasons. A second source with a different episode
  numbering scheme is a large amount of work for a subset of one library, and
  it would fork every screen that counts episodes.
- **Selling or sharing any data.** There is nothing to sell — the library never
  arrives here.

---

## How this gets decided

Most of what shipped in the last month came from people reporting things, and
the ordering above reflects that more than any plan did.

- **Discord:** [TV Time Refugees](https://discord.gg/J2SdCMR5S)
- **Reddit:** [r/OpenTvApp](https://reddit.com/r/OpenTvApp)
- **Issues:** right here

Dates are deliberately absent. This is one person working evenings, and a date
would be a guess dressed as a promise.
