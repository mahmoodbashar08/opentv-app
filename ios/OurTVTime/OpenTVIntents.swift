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
}

private struct SiriIndex: Codable {
    let updatedAt: String
    let shows: [SiriShow]
}

private func loadIndex() -> [SiriShow] {
    guard let dir = groupURL(),
          let data = try? Data(contentsOf: dir.appendingPathComponent("siri-index.json")),
          let index = try? JSONDecoder().decode(SiriIndex.self, from: data)
    else { return [] }
    return index.shows
}

// MARK: - The show, as something Siri can resolve from speech

struct ShowEntity: AppEntity, Identifiable {
    let id: Int
    let name: String
    let nextSeason: Int?
    let nextEpisode: Int?

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Show"

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }

    static var defaultQuery = ShowQuery()
}

/// Resolves a spoken title against the followed shows in the index.
///
/// `suggestedEntities` is what Siri and the Shortcuts app list; `entities(for:)`
/// is the lookup after a choice. Both read the same file, so a show followed
/// after the last sync is simply not offered yet rather than resolving wrongly.
struct ShowQuery: EntityQuery {
    func entities(for identifiers: [Int]) async throws -> [ShowEntity] {
        loadIndex()
            .filter { identifiers.contains($0.id) }
            .map { ShowEntity(id: $0.id, name: $0.name, nextSeason: $0.nextSeason, nextEpisode: $0.nextEpisode) }
    }

    func suggestedEntities() async throws -> [ShowEntity] {
        // Only shows with somewhere to go: offering a finished show as an answer
        // to "mark watched" is offering an action that cannot succeed.
        loadIndex()
            .filter { $0.nextSeason != nil && $0.nextEpisode != nil }
            .map { ShowEntity(id: $0.id, name: $0.name, nextSeason: $0.nextSeason, nextEpisode: $0.nextEpisode) }
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
            ],
            shortTitle: "Mark Watched",
            systemImageName: "checkmark.circle"
        )
    }
}
