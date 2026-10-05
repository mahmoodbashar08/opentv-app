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
  var deepLink: URL { URL(string: "opentv://episode/\(showId)-s\(season)e\(episode)")! }
}

struct WatchMovie: Codable, Identifiable {
  let name: String
  let year: String?
  let thumb: String?
  var id: String { name }
  var deepLink: URL {
    let n = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
    return URL(string: "opentv://movie/\(n)")!
  }
}

/// One month-label, and the grid column its month begins in.
struct HeatMonth: Codable {
  let index: Int
  let month: String
}

/// The activity grid, decided entirely on the app side.
///
/// `cells` is one character per square, column-major, seven rows to a column:
/// '0'-'4' is the shade, '.' is a day outside the months shown. `shades` is
/// the colour for each level. Nothing here is computed in Swift on purpose —
/// the grid arithmetic and the colour ramp live in the app's `pure.ts` beside
/// their tests, and a second implementation over here would drift from the
/// profile screen within a release.
struct HeatData: Codable {
  let cells: String
  let months: [HeatMonth]
  let total: Int
  /// Index of today's square, or -1. Ringed, as the profile rings it.
  let todayIndex: Int
  let shades: [String]
}

struct Payload: Codable {
  let updatedAt: String
  let upNext: [UpNextEp]
  let movies: [WatchMovie]
  /// Keyed by how many months the grid covers ("1", "3", "6") — one per widget
  /// size, because the extension cannot recompute and the app can.
  /// Optional: a payload written by an older build simply has no grid, and the
  /// widget says so rather than failing to decode the episodes as well.
  let heat: [String: HeatData]?
}

func loadPayload() -> Payload {
  let empty = Payload(updatedAt: "", upNext: [], movies: [], heat: nil)
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

extension Color {
  /// '#RRGGBB' (or '#AARRGGBB') as written by the app. Anything unparseable
  /// falls back to clear, which draws as a gap rather than a wrong colour.
  init(hexString: String) {
    var s = hexString.hasPrefix("#") ? String(hexString.dropFirst()) : hexString
    if s.count == 8 { s = String(s.suffix(6)) }
    guard s.count == 6, let v = UInt64(s, radix: 16) else {
      self = .clear
      return
    }
    self.init(
      .sRGB,
      red: Double((v >> 16) & 0xFF) / 255,
      green: Double((v >> 8) & 0xFF) / 255,
      blue: Double(v & 0xFF) / 255,
      opacity: 1
    )
  }
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
      // NO systemLarge. Its extra height buys nothing here — a calendar is
      // seven rows, and the WIDTH is what decides how many months fit, which a
      // large tile does not increase. It would be the medium widget with 175pt
      // of black under it.
      .supportedFamilies([.systemSmall, .systemMedium])
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

// MARK: - Up Next + Movies (combined medium: episodes left, posters right)

struct CombinedView: View {
  let entry: Entry

  var body: some View {
    let eps = entry.payload.upNext
    let movies = entry.payload.movies
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 7) {
        Header(text: "UP NEXT")
        if eps.isEmpty {
          Text("All caught up 🎉").font(.system(size: 12)).foregroundColor(.white)
        } else {
          ForEach(eps.prefix(2)) { ep in
            Link(destination: ep.deepLink) {
              VStack(alignment: .leading, spacing: 1) {
                Text(ep.showName)
                  .font(.system(size: 12, weight: .semibold))
                  .foregroundColor(.white)
                  .lineLimit(1)
                Text(ep.code).font(.system(size: 11)).foregroundColor(dim)
              }
            }
          }
        }
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      VStack(alignment: .leading, spacing: 7) {
        Header(text: "MOVIES")
        if movies.isEmpty {
          Text("—").font(.system(size: 12)).foregroundColor(dim)
        } else {
          HStack(spacing: 6) {
            ForEach(movies.prefix(2)) { m in
              Link(destination: m.deepLink) {
                if let img = thumbImage(m.thumb) {
                  Image(uiImage: img)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 48, height: 72)
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                } else {
                  RoundedRectangle(cornerRadius: 7)
                    .fill(Color(white: 0.16))
                    .frame(width: 48, height: 72)
                    .overlay(Text(String(m.name.prefix(1))).font(.system(size: 14, weight: .bold)).foregroundColor(dim))
                }
              }
            }
          }
        }
        Spacer(minLength: 0)
      }
    }
    .padding(12)
    .widgetBackground(bg)
  }
}

struct CombinedWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "UpNextMovies", provider: Provider()) { CombinedView(entry: $0) }
      .configurationDisplayName("Up Next + Movies")
      .description("Your next episodes and your movie watchlist, side by side.")
      .supportedFamilies([.systemMedium])
  }
}


// MARK: - Heatmap

private let monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

private func shortMonth(_ month: String) -> String {
  guard month.count >= 7, let m = Int(month.dropFirst(5).prefix(2)), m >= 1, m <= 12 else { return month }
  return monthNames[m - 1]
}

/// The profile's activity grid, on the home screen.
///
/// SEVEN ROWS IS THE CONSTRAINT, AND IT IS THE HEIGHT. The first version sized
/// each square by how many columns had to fit across the width, then parked
/// the result in a guessed fixed height — so on a real tile the squares came
/// out taller than the space they had, the grid ran off the bottom edge and
/// the caption was drawn over the top of it. A calendar is always seven rows,
/// so the square is whatever height allows seven of them, and the WIDTH then
/// decides how many weeks are worth showing.
///
/// SO THE PERIOD IS MEASURED, NOT ASSUMED. Whichever of the three grids the
/// app sent fits the columns available is the one drawn — six months on a tile
/// with room, one month on a tile without. Nothing is ever clipped.
struct HeatmapView: View {
  var entry: Entry

  var body: some View {
    GeometryReader { geo in
      let fit = layout(geo.size)
      VStack(alignment: .leading, spacing: 5) {
        // ONE header line, not a header and a footer. Two rows of small text
        // around a grid left the grid the smallest thing on its own widget.
        HStack(alignment: .firstTextBaseline) {
          Header(text: "WATCHING")
          Spacer(minLength: 4)
          if let data = fit?.data {
            Text("\(data.total)")
              .font(.system(size: 13, weight: .heavy))
              .foregroundColor(.white)
            + Text(" watched")
              .font(.system(size: 11))
              .foregroundColor(dim)
          }
        }
        if let fit {
          Cells(data: fit.data, cell: fit.cell, gap: gap, labelH: labelH)
        } else {
          // An older payload, or a library with nothing dated in it.
          Text("Open OpenTV to fill this in")
            .font(.system(size: 12))
            .foregroundColor(dim)
        }
        Spacer(minLength: 0)
      }
      .padding(12)
    }
    .widgetBackground(bg)
  }

  private let gap: CGFloat = 2.5
  private let labelH: CGFloat = 12
  /// Below this a week-column stops being readable and becomes noise.
  private let minCell: CGFloat = 11

  /// WHICH GRID, AND HOW BIG ITS SQUARES — measured from the tile, never
  /// assumed from the family.
  ///
  /// WIDTH CHOOSES THE PERIOD; HEIGHT ONLY SIZES IT. Dropping from six months
  /// to three buys width — fewer columns, wider squares — and buys no height
  /// at all, because a calendar is seven rows however long it is. So the floor
  /// is tested against the WIDTH alone, and the height is then a cap on the
  /// square. Testing the floor against both (the previous attempt) meant a
  /// short tile rejected every grid and fell through to the fallback, showing
  /// one month where three would have fitted perfectly well.
  private func layout(_ size: CGSize) -> (data: HeatData, cell: CGFloat)? {
    guard let heat = entry.payload.heat else { return nil }
    let inner = CGSize(width: size.width - 24, height: size.height - 24)
    let byHeight = (inner.height - 15 - labelH - 5 - gap * 6) / 7
    var fallback: (HeatData, CGFloat)?
    for key in ["6", "3", "1"] {
      guard let d = heat[key], !d.cells.isEmpty else { continue }
      let byWidth = (inner.width + gap) / CGFloat(d.cells.count / 7) - gap
      let cell = max(4, min(byWidth, byHeight))
      if byWidth >= minCell { return (d, cell) }
      fallback = (d, cell) // narrowest seen — one month tight beats nothing
    }
    return fallback
  }

  private struct Cells: View {
    let data: HeatData
    let cell: CGFloat
    let gap: CGFloat
    let labelH: CGFloat

    var body: some View {
      let chars = Array(data.cells)
      let columns = max(chars.count / 7, 1)
      let labels = Dictionary(data.months.map { ($0.index, shortMonth($0.month)) }, uniquingKeysWith: { a, _ in a })
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: gap) {
          ForEach(0..<columns, id: \.self) { c in
            Text(labels[c] ?? "")
              .font(.system(size: 9, weight: .medium))
              .foregroundColor(dim)
              .fixedSize()
              // Fixed to the column so a name sits over the week its month
              // starts in; a wider name simply overhangs the ones after it,
              // which is what the profile does too.
              .frame(width: cell, alignment: .leading)
          }
        }
        .frame(height: labelH, alignment: .bottom)
        HStack(spacing: gap) {
          ForEach(0..<columns, id: \.self) { c in
            VStack(spacing: gap) {
              ForEach(0..<7, id: \.self) { r in
                let i = c * 7 + r
                let ch = chars[i]
                RoundedRectangle(cornerRadius: max(1.5, cell / 3.5))
                  // '.' is a day outside the months shown: a gap, so the grid
                  // begins on a 1st and ends on a 31st.
                  .fill(ch == "." ? Color.clear : Color(hexString: shade(ch)))
                  .frame(width: cell, height: cell)
                  .overlay(
                    // Today, ringed — the same marker the profile draws, and
                    // the thing that tells you the grid is live.
                    RoundedRectangle(cornerRadius: max(1.5, cell / 3.5))
                      .strokeBorder(i == data.todayIndex ? Color.white : Color.clear, lineWidth: 1.2)
                  )
              }
            }
          }
          Spacer(minLength: 0)
        }
      }
    }

    private func shade(_ ch: Character) -> String {
      guard let i = ch.wholeNumberValue, i >= 0, i < data.shades.count else { return data.shades.first ?? "#1C1C1E" }
      return data.shades[i]
    }
  }
}

struct HeatmapWidget: Widget {
  var body: some WidgetConfiguration {
    // A TAP HAD NOWHERE TO GO, and on Android it always did. Every other
    // widget here links somewhere — an episode, a film — and this one opened
    // the app at whatever screen it happened to be on, which reads as a dead
    // control rather than a deliberate one. `HeatmapWidget.tsx` has carried
    // `opentv://stats` since it was written; only the iOS half was missed.
    // A grid of a year's watching belongs to Stats, which is the screen that
    // explains it.
    StaticConfiguration(kind: "Heatmap", provider: Provider()) {
      HeatmapView(entry: $0).widgetURL(URL(string: "opentv://stats"))
    }
      .configurationDisplayName("Watching")
      .description("Your activity grid — one square for every day you watched something.")
      .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

// MARK: - Bundle

@main
struct OpenTVWidgetBundle: WidgetBundle {
  var body: some Widget {
    UpNextWidget()
    MoviesWidget()
    CombinedWidget()
    HeatmapWidget()
  }
}
