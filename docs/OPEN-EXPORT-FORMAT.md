# Open tracker export format — draft 0.1

**Status: a proposal for discussion. No app writes this yet, OpenTV included.**
It is here so that developers of TV and film trackers have something concrete
to disagree with.

## Why

When TV Time shut down, the only thing people could take with them was a GDPR
dump. Each new app had to reverse-engineer that dump on its own, and a lot of
history didn't survive the move. Films in lists were named only by a uuid,
counters didn't match the rows, ratings came on two scales, and every picture
pointed at a CDN that no longer existed. The next app to close shouldn't strand
anyone like that.

The goal is one file that any tracker can write and any tracker can read, so a
user can move their whole history between apps (or keep a copy that doesn't
depend on any of them) with nothing lost and nothing guessed.

## Principles

1. **The user's own data only.** Their watches, ratings, lists, comments and
   pictures. No other person's name, handle, avatar or comment, so a file can be
   shared without leaking anyone else.
2. **Real ids AND titles, everywhere.** Every show, episode and film carries
   every id the writer knows (TheTVDB, TMDB, IMDb, …), plus its title and year.
   An id makes the match exact. The title makes the file readable by people,
   and it is the fallback when the reader doesn't know any of the ids. A list
   entry that is only a uuid is exactly what this format exists to prevent.
3. **Rows, not counters.** Each watch is a record with its own date. A total is
   never stored on its own, because totals drift and nobody can tell which part
   is wrong.
4. **No precision thrown away.** Ratings are out of ten. A date with no known
   time stays a date. A watch with no known date says so (`null`) instead of
   being given a made-up one.
5. **Readers ignore what they don't understand.** Unknown keys are skipped,
   never rejected, and app-specific data goes under an `x-<app>` key. This
   keeps a 0.1 reader working on a 0.3 file.
6. **Pictures travel inside the file.** A URL is not a backup.

## The container

A ZIP file with the extension `.opentrack.zip` (the name is open for
discussion):

```
manifest.json      required
shows.json         optional — shows, episodes, watches
movies.json        optional — films, watches, watchlist
lists.json         optional
comments.json      optional
profile.json       optional
images/            optional — every picture the JSON files point at
```

Each section has its own file, so an app that only tracks films can write
`movies.json` alone, and a reader can skip a section it doesn't support. Every
file is UTF-8 JSON, and images are stored without compression (they are
already compressed).

### Shared conventions

- **Dates** are ISO 8601. A full timestamp carries its offset
  (`2021-05-21T12:25:23Z`). When only the day is known, write just the date
  (`2021-05-21`). When the date is unknown, write `null`. Never invent a
  timestamp to fill a gap.
- **`ids`** is an object with any of these keys: `tvdb`, `tmdb`, `imdb`,
  `trakt`, `simkl`, `mal`, `anilist`, `letterboxd`, `tvtime`. Numbers stay
  numbers, and IMDb ids stay strings (`"tt0113277"`). Writers include every id
  they know. Readers match on the first id they recognise, then fall back to
  title + year.
- **`rating`** is an integer from 1 to 10, or `null` for not rated. Five whole
  stars become 2/4/6/8/10, and half stars land on the odd numbers. A writer
  whose app uses a different scale converts it and says which in
  `manifest.rating_source`, so a reader can convert back without losing
  anything.
- **`emotions`** is a list of strings taken from this fixed vocabulary:
  `shocked`, `frustrated`, `sad`, `reflective`, `touched`, `amused`, `scared`,
  `bored`, `understood`, `thrilled`, `confused`, `tense`. Anything else goes
  under `x-<app>`. The vocabulary can grow in later versions, but the meaning
  of an existing word never changes.
- **`image`** is an object: `{ "path": "images/…", "width": 600, "height": 900,
  "type": "image/jpeg" }`. The path is relative to the ZIP root. Allowed types
  are `image/jpeg`, `image/png`, `image/webp` and `image/gif`, and a GIF stays a
  GIF so it still animates. Name the file after a hash of its contents
  (`images/3f9a….jpg`). That way the same picture used twice is stored once.

The ids and uuids in the examples below are illustrative only.

## manifest.json

```json
{
  "format": "open-tracker-export",
  "format_version": "0.1",
  "created_at": "2026-10-13T09:30:00Z",
  "generator": { "app": "OpenTV", "version": "2.0.0", "url": "https://example.org" },
  "rating_source": { "scale": "stars-5-half", "note": "films in half stars, episodes in whole stars" },
  "sections": ["shows", "movies", "lists", "comments", "profile"],
  "counts": { "shows": 117, "episode_watches": 1104, "movies": 304, "lists": 4, "comments": 35, "images": 41 }
}
```

`counts` is there so a reader can check it got everything, and so it can show
"104 of 117 shows matched" instead of failing without a word. It is never a
substitute for the rows.

## shows.json

```json
{
  "shows": [
    {
      "ids": { "tvdb": 121361, "tmdb": 1399, "imdb": "tt0944947" },
      "title": "Game of Thrones",
      "year": 2011,
      "status": "finished",
      "favorite": true,
      "favorite_rank": 0,
      "added_at": "2019-03-02T18:00:00Z",
      "rating": 9,
      "artwork": {
        "poster": { "path": "images/3f9a1c.jpg", "width": 680, "height": 1000, "type": "image/jpeg" },
        "backdrop": null
      },
      "episodes": [
        {
          "season": 1,
          "number": 1,
          "ids": { "tvdb": 3254641, "tmdb": 63056 },
          "title": "Winter Is Coming",
          "watches": [
            { "at": "2019-03-02T21:14:00Z", "where": "tv" },
            { "at": "2023-01-08", "where": null }
          ],
          "rating": 8,
          "emotions": ["shocked", "tense"]
        },
        {
          "season": 1,
          "number": 2,
          "ids": { "tvdb": 3436411 },
          "title": "The Kingsroad",
          "watches": [{ "at": null, "where": null }],
          "rating": null,
          "emotions": []
        }
      ]
    }
  ]
}
```

- `status` is one of `watching`, `planned`, `paused`, `stopped` or `finished`.
  Use `null` when the app has no such idea.
- Seasons and episodes use **TheTVDB's aired order**. TheTVDB is the one
  numbering every major tracker can map to, and TV Time's own data uses it. The
  episode's own `ids` settle any disagreement: a reader whose source numbers
  the show differently should match on the episode id, not on the position.
  Specials are season 0.
- Each rewatch is another entry in `watches`. Two entries mean the episode was
  watched twice, and there is no separate counter.
- `{ "at": null }` means watched, date unknown. That covers a season someone
  marked as seen all at once. It is still a real watch, unlike an episode with
  no watches at all.
- `artwork` holds pictures the **user chose** (a custom poster or backdrop).
  Leave out the catalogue's default artwork, which any reader can fetch for
  itself.

## movies.json

```json
{
  "movies": [
    {
      "ids": { "tmdb": 949, "imdb": "tt0113277", "tvdb": 1062 },
      "title": "Heat",
      "year": 1995,
      "watches": [
        { "at": "2020-11-14T22:05:00Z", "where": "cinema" },
        { "at": "2024-02-01", "where": null }
      ],
      "watchlist_added_at": null,
      "rating": 9,
      "emotions": ["thrilled"],
      "favorite": true,
      "favorite_rank": 2,
      "artwork": { "poster": null, "backdrop": null }
    },
    {
      "ids": { "tmdb": 693134 },
      "title": "Dune: Part Two",
      "year": 2024,
      "watches": [],
      "watchlist_added_at": "2023-06-01T10:00:00Z",
      "rating": null,
      "emotions": [],
      "favorite": false,
      "favorite_rank": null,
      "artwork": { "poster": null, "backdrop": null }
    }
  ]
}
```

An empty `watches` list together with a `watchlist_added_at` means the film is
on the watchlist. Two different films with the same title ("Dune" 1984 and
2021) are two entries, told apart by `ids` and `year`. Never merge them by
title.

## lists.json

```json
{
  "lists": [
    {
      "id": "b7d0c3e2-1f7a-4e55-9d1e-0c2f4b0e6a11",
      "name": "Watch next",
      "description": "Recommended by friends",
      "public": false,
      "created_at": "2021-05-21T12:25:23Z",
      "items": [
        { "type": "show", "ids": { "tvdb": 267440, "tmdb": 46952 }, "title": "The Blacklist", "year": 2013, "added_at": "2021-05-21T12:25:23Z" },
        { "type": "movie", "ids": { "tmdb": 335984, "imdb": "tt1856101" }, "title": "Blade Runner 2049", "year": 2017, "added_at": null },
        { "type": "movie", "ids": { "tvtime": "d42b395b-6b3c-4a7e-9d0e-3c1b2a4f5e6d" }, "title": null, "year": null, "added_at": null }
      ]
    }
  ]
}
```

- Items are in the user's own order.
- **Every item carries a title** unless the writer has no way to know it. The
  third item above shows the only case where `title: null` is allowed: the
  writer itself imported the entry from an export that named it by an opaque
  id. In that case it passes the id on as it found it, and it does **not**
  drop the item. A reader shows it as an unnamed entry and keeps it, so the
  list stays the right length.
- `id` is the writer's own id for the list. It lets a second import of the same
  file recognise the list it already has instead of making a copy.
- A list may have no items. A list someone named but hasn't filled yet is
  still a list.

## comments.json

```json
{
  "comments": [
    {
      "id": "c-2019-03-02-0001",
      "target": { "type": "episode", "show": { "ids": { "tvdb": 121361 }, "title": "Game of Thrones", "year": 2011 }, "season": 1, "number": 9 },
      "text": "I did not see that coming.",
      "created_at": "2019-03-02T22:01:00Z",
      "spoiler": true,
      "images": [
        { "path": "images/9be2d0.gif", "width": 480, "height": 270, "type": "image/gif" }
      ],
      "x-tvtime": { "comment_uuid": "5f0c…" }
    },
    {
      "id": "c-2020-11-14-0002",
      "target": { "type": "movie", "movie": { "ids": { "tmdb": 949 }, "title": "Heat", "year": 1995 } },
      "text": "",
      "created_at": "2020-11-14T23:59:00Z",
      "spoiler": false,
      "images": [
        { "path": "images/51ac77.jpg", "width": 1080, "height": 1350, "type": "image/jpeg" }
      ]
    }
  ]
}
```

- `target.type` is `show`, `episode` or `movie`. The target carries ids and a
  title, just like a list item.
- A comment can be text only, or one or more pictures with an empty `text`.
  It must have at least one of the two.
- Only the user's own comments go in the file. A reply the user wrote is
  included, but without the comment it answered (that belongs to someone
  else). Likes and reply counts are other people's actions and are left out.
- Keep any id the original service used under `x-<service>`. It may be the
  only way to find a picture again once that service's CDN is gone.

## profile.json

```json
{
  "profile": {
    "display_name": "Sam",
    "username": "sam_watches",
    "bio": "Mostly crime dramas.",
    "country": "GB",
    "avatar": { "path": "images/a1b2c3.jpg", "width": 400, "height": 400, "type": "image/jpeg" },
    "cover": { "path": "images/d4e5f6.jpg", "width": 1920, "height": 1080, "type": "image/jpeg" },
    "previous_accounts": [
      { "service": "tvtime", "username": "sam_watches", "id": "42" }
    ]
  }
}
```

`previous_accounts` lets someone's old identity follow them, so friends who
move to the same app can find each other again. It only names the user's own
accounts. The list of people they followed is deliberately not part of 0.1
(see the open questions).

## Writing and reading

- **Write all the rows you have.** If the app only knows a total, write the
  rows it has and leave the total out.
- **Read merge-safe.** Importing the same file twice must add nothing the
  second time. Treat a watch as a duplicate when it has the same item, season,
  number and `at`, and a comment as a duplicate when it has the same target,
  text and `created_at`.
- **Report what didn't fit.** A reader that can't place an item should tell
  the user which one and why, rather than dropping it without a word.

## Open questions for 0.1 → 0.2

1. **One file or several?** Separate files let a films-only app skip shows,
   but a single `library.json` is simpler to stream and to diff.
2. **Episode numbering.** Is TheTVDB aired order acceptable to apps built on
   TMDB, or do we need `numbering: "tvdb" | "tmdb"` on each show?
3. **Where-watched vocabulary.** `tv`, `cinema`, `computer`, `phone`,
   `tablet`, `other`? Or should this be free text?
4. **Rating precision.** Is 1–10 enough? Some apps rate 0–100. If we used
   1–100 we would lose nothing, but anything over ten is false precision for
   most apps.
5. **The follow graph.** Exporting who someone followed would help them
   reconnect, but it names other people. Should it be an opt-in section, or
   left out entirely?
6. **Image size limits.** Should there be a maximum per picture, or a maximum
   for the whole file?
7. **Signing.** Should the manifest carry a hash of each file, so a reader can
   tell a damaged ZIP from a deliberately edited one?

Comments and counter-proposals are welcome. The whole point is that this
belongs to everyone who builds a tracker, not to one app.
