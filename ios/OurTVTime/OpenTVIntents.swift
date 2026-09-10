//
//  OpenTVIntents.swift
//  OpenTV
//
//  "Hey Siri, mark watched in OpenTV."
//
//  IN THE APP TARGET, NOT AN EXTENSION. App Intents are discovered by the
//  system from the app binary itself, so this needs no new target — which
//  matters here more than usual: `npx expo prebuild` regenerates the Xcode
//  project and has already deleted the widget extension once. One Swift file in
//  a target that already exists is the smallest surface this feature can have.
//
//  IT NEVER TOUCHES THE LIBRARY. The intent reads a small index the app writes
//  into the shared App Group — followed shows, and where each one is up to —
//  and appends a request to a queue the app drains when it next runs. Marking an
//  episode watched touches watch rows, counters, widgets and the community
//  seed; that logic lives once, in TypeScript, and a second copy of it in Swift
//  is how a counter gets broken. See src/siri-bridge.ts.
//
//  WHAT THE USER HEARS IS STILL TRUE AND STILL IMMEDIATE: the index tells the
//  intent exactly which episode it queued, so Siri answers "Marked The Bear
//  S2E5" rather than "done". Only the database row waits.
//
import AppIntents
import Foundation

private let appGroup = "group.com.insightfy.opentv"

private func groupURL() -> URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
}

// MARK: - The index the app publishes

private struct SiriShow: Codable {
    let id: Int
    let name: String
    let nextSeason: Int?
    let nextEpisode: Int?
    let lastSeason: Int?
    let lastEpisode: Int?
}

private struct SiriMovie: Codable {
    let name: String
    let year: String?
    let watchedAt: String?
    /// The English title, recorded as such rather than guessed from a list.
    let en: String?
    /// Every other name, for the text search behind the scenes.
    let alt: [String]?
}

private struct SiriIndex: Codable {
    let updatedAt: String
    let shows: [SiriShow]
    let movies: [SiriMovie]?
}

private func loadIndexFile() -> SiriIndex? {
    guard let dir = groupURL(),
          let data = try? Data(contentsOf: dir.appendingPathComponent("siri-index.json"))
    else { return nil }
    return try? JSONDecoder().decode(SiriIndex.self, from: data)
}

private func loadIndex() -> [SiriShow] { loadIndexFile()?.shows ?? [] }
private func loadMovies() -> [SiriMovie] { loadIndexFile()?.movies ?? [] }


// MARK: - Matching what was said to what is in the library
//
// Speech gives back a title with no punctuation, sometimes without an article,
// and occasionally with a word missing. So the comparison is done on a folded
// form — lowercased, diacritics dropped, punctuation removed — and then in three
// passes: exact, prefix, contains. Exact first matters: "Dune" must not lose to
// "Dune: Part Two" simply because the second contains it.

private func fold(_ s: String) -> String {
    s.folding(options: [.diacriticInsensitive, .caseInsensitive, .widthInsensitive], locale: nil)
        .components(separatedBy: CharacterSet.alphanumerics.inverted)
        .filter { !$0.isEmpty }
        .joined(separator: " ")
}

/// Drops a leading article, so "the bear" and "bear" are the same query — the
/// same rule the app's own A–Z sort uses.
private func withoutArticle(_ s: String) -> String {
    for a in ["the ", "a ", "an "] where s.hasPrefix(a) {
        return String(s.dropFirst(a.count))
    }
    return s
}

private func ranked<T>(_ items: [T], spoken: String, name: (T) -> String) -> [T] {
    let q = withoutArticle(fold(spoken))
    guard !q.isEmpty else { return [] }
    var exact: [T] = [], prefix: [T] = [], contains: [T] = []
    for item in items {
        let n = withoutArticle(fold(name(item)))
        if n == q { exact.append(item) }
        else if n.hasPrefix(q) || q.hasPrefix(n) { prefix.append(item) }
        else if n.contains(q) || q.contains(n) { contains.append(item) }
    }
    /*
     * THE BEST TIER WINS OUTRIGHT, and this is the difference between an answer
     * and a menu. Returning every match together meant one exact hit arrived
     * beside four loose ones, so Siri asked "which one?" and made the user tap
     * a list for a film it had already identified. Say "Red Turtle" and the
     * exact row is the answer; the weaker tiers only matter when nothing
     * better exists.
     */
    if !exact.isEmpty { return Array(exact.prefix(4)) }
    if !prefix.isEmpty { return Array(prefix.prefix(4)) }
    // Capped: Siri reads a disambiguation list aloud, and a list of forty is a
    // worse answer than the wrong one.
    return Array(contains.prefix(6))
}

private func matchShows(_ shows: [SiriShow], spoken: String) -> [SiriShow] {
    ranked(shows, spoken: spoken, name: { $0.name })
}

/// Matches on every name a film answers to, then keeps the best tier across all
/// of them — so "The Red Turtle" finds a row stored as "La Tortue rouge".
private func matchMovies(_ movies: [SiriMovie], spoken: String) -> [SiriMovie] {
    let byName = ranked(movies, spoken: spoken, name: { $0.name })
    if !byName.isEmpty { return byName }
    let byAlias = movies.filter { m in
        (m.alt ?? []).contains { !ranked([$0], spoken: spoken, name: { $0 }).isEmpty }
    }
    return Array(byAlias.prefix(4))
}

// MARK: - The show, as something Siri can resolve from speech

struct ShowEntity: AppEntity, Identifiable {
    let id: Int
    let name: String
    let nextSeason: Int?
    let nextEpisode: Int?
    let lastSeason: Int?
    let lastEpisode: Int?

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Show"

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }

    static var defaultQuery = ShowQuery()
}

/// Resolves a spoken title against the followed shows in the index.
///
/// `EntityStringQuery` AND NOT `EntityQuery`, which is the difference between
/// working and not. A plain query can only OFFER a list; matching words a person
/// actually said needs `entities(matching:)`. Without it Siri asks "which
/// show?", cannot understand the answer, and asks again — which is exactly what
/// the first build did.
struct ShowQuery: EntityStringQuery {
    func entities(matching string: String) async throws -> [ShowEntity] {
        matchShows(loadIndex(), spoken: string)
            .map {
                ShowEntity(
                    id: $0.id, name: $0.name,
                    nextSeason: $0.nextSeason, nextEpisode: $0.nextEpisode,
                    lastSeason: $0.lastSeason, lastEpisode: $0.lastEpisode
                )
            }
    }

    func entities(for identifiers: [Int]) async throws -> [ShowEntity] {
        loadIndex()
            .filter { identifiers.contains($0.id) }
            .map {
                ShowEntity(
                    id: $0.id, name: $0.name,
                    nextSeason: $0.nextSeason, nextEpisode: $0.nextEpisode,
                    lastSeason: $0.lastSeason, lastEpisode: $0.lastEpisode
                )
            }
    }

    func suggestedEntities() async throws -> [ShowEntity] {
        // Only shows with somewhere to go: offering a finished show as an answer
        // to "mark watched" is offering an action that cannot succeed.
        loadIndex()
            .filter { $0.nextSeason != nil && $0.nextEpisode != nil }
            .map {
                ShowEntity(
                    id: $0.id, name: $0.name,
                    nextSeason: $0.nextSeason, nextEpisode: $0.nextEpisode,
                    lastSeason: $0.lastSeason, lastEpisode: $0.lastEpisode
                )
            }
    }
}

// MARK: - The queue the app drains

private struct SiriRequest: Codable {
    let kind: String
    let showId: Int
    let season: Int
    let episode: Int
    let at: String
}

private struct SiriQueue: Codable {
    var requests: [SiriRequest]
}

/// Appends rather than replaces: two shortcuts run back to back before the app
/// is opened must both survive.
private func enqueue(_ request: SiriRequest) {
    guard let dir = groupURL() else { return }
    let url = dir.appendingPathComponent("siri-queue.json")
    var queue = SiriQueue(requests: [])
    if let data = try? Data(contentsOf: url),
       let existing = try? JSONDecoder().decode(SiriQueue.self, from: data) {
        queue = existing
    }
    queue.requests.append(request)
    if let data = try? JSONEncoder().encode(queue) {
        try? data.write(to: url, options: .atomic)
    }
}

// MARK: - Mark watched

struct MarkWatchedIntent: AppIntent {
    static var title: LocalizedStringResource = "Mark Watched"
    static var description = IntentDescription(
        "Tick off the next episode of a show you follow, or a specific one."
    )

    /// FALSE ON PURPOSE. The whole point is not opening the app: the request is
    /// queued and applied the next time it runs.
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Show")
    var show: ShowEntity

    /// Optional, and optional for a reason: "season 2 episode 5" is far more
    /// error-prone to recognise than a title, and nine times in ten the person
    /// means the next one, which the app already knows.
    @Parameter(title: "Season")
    var season: Int?

    @Parameter(title: "Episode")
    var episode: Int?

    static var parameterSummary: some ParameterSummary {
        Summary("Mark \(\.$show) watched")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let s = season ?? show.nextSeason
        let e = episode ?? show.nextEpisode

        // NOTHING TO MARK IS NOT AN ERROR. A show that is fully watched, or one
        // whose next episode has not aired, should be said plainly rather than
        // thrown — Siri renders a thrown error as a failure the user cannot act
        // on.
        guard let season = s, let episode = e else {
            return .result(dialog: "There's no next episode of \(show.name) to mark.")
        }

        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        enqueue(
            SiriRequest(
                kind: "watched",
                showId: show.id,
                season: season,
                episode: episode,
                // THE MOMENT THEY SAID IT. The app may not run for days, and the
                // streaks, the calendar and Wrapped all read the watch date.
                at: iso.string(from: Date())
            )
        )

        let code = "S\(season)E\(episode)"
        return .result(dialog: "Marked \(show.name) \(code) as watched.")
    }
}


// MARK: - Reading the widget payload
//
// The same file the widgets draw from, and the reason these intents need no new
// data: "what am I on" and "what should I watch" are questions the home screen
// already answers, so answering them out loud costs one decode.

private struct WidgetUpNext: Codable {
    let showId: Int
    let showName: String
    let season: Int
    let episode: Int
    let title: String?
    let code: String
}

private struct WidgetMovie: Codable {
    let name: String
    let year: String?
}

private struct WidgetPayload: Codable {
    let upNext: [WidgetUpNext]
    let movies: [WidgetMovie]
}

private func loadWidgetPayload() -> WidgetPayload? {
    guard let dir = groupURL(),
          let data = try? Data(contentsOf: dir.appendingPathComponent("widget-data.json"))
    else { return nil }
    return try? JSONDecoder().decode(WidgetPayload.self, from: data)
}

/// "S2E5" reads badly out loud; Siri should say what a person would say.
private func spoken(season: Int, episode: Int) -> String {
    "season \(season), episode \(episode)"
}

// MARK: - What am I on

struct NextEpisodeIntent: AppIntent {
    static var title: LocalizedStringResource = "What's Next"
    static var description = IntentDescription(
        "Ask what to watch next — across everything you follow, or for one show."
    )
    static var openAppWhenRun: Bool = false

    /// OPTIONAL, AND THE OPTIONAL CASE IS THE COMMON ONE. "What's next in
    /// OpenTV" with no show is the question people actually ask; naming a show
    /// is the narrower follow-up.
    @Parameter(title: "Show")
    var show: ShowEntity?

    static var parameterSummary: some ParameterSummary {
        Summary("What's next in \(\.$show)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        if let show {
            guard let season = show.nextSeason, let episode = show.nextEpisode else {
                // Caught up, but say where they stopped: that is the answer to
                // "what episode am I on" for a finished show.
                if let ls = show.lastSeason, let le = show.lastEpisode {
                    return .result(
                        dialog: "You're all caught up on \(show.name) — last was \(spoken(season: ls, episode: le))."
                    )
                }
                return .result(dialog: "You're all caught up on \(show.name).")
            }
            // The episode TITLE only comes with the widget payload, so it is a
            // bonus rather than a requirement: the numbers alone still answer.
            let named = loadWidgetPayload()?.upNext.first { $0.showId == show.id }
            if let t = named?.title, !t.isEmpty {
                return .result(dialog: "\(show.name), \(spoken(season: season, episode: episode)): \(t).")
            }
            return .result(dialog: "\(show.name), \(spoken(season: season, episode: episode)).")
        }

        guard let first = loadWidgetPayload()?.upNext.first else {
            return .result(dialog: "Nothing is waiting — you're caught up.")
        }
        if let t = first.title, !t.isEmpty {
            return .result(
                dialog: "\(first.showName), \(spoken(season: first.season, episode: first.episode)): \(t)."
            )
        }
        return .result(dialog: "\(first.showName), \(spoken(season: first.season, episode: first.episode)).")
    }
}

// MARK: - What should I watch

struct PickMovieIntent: AppIntent {
    static var title: LocalizedStringResource = "Pick a Film"
    static var description = IntentDescription("Choose something from your watchlist.")
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let movies = loadWidgetPayload()?.movies ?? []
        guard let pick = movies.randomElement() else {
            return .result(dialog: "There's nothing on your watchlist yet.")
        }
        // RANDOM RATHER THAN FIRST. Asked twice in a row, "pick a film" that
        // answers the same title twice is a list, not a suggestion.
        if let year = pick.year, !year.isEmpty {
            return .result(dialog: "How about \(pick.name), from \(year)?")
        }
        return .result(dialog: "How about \(pick.name)?")
    }
}


// MARK: - The film, as something Siri can resolve from speech

struct MovieEntity: AppEntity, Identifiable {
    let id: String
    /// The name the library holds, which is what the app shows and what the
    /// answer says.
    let name: String
    /// The name to LIST, which is what Siri matches speech against.
    let spokenName: String
    let year: String?
    let watchedAt: String?

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Film"

    /*
     * THE TITLE SIRI MATCHES IS THE TITLE IT SHOWS, and that is the whole
     * reason this field exists.
     *
     * Asking "did I watch the red turtle" answered about "Red One" — because a
     * spoken parameter inside an App Shortcut phrase is resolved by the system
     * against the DISPLAYED titles of the suggested entities, not through
     * `entities(matching:)`. A library row stored as "La Tortue rouge" can
     * therefore never be reached by its English name, however good the string
     * search behind it is: the system never runs it.
     *
     * So a film with a known other name is listed under the one people are
     * likely to say. `name` is untouched, so the app and this agree about what
     * the film is called.
     */
    var displayRepresentation: DisplayRepresentation {
        if let year, !year.isEmpty {
            return DisplayRepresentation(title: "\(spokenName)", subtitle: "\(year)")
        }
        return DisplayRepresentation(title: "\(spokenName)")
    }

    static var defaultQuery = MovieQuery()
}

/// The name most likely to be said aloud.
///
/// THE ENGLISH TITLE, WHEN THERE IS ONE. The first attempt guessed by picking
/// the longest Latin-script alias, which kept "La Tortue rouge" over "The Red
/// Turtle" — longer, and Latin, and wrong. Which name is English is now
/// recorded when it is fetched, so nothing has to be inferred here.
private func spokenTitle(_ m: SiriMovie) -> String {
    if let en = m.en, !en.isEmpty { return en }
    return m.name
}

struct MovieQuery: EntityStringQuery {
    func entities(matching string: String) async throws -> [MovieEntity] {
        matchMovies(loadMovies(), spoken: string)
            .map { MovieEntity(id: $0.name, name: $0.name, spokenName: spokenTitle($0), year: $0.year, watchedAt: $0.watchedAt) }
    }

    func entities(for identifiers: [String]) async throws -> [MovieEntity] {
        loadMovies()
            .filter { identifiers.contains($0.name) }
            .map { MovieEntity(id: $0.name, name: $0.name, spokenName: spokenTitle($0), year: $0.year, watchedAt: $0.watchedAt) }
    }

    /*
     * SUGGESTIONS ARE A SHORTLIST, NOT THE LIBRARY.
     *
     * `entities(matching:)` above searches everything, so nothing is
     * unreachable. This list is what the system indexes for voice matching and
     * shows in the Shortcuts app, and eight hundred rows there makes both worse
     * — long, unusual titles stop matching at all and fall through to a web
     * search. The index is written watched-first, most recent first, so the top
     * of it is what somebody is most likely to ask about.
     */
    func suggestedEntities() async throws -> [MovieEntity] {
        let all = loadMovies()
        /*
         * BOTH HALVES, AND THAT IS THE WHOLE POINT.
         *
         * A flat cap over a watched-first index cut every UNWATCHED film off
         * the end — so "have I watched Spider-Man: Brand New Day", a film sitting
         * on the watchlist, matched nothing and fell through to a web search,
         * and a spoken title Siri half-heard landed on whichever watched film
         * was closest. The question is "have I seen this", so the films someone
         * has NOT seen are at least as likely to be asked about as the ones
         * they have.
         */
        // EVERY UNWATCHED FILM, NO SLICE. A watchlist is small — a few hundred
        // at most — and it is the half people ask about, so cutting it is how
        // "have I watched Spider-Man: Brand New Day" fell off the end: it was
        // the 92nd unwatched title alphabetically against a cap of 90.
        /*
         * SMALL, ON PURPOSE, AND THIS IS AN EXPERIMENT WITH A REASON.
         *
         * Siri kept asking "which one?" even when the spoken title matched a
         * listed film exactly — the phrase entered the intent but never bound
         * the value. Everything on our side is provably correct: the index
         * holds the right names, the list contains the film, the string search
         * finds it. What is left is the system's own phrase matcher, and the
         * plausible remaining cause is the SIZE of the list it has to match a
         * spoken title against.
         *
         * So: sixty. If binding starts working, size was the cause and the
         * number can be tuned. If it does not, the limit is Apple's and no
         * amount of tuning here will move it. `entities(matching:)` still
         * searches the whole library, so nothing becomes unreachable either way.
         */
        let unseen = all.filter { $0.watchedAt == nil }.prefix(35)
        let seen = all.filter { $0.watchedAt != nil }.prefix(25)
        return (seen + unseen).map {
            MovieEntity(id: $0.name, name: $0.name, spokenName: spokenTitle($0), year: $0.year, watchedAt: $0.watchedAt)
        }
    }
}

// MARK: - Have I seen it

struct DidIWatchIntent: AppIntent {
    static var title: LocalizedStringResource = "Have I Watched It"
    static var description = IntentDescription("Check whether a film is already in your watched list.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Film")
    var movie: MovieEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Have I watched \(\.$movie)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let watched = movie.watchedAt, !watched.isEmpty else {
            // IN THE LIBRARY BUT UNSEEN. The index only holds films the person
            // has, so this is never "no such film" — it is "not yet".
            return .result(dialog: "No, \(movie.spokenName) is still on your list.")
        }

        // THE DATE, SPOKEN THE WAY A DATE IS SPOKEN. The column is either
        // 'YYYY-MM-DD HH:MM:SS' or a full ISO instant depending on how the row
        // arrived; both start with the day, which is the only part worth saying.
        let day = String(watched.prefix(10))
        let parser = DateFormatter()
        parser.calendar = Calendar(identifier: .iso8601)
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: day) else {
            return .result(dialog: "Yes, you've watched \(movie.spokenName).")
        }
        let out = DateFormatter()
        out.dateStyle = .long
        out.timeStyle = .none
        return .result(dialog: "Yes — you watched \(movie.spokenName) on \(out.string(from: date)).")
    }
}

// MARK: - The phrases

/// Apple requires the app name inside every ready-made phrase, so "mark watched
/// in OpenTV" is as short as this can be. Somebody who wants their own wording
/// builds a shortcut in the Shortcuts app and says whatever they like.
struct OpenTVShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: MarkWatchedIntent(),
            phrases: [
                "Mark watched in \(.applicationName)",
                "Mark an episode watched in \(.applicationName)",
                "I finished an episode in \(.applicationName)",
                "In \(.applicationName) I finished \(\.$show)",
                "In \(.applicationName) mark watched \(\.$show)",
                "In \(.applicationName) mark \(\.$show) watched",
                "I finished \(\.$show) in \(.applicationName)",
                "Mark \(\.$show) watched in \(.applicationName)",
                "In \(.applicationName) mark \(\.$show) watched",
                "I finished \(\.$show) in \(.applicationName)",
                "Mark \(\.$show) watched in \(.applicationName)",
            ],
            shortTitle: "Mark Watched",
            systemImageName: "checkmark.circle"
        )
        AppShortcut(
            intent: NextEpisodeIntent(),
            phrases: [
                "What's next in \(.applicationName)",
                "What should I watch in \(.applicationName)",
                "What episode am I on in \(.applicationName)",
                "In \(.applicationName) what episode am I on in \(\.$show)",
                "In \(.applicationName) where am I in \(\.$show)",
                "In \(.applicationName) what is next in \(\.$show)",
                "What episode am I on in \(\.$show) in \(.applicationName)",
                "Where am I in \(\.$show) in \(.applicationName)",
                "In \(.applicationName) what's next in \(\.$show)",
                "What episode am I on in \(\.$show) in \(.applicationName)",
                "Where am I in \(\.$show) in \(.applicationName)",
            ],
            shortTitle: "What's Next",
            systemImageName: "play.circle"
        )
        AppShortcut(
            intent: PickMovieIntent(),
            phrases: [
                "Pick a film in \(.applicationName)",
                "Pick a movie in \(.applicationName)",
            ],
            shortTitle: "Pick a Film",
            systemImageName: "film"
        )
        AppShortcut(
            intent: DidIWatchIntent(),
            phrases: [
                /*
                 * THE TITLE LAST, THE APP NAME FIRST.
                 *
                 * "Did I watch <film> in OpenTV" put the parameter in the middle
                 * and Siri kept failing to bind it — so it fell back to asking
                 * "which one?" and listing everything, every time. A spoken
                 * parameter is recognised far more reliably when nothing follows
                 * it, because the recogniser does not have to work out where the
                 * title stops and the sentence resumes.
                 */
                // BOTH ORDERS, AND SEVERAL VERBS. Which one binds depends on
                // the recogniser rather than on us, so every shape somebody
                // might reasonably say is offered instead of one being picked
                // as canonical.
                "In \(.applicationName) did I watch \(\.$movie)",
                "In \(.applicationName) have I watched \(\.$movie)",
                "In \(.applicationName) have I seen \(\.$movie)",
                "\(.applicationName) did I watch \(\.$movie)",
                "Did I watch \(\.$movie) in \(.applicationName)",
                "Have I watched \(\.$movie) in \(.applicationName)",
                "Have I seen \(\.$movie) in \(.applicationName)",
                "Did I see \(\.$movie) in \(.applicationName)",
                // The two-step form stays, because it always binds: the sentence
                // is fixed, and Siri asks for the film afterwards.
                "Have I watched this in \(.applicationName)",
            ],
            shortTitle: "Have I Watched It",
            systemImageName: "questionmark.circle"
        )
    }
}
