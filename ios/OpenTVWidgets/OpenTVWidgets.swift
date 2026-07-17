//
//  OpenTVWidgets.swift
//  Home-screen widgets: "Up Next" (next unwatched aired episode per show) and
//  "Movies to Watch" (the watchlist). The app writes widget-data.json + poster
//  thumbnails into the shared App Group container every time it goes to the
//  background; these widgets just render that file. No network, no server —
//  the same on-device promise as the app itself.
//

import SwiftUI
import WidgetKit

private let appGroup = "group.com.insightfy.opentv"
private let bg = Color(red: 0.07, green: 0.07, blue: 0.08)
private let yellow = Color(red: 0.96, green: 0.77, blue: 0.09)
private let dim = Color(white: 0.62)

// MARK: - Shared data

struct UpNextEp: Codable, Identifiable {
  let showId: Int
  let showName: String
  let season: Int
  let episode: Int
  let title: String?
  let code: String
  let thumb: String?
  var id: Int { showId }
  var deepLink: URL { URL(string: "ourtvtime://episode/\(showId)-s\(season)e\(episode)")! }
}

struct WatchMovie: Codable, Identifiable {
  let name: String
  let year: String?
  let thumb: String?
  var id: String { name }
  var deepLink: URL {
    let n = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
    return URL(string: "ourtvtime://movie/\(n)")!
  }
}

struct Payload: Codable {
  let updatedAt: String
  let upNext: [UpNextEp]
  let movies: [WatchMovie]
}

func loadPayload() -> Payload {
  let empty = Payload(updatedAt: "", upNext: [], movies: [])
  guard
    let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup),
    let data = try? Data(contentsOf: dir.appendingPathComponent("widget-data.json")),
    let p = try? JSONDecoder().decode(Payload.self, from: data)
  else { return empty }
  return p
}

func thumbImage(_ name: String?) -> UIImage? {
  guard
    let name,
    let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
  else { return nil }
  return UIImage(contentsOfFile: dir.appendingPathComponent("widget-thumbs/\(name)").path)
}

// MARK: - Timeline (data is pushed by the app; nothing to schedule)

struct Entry: TimelineEntry {
  let date: Date
  let payload: Payload
}

struct Provider: TimelineProvider {
  func placeholder(in _: Context) -> Entry { Entry(date: .now, payload: loadPayload()) }
  func getSnapshot(in _: Context, completion: @escaping (Entry) -> Void) {
    completion(Entry(date: .now, payload: loadPayload()))
  }
  func getTimeline(in _: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    completion(Timeline(entries: [Entry(date: .now, payload: loadPayload())], policy: .never))
  }
}

// MARK: - Shared bits

extension View {
  @ViewBuilder func widgetBackground(_ color: Color) -> some View {
    if #available(iOS 17.0, *) {
      containerBackground(for: .widget) { color }
    } else {
      background(color)
    }
  }
}

struct Header: View {
  let text: String
  var body: some View {
    Text(text)
      .font(.system(size: 11, weight: .heavy))
      .kerning(1.2)
      .foregroundColor(yellow)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

// MARK: - Up Next

struct EpRow: View {
  let ep: UpNextEp
  var body: some View {
    Link(destination: ep.deepLink) {
      HStack(spacing: 9) {
        if let img = thumbImage(ep.thumb) {
          Image(uiImage: img)
            .resizable()
            .aspectRatio(contentMode: .fill)
            .frame(width: 48, height: 32)
            .clipShape(RoundedRectangle(cornerRadius: 6))
        } else {
          RoundedRectangle(cornerRadius: 6).fill(Color(white: 0.16)).frame(width: 48, height: 32)
        }
        VStack(alignment: .leading, spacing: 2) {
          Text("\(ep.code)  ·  \(ep.showName)")
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(.white)
            .lineLimit(1)
          Text(ep.title ?? "Episode \(ep.episode)")
            .font(.system(size: 11))
            .foregroundColor(dim)
            .lineLimit(1)
        }
        Spacer(minLength: 0)
      }
    }
  }
}

struct UpNextView: View {
  @Environment(\.widgetFamily) var family
  let entry: Entry

  var rows: Int { family == .systemLarge ? 4 : 2 }

  var body: some View {
    let eps = entry.payload.upNext
    let movies = entry.payload.movies
    VStack(alignment: .leading, spacing: 7) {
      Header(text: "UP NEXT")
      if eps.isEmpty {
        Spacer()
        Text("All caught up 🎉").font(.system(size: 13)).foregroundColor(.white)
        Spacer()
      } else if family == .systemSmall {
        // one episode, poster-style
        let ep = eps[0]
        Spacer(minLength: 2)
        if let img = thumbImage(ep.thumb) {
          Image(uiImage: img)
            .resizable()
            .aspectRatio(contentMode: .fill)
            .frame(maxWidth: .infinity, minHeight: 52, maxHeight: 58)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .clipped()
        }
        Text(ep.showName).font(.system(size: 12, weight: .semibold)).foregroundColor(.white).lineLimit(1)
        Text(ep.code).font(.system(size: 11)).foregroundColor(dim)
        Spacer(minLength: 0)
      } else {
        ForEach(eps.prefix(rows)) { EpRow(ep: $0) }
        // the large widget has room for the movie watchlist underneath
        if family == .systemLarge && !movies.isEmpty {
          Spacer(minLength: 2)
          Header(text: "MOVIES TO WATCH")
          HStack(spacing: 8) {
            ForEach(movies.prefix(5)) { m in
              Link(destination: m.deepLink) {
                if let img = thumbImage(m.thumb) {
                  Image(uiImage: img)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 46, height: 69)
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                } else {
                  RoundedRectangle(cornerRadius: 7)
                    .fill(Color(white: 0.16))
                    .frame(width: 46, height: 69)
                    .overlay(Text(String(m.name.prefix(1))).font(.system(size: 14, weight: .bold)).foregroundColor(dim))
                }
              }
            }
            Spacer(minLength: 0)
          }
        }
        Spacer(minLength: 0)
      }
    }
    .padding(12)
    .widgetBackground(bg)
    .widgetURL(family == .systemSmall && !eps.isEmpty ? eps[0].deepLink : nil)
  }
}

struct UpNextWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "UpNext", provider: Provider()) { UpNextView(entry: $0) }
      .configurationDisplayName("Up Next")
      .description("Your next unwatched episodes — the large size adds your movie watchlist.")
      .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

// MARK: - Movies to Watch

struct MoviesView: View {
  @Environment(\.widgetFamily) var family
  let entry: Entry

  var body: some View {
    let movies = entry.payload.movies
    VStack(alignment: .leading, spacing: 8) {
      Header(text: "MOVIES TO WATCH")
      if movies.isEmpty {
        Spacer()
        Text("Watchlist is empty").font(.system(size: 13)).foregroundColor(.white)
        Spacer()
      } else {
        HStack(spacing: 8) {
          ForEach(movies.prefix(family == .systemSmall ? 2 : 5)) { m in
            Link(destination: m.deepLink) {
              if let img = thumbImage(m.thumb) {
                Image(uiImage: img)
                  .resizable()
                  .aspectRatio(contentMode: .fill)
                  .frame(width: 52, height: 78)
                  .clipShape(RoundedRectangle(cornerRadius: 8))
              } else {
                RoundedRectangle(cornerRadius: 8)
                  .fill(Color(white: 0.16))
                  .frame(width: 52, height: 78)
                  .overlay(Text(String(m.name.prefix(1))).font(.system(size: 16, weight: .bold)).foregroundColor(dim))
              }
            }
          }
          Spacer(minLength: 0)
        }
        Spacer(minLength: 0)
      }
    }
    .padding(12)
    .widgetBackground(bg)
  }
}

struct MoviesWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "Movies", provider: Provider()) { MoviesView(entry: $0) }
      .configurationDisplayName("Movies to Watch")
      .description("Your movie watchlist, on the home screen.")
      .supportedFamilies([.systemMedium])
  }
}

// MARK: - Bundle

@main
struct OpenTVWidgetBundle: WidgetBundle {
  var body: some Widget {
    UpNextWidget()
    MoviesWidget()
  }
}
