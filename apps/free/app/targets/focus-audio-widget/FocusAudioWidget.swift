import AppIntents
import SwiftUI
import WidgetKit

private let widgetKind = "FocusAudioWidget"
private let widgetSoundDeepLink = URL(string: "free:///settings/focus-audio")!

private struct FocusAudioWidgetState: Codable {
  struct Preset: Codable, Hashable {
    let id: String
    let label: String
    let uri: String
  }

  let enabled: Bool
  let sound: String
  let soundLabel: String
  let soundUri: String
  let volume: Double
  let lastAudibleVolume: Double
  let isMuted: Bool
  let mixWithOthers: Bool
  let presets: [Preset]
  let updatedAt: Double
}

private struct FocusAudioWidgetEntry: TimelineEntry {
  let date: Date
  let state: FocusAudioWidgetState

  static let placeholder = FocusAudioWidgetEntry(
    date: .now,
    state: FocusAudioWidgetState(
      enabled: false,
      sound: "light-rain",
      soundLabel: "Light Rain",
      soundUri: "https://white-noises.com/sounds/rain/light-rain.mp3",
      volume: 0.35,
      lastAudibleVolume: 0.35,
      isMuted: false,
      mixWithOthers: true,
      presets: [
        .init(id: "light-rain", label: "Light Rain", uri: "https://white-noises.com/sounds/rain/light-rain.mp3"),
        .init(id: "waves", label: "Waves", uri: "https://white-noises.com/sounds/nature/waves.mp3"),
        .init(id: "cafe", label: "Cafe", uri: "https://white-noises.com/sounds/places/cafe.mp3"),
      ],
      updatedAt: Date().timeIntervalSince1970
    )
  )
}

private enum FocusAudioWidgetStore {
  static let stateKey = "focus-audio-widget-state"

  static func appGroup() -> String? {
    guard let bundleIdentifier = Bundle.main.bundleIdentifier else {
      return nil
    }

    let suffix = ".focusaudio"
    let appBundleIdentifier = bundleIdentifier.hasSuffix(suffix)
      ? String(bundleIdentifier.dropLast(suffix.count))
      : bundleIdentifier
    return "group.\(appBundleIdentifier)"
  }

  static func read() -> FocusAudioWidgetState {
    guard
      let appGroup = appGroup(),
      let defaults = UserDefaults(suiteName: appGroup)
    else {
      return FocusAudioWidgetEntry.placeholder.state
    }

    if
      let raw = defaults.string(forKey: stateKey),
      let data = raw.data(using: .utf8),
      let state = try? JSONDecoder().decode(FocusAudioWidgetState.self, from: data)
    {
      return state
    }

    if
      let data = defaults.data(forKey: stateKey),
      let state = try? JSONDecoder().decode(FocusAudioWidgetState.self, from: data)
    {
      return state
    }

    return FocusAudioWidgetEntry.placeholder.state
  }

  static func write(_ state: FocusAudioWidgetState) {
    guard
      let appGroup = appGroup(),
      let defaults = UserDefaults(suiteName: appGroup),
      let data = try? JSONEncoder().encode(state),
      let raw = String(data: data, encoding: .utf8)
    else {
      return
    }

    defaults.set(raw, forKey: stateKey)
    WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
  }
}

private struct FocusAudioWidgetProvider: TimelineProvider {
  func placeholder(in context: Context) -> FocusAudioWidgetEntry {
    .placeholder
  }

  func getSnapshot(in context: Context, completion: @escaping (FocusAudioWidgetEntry) -> Void) {
    completion(FocusAudioWidgetEntry(date: .now, state: FocusAudioWidgetStore.read()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<FocusAudioWidgetEntry>) -> Void) {
    let entry = FocusAudioWidgetEntry(date: .now, state: FocusAudioWidgetStore.read())
    completion(Timeline(entries: [entry], policy: .never))
  }
}

private struct FocusAudioWidgetView: View {
  let entry: FocusAudioWidgetEntry

  private var state: FocusAudioWidgetState { entry.state }
  private let actionQueryKey = "focusAudioWidgetAction"
  private let soundQueryKey = "focusAudioWidgetSound"
  private let accentColor = Color(red: 0.15, green: 0.76, blue: 0.63)
  private let surfaceColor = Color.white.opacity(0.07)
  private let borderColor = Color.white.opacity(0.09)

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      header
      toggleRow
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
    .containerBackground(for: .widget) {
      ZStack {
        LinearGradient(
          colors: [
            Color(red: 0.11, green: 0.12, blue: 0.15),
            Color(red: 0.08, green: 0.09, blue: 0.12),
          ],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )

        RoundedRectangle(cornerRadius: 28, style: .continuous)
          .fill(.white.opacity(0.01))

        RoundedRectangle(cornerRadius: 28, style: .continuous)
          .strokeBorder(Color.white.opacity(0.05), lineWidth: 1)
          .padding(1)
      }
    }
  }

  private var header: some View {
    HStack(alignment: .center, spacing: 10) {
      VStack(alignment: .leading, spacing: 2) {
        Text("Focus Audio")
          .font(.system(size: 11, weight: .bold, design: .rounded))
          .foregroundStyle(Color.white.opacity(0.68))

        Text(state.soundLabel)
          .font(.system(size: 20, weight: .bold, design: .rounded))
          .foregroundStyle(.white)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      }

      Spacer(minLength: 8)

      VStack(alignment: .trailing, spacing: 6) {
        Text(statusLabel)
          .font(.system(size: 10, weight: .bold, design: .rounded))
          .foregroundStyle(state.enabled ? accentColor : Color.white.opacity(0.62))
          .padding(.horizontal, 8)
          .padding(.vertical, 4)
          .background(
            Capsule()
              .fill(state.enabled ? accentColor.opacity(0.14) : Color.white.opacity(0.07))
          )
      }
    }
  }

  private var toggleRow: some View {
    Link(destination: actionURL(action: "toggle")) {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 3) {
          Text(state.enabled ? "Playing" : "Stopped")
            .font(.system(size: 16, weight: .bold, design: .rounded))
            .foregroundStyle(.white)

          Text(state.enabled ? "Tap to pause" : "Tap to resume")
            .font(.system(size: 11, weight: .medium, design: .rounded))
            .foregroundStyle(Color.white.opacity(0.58))
        }

        Spacer(minLength: 12)

        ZStack(alignment: state.enabled ? .trailing : .leading) {
          Capsule()
            .fill(state.enabled ? accentColor : Color.white.opacity(0.14))
            .frame(width: 52, height: 32)

          Circle()
            .fill(.white)
            .frame(width: 24, height: 24)
            .padding(4)
        }
      }
      .padding(.horizontal, 14)
      .frame(height: 62)
      .background(
        RoundedRectangle(cornerRadius: 20, style: .continuous)
          .fill(surfaceColor)
      )
      .overlay(
        RoundedRectangle(cornerRadius: 20, style: .continuous)
          .stroke(borderColor, lineWidth: 1)
      )
    }
  }

  private var statusLabel: String {
    if !state.enabled {
      return "Idle"
    }
    return state.isMuted ? "Muted" : "Live"
  }

  private func actionURL(action: String, soundID: String? = nil) -> URL {
    var components = URLComponents()
    components.scheme = "free"
    components.path = "/"
    components.queryItems = [
      URLQueryItem(name: actionQueryKey, value: action),
    ]

    if let soundID {
      components.queryItems?.append(URLQueryItem(name: soundQueryKey, value: soundID))
    }

    return components.url ?? widgetSoundDeepLink
  }
}

struct ToggleFocusAudioIntent: AppIntent {
  static var title: LocalizedStringResource = "Toggle Focus Audio"
  static var openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult {
    var state = FocusAudioWidgetStore.read()
    state = FocusAudioWidgetState(
      enabled: !state.enabled,
      sound: state.sound,
      soundLabel: state.soundLabel,
      soundUri: state.soundUri,
      volume: !state.enabled ? max(state.lastAudibleVolume, 0.05) : state.volume,
      lastAudibleVolume: max(state.lastAudibleVolume, 0.05),
      isMuted: !state.enabled ? false : state.isMuted,
      mixWithOthers: state.mixWithOthers,
      presets: state.presets,
      updatedAt: Date().timeIntervalSince1970
    )
    FocusAudioWidgetStore.write(state)
    return .result()
  }
}

struct ToggleFocusAudioMuteIntent: AppIntent {
  static var title: LocalizedStringResource = "Toggle Focus Audio Mute"
  static var openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult {
    let current = FocusAudioWidgetStore.read()
    let isMuting = !current.isMuted
    let restoredVolume = max(current.lastAudibleVolume, 0.05)
    let nextVolume = isMuting ? 0 : restoredVolume

    let nextState = FocusAudioWidgetState(
      enabled: current.enabled || !isMuting,
      sound: current.sound,
      soundLabel: current.soundLabel,
      soundUri: current.soundUri,
      volume: nextVolume,
      lastAudibleVolume: isMuting ? restoredVolume : restoredVolume,
      isMuted: isMuting,
      mixWithOthers: current.mixWithOthers,
      presets: current.presets,
      updatedAt: Date().timeIntervalSince1970
    )

    FocusAudioWidgetStore.write(nextState)
    return .result()
  }
}

struct SelectFocusAudioSoundIntent: AppIntent {
  static var title: LocalizedStringResource = "Select Focus Audio Sound"
  static var openAppWhenRun: Bool = true

  @Parameter(title: "Sound ID")
  var soundID: String

  init() {}

  init(soundID: String) {
    self.soundID = soundID
  }

  func perform() async throws -> some IntentResult {
    let current = FocusAudioWidgetStore.read()
    let nextPreset = current.presets.first(where: { $0.id == soundID })
      ?? FocusAudioWidgetState.Preset(id: soundID, label: soundID, uri: current.soundUri)
    let nextState = FocusAudioWidgetState(
      enabled: true,
      sound: nextPreset.id,
      soundLabel: nextPreset.label,
      soundUri: nextPreset.uri,
      volume: current.isMuted ? max(current.lastAudibleVolume, 0.05) : current.volume,
      lastAudibleVolume: max(current.lastAudibleVolume, 0.05),
      isMuted: false,
      mixWithOthers: current.mixWithOthers,
      presets: current.presets,
      updatedAt: Date().timeIntervalSince1970
    )

    FocusAudioWidgetStore.write(nextState)
    return .result()
  }
}

struct FocusAudioWidget: Widget {
  let kind: String = widgetKind

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: FocusAudioWidgetProvider()) { entry in
      FocusAudioWidgetView(entry: entry)
    }
    .configurationDisplayName("Focus Audio")
    .description("Quickly start focus audio, mute it, or jump between your favorite sounds.")
    .supportedFamilies([.systemMedium])
  }
}

@main
struct FocusAudioWidgetBundle: WidgetBundle {
  var body: some Widget {
    FocusAudioWidget()
  }
}
