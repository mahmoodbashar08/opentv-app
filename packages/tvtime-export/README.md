# tvtime-export

Read a TV Time GDPR export (the ZIP TV Time emailed when you asked for your
data) into plain objects: shows, episode watches, films and the watchlist,
ratings, emotions, lists, favourites, comments, the profile, and the people
you followed.

It is the reader [OpenTV](https://github.com/mahmoodbashar08/opentv-app) imports
with, taken out of the app so other tracker apps can use it too. It has
no Expo, React Native or database code in it. Its one dependency is
[`fflate`](https://github.com/101arrowz/fflate), for the ZIP.

Licence: [MPL-2.0](https://mozilla.org/MPL/2.0/). Use it in a closed-source
app if you like; changes to these files themselves stay open.

## Use

```ts
import { exportReader, readEpisodeWatches, readMovies, readShows, unzipExport } from 'tvtime-export';

const files = unzipExport(zipBytes); // throws on a file that is not a ZIP
const { csv } = exportReader(files);

const shows = readShows(csv('user_tv_show_data.csv'), csv('followed_tv_show.csv'));
const watches = readEpisodeWatches(csv('tracking-prod-records-v2.csv'));
const { movies } = readMovies(csv('tracking-prod-records.csv'));
```

Every `read…` function takes parsed rows and returns plain data. Nothing is
written anywhere and nothing goes over the network. Deciding what to keep is
up to you. The notes below cover what OpenTV learned about that the hard way.

| Function | File(s) | Gives you |
|---|---|---|
| `unzipExport` | the ZIP | the files, with a double-zipped download unwrapped |
| `isTvTimeExport` | the ZIP | whether it is a TV Time export, judged by what is inside it |
| `exportReader` | any | `csv`, `csvLoose` and `communityCsv` lookups (see the doc comment) |
| `readShows` | `user_tv_show_data`, `followed_tv_show` | tracked shows, followed / favourite / archived |
| `readEpisodeWatches` | `tracking-prod-records-v2` | one watch per row, with date, runtime and TheTVDB episode id |
| `isV1EpisodeWatch` | `tracking-prod-records` | which legacy rows are episode watches |
| `readMovies` | `tracking-prod-records` | watched films, the watchlist and rewatch counts |
| `movieNamesByUuid` | both tracking files | film uuid → title (see below) |
| `readEpisodeRatings`, `readMovieRatings` | `ratings-3-prod-episode_votes`, `ratings-live-votes` | 1–5 stars |
| `readEpisodeEmotions`, `readMovieEmotions` | `emotions-3-prod-episode_votes`, `emotions-live-votes` | `EMOTIONS` |
| `readEpisodeWatchedOn`, `readCharacterVotes` | `watched_on_episode`, `show_character_episode_vote` | where you watched it, your favourite character (by id only) |
| `listEntries`, `readFavorites` | `lists-prod-lists` | list contents, favourites in their own order |
| `readComments` | `comments-prod-comments`, `episode_comment`, `meme` | your comments, with picture URLs |
| `readProfile`, `tvtimeSignIn`, `readFriendIds` | `routing-prod-users`, `user_personal_data`, `auth-prod-login`, `friend`, … | profile, sign-in hint, who you followed |
| `readNotifications` | `notifications-prod-notifications` | your followers with names, and the notification feed |
| `readCommunityExport` | `tvtime-series-*.csv` etc. | the unofficial browser-extension export, mapped onto the GDPR columns |

## What the export does not tell you straight

### The list uuid problem

In `lists-prod-lists.csv`, a list's contents are a Go-printed blob in the
`objects` column:

```
map[created_at:1.6e+09 id:267440 type:series] map[created_at:1.6e+09 type:movie uuid:d42b395b-…]
```

A **series** entry carries a TheTVDB id, so you can always name it. A **film**
entry has only a uuid: no title, no TheTVDB or TMDB id, nothing else. That
uuid is TV Time's own id for the film. The only places the export puts a
title next to it are the tracking rows, so `movieNamesByUuid` can name a listed
film only if you also watched it, put it on your watchlist, or rated it.

A list is mostly things you have *not* watched yet, so most of its films stay
unnamed. On one real export, a 22-film list had only 8 uuids that appeared
anywhere else in the export. An importer that drops what it cannot name will
import that list as 8 films and say nothing about the other 14.

`listEntries` gives you every uuid in order, named or not. **Keep the ones you
cannot name.** Store them, show the list's real size, and resolve them later.
The same uuid means the same film in every user's export. So a film one user
never tracked has very likely been tracked by somebody else who listed it, and
a uuid → title table built up across many exports names most of them. One
exception: don't collect these from a series entry. A series entry carries a
`uuid:` field of its own, and reading it as a film's uuid is easy to do by
mistake. `listEntries` only reads a uuid from a film entry.

Favourite films (`favorite-movies`, a special row in the same file) are uuids
too, and have the same problem.

### Counters lie, rows don't

`user_tv_show_data.csv` has `nb_episodes_seen`, and it is often inflated by
rewatches and by marking an episode watched more than once. In one export it
said 84 for a show with a single watch row. Trust the rows. Some shows really
were bulk-marked, and TV Time kept only the count and no rows for them. The
legacy file's `count-watch-episode-series` row is a usable cross-check: when it
agrees with the rows you have, the rows are complete and the counter is wrong.

### Two tracking files, and one of them is partly stale

`tracking-prod-records-v2.csv` is current. `tracking-prod-records.csv` is the
2021-era file. Films only ever live there, and so do some old episode watches
that never made it into v2. It also still holds shows that TV Time's own
migration deliberately left out of v2. OpenTV's rule is to believe a legacy
episode row only when v2 has rows for the same show, or when v2 has no episode
rows at all (an old export).

### Votes name the show, not its id

Episode ratings, emotions, where-watched and character votes give the show's
**name** and no id. Match names case- and space-insensitively against your
shows and against v2's `series_name` column, which teaches you the other
spellings TV Time used. Otherwise votes quietly vanish.

### Rating scales

Ratings come on two scales in the same file. The current one is 0–3 (bad,
good, great, wow) and the legacy one is 26–30. `ratingStars` maps both to 1–5.
Emotion ids 28–39 are a different id space that happens to overlap; for
episodes they are returned as 0–11.

### Dead links

Every image URL in the export (avatars, covers, comment pictures and GIFs)
points at TV Time's CDN, which went down with the service. Profile covers were
TheTVDB fan art, and `tvdbRescueUrl` finds most of them again on TheTVDB's
current CDN. Comment pictures are gone unless somebody kept a copy. Keep
`tvtimeUuid` on every comment, because that uuid is how an archive of them
would be addressed.

### Odd values

- Some comment captions are the literal string `null`, which TV Time wrote
  itself. `commentText` reads these as empty.
- Two different films can share a title. `readMovies` gives the second one a
  year suffix, but only when the rows give them different ids.
- Private lists have no name in the export.
- Dates come exactly as the file wrote them (`2021-05-21 12:25:23`, no time
  zone). They are left alone, so a second import of the same export matches
  the first.

## Tests

```bash
npx jest packages/tvtime-export
```

The tests use small exports written in the shapes the real files take, so
they need no real export on disk.
