// The iPhone home-screen widget: small shows the Needs you count, medium adds the top 3 waiting on you, large adds
// today's My week list. Each row opens that thing in the app (floorboard://go?to=post:…), the rest opens Needs you.
import SwiftUI
import WidgetKit

// MARK: - The snapshot, as src/snapshot.js writes it

struct Needs: Codable { let total: Int; let red: Int; let amber: Int; let green: Int; let overdue: Int }
struct TopItem: Codable, Identifiable { let id: String; let no: Int?; let title: String; let level: String; let overdue: Bool; let from: String?; let link: String }
struct WeekItem: Codable, Identifiable {
  let key: String; let kind: String; let title: String; let level: String?; let done: Bool; let late: Bool; let sub: String?; let link: String
  var id: String { key }
}
struct Week: Codable { let done: Int; let total: Int; let items: [WeekItem]; let link: String }
struct Snap: Codable {
  var state: String
  var at: Double? = nil
  var dayLabel: String? = nil
  var link: String? = nil
  var needs: Needs? = nil
  var top: [TopItem]? = nil
  var week: Week? = nil
  var stale: Bool? = nil

  static func message(_ state: String) -> Snap { Snap(state: state) }
  static let sample = Snap(
    state: "ok", dayLabel: "Today",
    needs: Needs(total: 4, red: 1, amber: 2, green: 1, overdue: 1),
    top: [TopItem(id: "a", no: 1047, title: "Check the cold room temperatures", level: "red", overdue: true, from: "Sam", link: "floorboard://"),
          TopItem(id: "b", no: 1046, title: "Sign off the expense claims", level: "amber", overdue: false, from: "Lee", link: "floorboard://"),
          TopItem(id: "c", no: 1045, title: "Feedback on the new rota", level: "green", overdue: false, from: "Alex", link: "floorboard://")],
    week: Week(done: 2, total: 5, items: [
      WeekItem(key: "1", kind: "everyday", title: "Read and file email", level: nil, done: false, late: false, sub: "Every day", link: "floorboard://"),
      WeekItem(key: "2", kind: "task", title: "Supplier payments run", level: nil, done: false, late: false, sub: "", link: "floorboard://"),
      WeekItem(key: "3", kind: "monthend", title: "Bank recons", level: nil, done: false, late: false, sub: "Month end", link: "floorboard://"),
      WeekItem(key: "4", kind: "everyday", title: "Petty cash count", level: nil, done: true, late: false, sub: "Every day", link: "floorboard://"),
      WeekItem(key: "5", kind: "task", title: "Debtors list", level: nil, done: true, late: false, sub: "", link: "floorboard://")], link: "floorboard://"))
}

// MARK: - Timeline

struct Entry: TimelineEntry { let date: Date; let snap: Snap }

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> Entry { Entry(date: Date(), snap: .sample) }

  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
    if context.isPreview { completion(Entry(date: Date(), snap: Loader.cached() ?? .sample)); return }
    Task { completion(Entry(date: Date(), snap: await Loader.load())) }
  }

  // fetch now, then again in 15 minutes (iOS may stretch that), and just after midnight for the new day's list
  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    Task {
      let snap = await Loader.load()
      let now = Date()
      var next = now.addingTimeInterval(15 * 60)
      if let midnight = Calendar.current.nextDate(after: now, matching: DateComponents(hour: 0, minute: 1), matchingPolicy: .nextTime), midnight < next { next = midnight }
      completion(Timeline(entries: [Entry(date: now, snap: snap)], policy: .after(next)))
    }
  }
}

// MARK: - Look

extension Color {
  init(hex: UInt32) { self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255) }
}
enum Palette {
  static let top = Color(hex: 0x3E2D20)
  static let bottom = Color(hex: 0x1F1710)
  static let text = Color(hex: 0xFFF4E8)
  static let muted = Color(hex: 0xCDBBA7)
  static let faint = Color(hex: 0x8F7D6B)
  static let line = Color(hex: 0x4A3A2D)
  static let red = Color(hex: 0xFF6B5E)
  static let amber = Color(hex: 0xF4B33E)
  static let green = Color(hex: 0x6CC46F)
}
func levelColor(_ level: String?) -> Color {
  switch level { case "red": return Palette.red; case "amber": return Palette.amber; default: return Palette.green }
}

struct LevelCount: Identifiable { let id: String; let label: String; let n: Int }

// a row that opens its own link where the widget size allows it
struct Linked<Content: View>: View {
  let link: String
  @ViewBuilder let content: () -> Content
  var body: some View {
    if let url = URL(string: link) { Link(destination: url) { content() } } else { content() }
  }
}

// MARK: - Pieces

struct NeedsBlock: View {
  let snap: Snap
  let needs: Needs
  let compact: Bool
  var levels: [LevelCount] { [LevelCount(id: "red", label: "ASAP", n: needs.red), LevelCount(id: "amber", label: "Important", n: needs.amber), LevelCount(id: "green", label: "General", n: needs.green)] }

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(snap.stale == true ? "NEEDS YOU · OFFLINE" : "NEEDS YOU").font(.system(size: 10, weight: .bold)).kerning(0.6).foregroundStyle(Palette.muted)
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text("\(needs.total)").font(.system(size: compact ? 38 : 32, weight: .bold, design: .rounded)).foregroundStyle(Palette.text)
        if needs.overdue > 0 { Text("\(needs.overdue) overdue").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.red) }
      }
      if compact {
        VStack(alignment: .leading, spacing: 2) { ForEach(levels) { LevelLabel(level: $0) } }
      } else {
        HStack(spacing: 12) { ForEach(levels) { LevelLabel(level: $0) } }
      }
    }
  }
}

struct LevelLabel: View {
  let level: LevelCount
  var body: some View {
    HStack(spacing: 5) {
      Circle().fill(levelColor(level.id)).frame(width: 7, height: 7)
      Text("\(level.n) \(level.label)").font(.system(size: 11)).foregroundStyle(Palette.muted).lineLimit(1)
    }
  }
}

struct TopRow: View {
  let item: TopItem
  var meta: String { [item.no.map { "#\($0)" }, item.from.flatMap { $0.isEmpty ? nil : "from \($0)" }, item.overdue ? "overdue" : nil].compactMap { $0 }.joined(separator: " · ") }
  var body: some View {
    Linked(link: item.link) {
      HStack(spacing: 8) {
        Circle().fill(levelColor(item.level)).frame(width: 8, height: 8)
        VStack(alignment: .leading, spacing: 1) {
          Text(item.title).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.text).lineLimit(1)
          if !meta.isEmpty { Text(meta).font(.system(size: 11)).foregroundStyle(item.overdue ? Palette.red : Palette.faint).lineLimit(1) }
        }
        Spacer(minLength: 0)
      }
    }
  }
}

struct WeekRow: View {
  let item: WeekItem
  var body: some View {
    Linked(link: item.link) {
      HStack(spacing: 8) {
        ZStack {
          Circle().fill(item.done ? Palette.green : Color.clear)
          Circle().strokeBorder(item.done ? Palette.green : Palette.faint, lineWidth: 1.5)
          if item.done { Image(systemName: "checkmark").font(.system(size: 8, weight: .heavy)).foregroundStyle(Palette.bottom) }
        }.frame(width: 15, height: 15)
        VStack(alignment: .leading, spacing: 0) {
          Text(item.title).font(.system(size: 13)).foregroundStyle(item.done ? Palette.faint : Palette.text).strikethrough(item.done, color: Palette.faint).lineLimit(1)
          if !item.done, let sub = item.sub, !sub.isEmpty { Text(sub).font(.system(size: 10)).foregroundStyle(item.late ? Palette.red : Palette.faint).lineLimit(1) }
        }
        Spacer(minLength: 0)
        if !item.done, let level = item.level { Circle().fill(levelColor(level)).frame(width: 6, height: 6) }
      }
    }
  }
}

// MARK: - Sizes

struct SmallView: View {
  let snap: Snap
  let needs: Needs
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      NeedsBlock(snap: snap, needs: needs, compact: true)
      Spacer(minLength: 0)
      if let w = snap.week { Text("Today \(w.done)/\(w.total) done").font(.system(size: 11, weight: .medium)).foregroundStyle(Palette.muted) }
    }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct MediumView: View {
  let snap: Snap
  let needs: Needs
  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      NeedsBlock(snap: snap, needs: needs, compact: true).frame(width: 104, alignment: .leading)
      VStack(alignment: .leading, spacing: 7) {
        let top = Array((snap.top ?? []).prefix(3))
        if top.isEmpty { Text("Nothing is waiting on you. Have a good shift.").font(.system(size: 13)).foregroundStyle(Palette.muted) }
        ForEach(top) { TopRow(item: $0) }
      }.frame(maxHeight: .infinity)
    }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct LargeView: View {
  let snap: Snap
  let needs: Needs
  var body: some View {
    let top = Array((snap.top ?? []).prefix(3))
    VStack(alignment: .leading, spacing: 8) {
      NeedsBlock(snap: snap, needs: needs, compact: false)
      VStack(alignment: .leading, spacing: 6) {
        if top.isEmpty { Text("Nothing is waiting on you.").font(.system(size: 13)).foregroundStyle(Palette.muted) }
        ForEach(top) { TopRow(item: $0) }
      }
      if let w = snap.week {
        Rectangle().fill(Palette.line).frame(height: 1)
        Linked(link: w.link) {
          HStack {
            Text("TODAY · " + (snap.dayLabel ?? "").uppercased()).font(.system(size: 10, weight: .bold)).kerning(0.6).foregroundStyle(Palette.muted)
            Spacer()
            Text("\(w.done)/\(w.total)").font(.system(size: 11, weight: .bold)).foregroundStyle(Palette.muted)
          }
        }
        let rows = top.isEmpty ? 7 : 8 - top.count
        if w.items.isEmpty { Text("Nothing planned for today yet.").font(.system(size: 12)).foregroundStyle(Palette.muted) }
        ForEach(Array(w.items.prefix(rows))) { WeekRow(item: $0) }
        if w.items.count > rows { Text("+\(w.items.count - rows) more").font(.system(size: 11)).foregroundStyle(Palette.faint) }
      }
      Spacer(minLength: 0)
    }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct MessageView: View {
  let snap: Snap
  var text: (String, String) {
    switch snap.state {
    case "signedout": return ("Open Floorboard to sign in", "Then this shows what needs you, and your day.")
    case "gone": return ("Your login was removed", "Ask your manager, then open Floorboard to sign in again.")
    default: return ("Can’t reach the store’s server", "It tries again by itself. Tap to open Floorboard.")
    }
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text("Floorboard").font(.system(size: 11, weight: .bold)).foregroundStyle(Palette.muted)
      Spacer(minLength: 0)
      Text(text.0).font(.system(size: 15, weight: .bold)).foregroundStyle(Palette.text)
      Text(text.1).font(.system(size: 12)).foregroundStyle(Palette.muted)
    }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct FloorboardWidgetView: View {
  @Environment(\.widgetFamily) var family
  let entry: Entry

  var body: some View {
    content
      .widgetURL(URL(string: entry.snap.link ?? "floorboard://"))
      .containerBackground(for: .widget) { LinearGradient(colors: [Palette.top, Palette.bottom], startPoint: .topLeading, endPoint: .bottomTrailing) }
  }

  @ViewBuilder var content: some View {
    if entry.snap.state == "ok", let needs = entry.snap.needs {
      switch family {
      case .systemSmall: SmallView(snap: entry.snap, needs: needs)
      case .systemMedium: MediumView(snap: entry.snap, needs: needs)
      default: LargeView(snap: entry.snap, needs: needs)
      }
    } else {
      MessageView(snap: entry.snap)
    }
  }
}

struct FloorboardWidget: Widget {
  let kind = "FloorboardWidget"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in FloorboardWidgetView(entry: entry) }
      .configurationDisplayName("Floorboard")
      .description("What needs you, and today’s list from My week.")
      .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

@main
struct FloorboardWidgets: WidgetBundle {
  var body: some Widget { FloorboardWidget() }
}
