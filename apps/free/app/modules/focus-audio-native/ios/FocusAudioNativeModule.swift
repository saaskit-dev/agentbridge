import AVFoundation
import ExpoModulesCore

private struct FocusAudioSharedState: Codable {
  struct Preset: Codable {
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

private struct FocusAudioNativeConfig {
  let enabled: Bool
  let soundUri: String
  let volume: Double
  let mixWithOthers: Bool
}

private final class FocusAudioNativePlayer {
  static let shared = FocusAudioNativePlayer()

  private let stateKey = "focus-audio-widget-state"
  private var queuePlayer: AVQueuePlayer?
  private var looper: AVPlayerLooper?
  private var currentSoundUri: String?

  private init() {}

  func sync(config: FocusAudioNativeConfig) throws {
    if !config.enabled {
      stop()
      return
    }

    guard let url = URL(string: config.soundUri) else {
      throw Exception(
        name: "InvalidFocusAudioURL",
        description: "Invalid focus audio URL.",
        code: "ERR_INVALID_FOCUS_AUDIO_URL"
      )
    }

    let session = AVAudioSession.sharedInstance()
    var options: AVAudioSession.CategoryOptions = []
    if config.mixWithOthers {
      options.insert(.mixWithOthers)
    }

    try session.setCategory(.playback, mode: .default, options: options)
    try session.setActive(true)

    if queuePlayer == nil || currentSoundUri != config.soundUri {
      let item = AVPlayerItem(url: url)
      let player = AVQueuePlayer()
      looper = AVPlayerLooper(player: player, templateItem: item)
      queuePlayer = player
      currentSoundUri = config.soundUri
    }

    queuePlayer?.volume = Float(max(0, min(1, config.volume)))
    queuePlayer?.play()
  }

  func stop() {
    queuePlayer?.pause()
    queuePlayer?.removeAllItems()
    queuePlayer = nil
    looper = nil
    currentSoundUri = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
  }

  func syncFromSharedState() throws -> Bool {
    guard let state = readSharedState() else {
      return false
    }

    try sync(
      config: FocusAudioNativeConfig(
        enabled: state.enabled,
        soundUri: state.soundUri,
        volume: state.volume,
        mixWithOthers: state.mixWithOthers
      )
    )
    return true
  }

  private func readSharedState() -> FocusAudioSharedState? {
    guard
      let appGroup = appGroup(),
      let defaults = UserDefaults(suiteName: appGroup)
    else {
      return nil
    }

    if
      let raw = defaults.string(forKey: stateKey),
      let data = raw.data(using: .utf8),
      let state = try? JSONDecoder().decode(FocusAudioSharedState.self, from: data)
    {
      return state
    }

    if
      let data = defaults.data(forKey: stateKey),
      let state = try? JSONDecoder().decode(FocusAudioSharedState.self, from: data)
    {
      return state
    }

    return nil
  }

  private func appGroup() -> String? {
    guard let bundleIdentifier = Bundle.main.bundleIdentifier else {
      return nil
    }
    return "group.\(bundleIdentifier)"
  }
}

public final class FocusAudioNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FocusAudioNative")

    AsyncFunction("sync") { (config: [String: Any]) in
      let enabled = config["enabled"] as? Bool ?? false
      let soundUri = config["soundUri"] as? String ?? ""
      let volume = config["volume"] as? Double ?? 0
      let mixWithOthers = config["mixWithOthers"] as? Bool ?? true

      try FocusAudioNativePlayer.shared.sync(
        config: FocusAudioNativeConfig(
          enabled: enabled,
          soundUri: soundUri,
          volume: volume,
          mixWithOthers: mixWithOthers
        )
      )
    }

    AsyncFunction("stop") {
      FocusAudioNativePlayer.shared.stop()
    }

    AsyncFunction("syncFromSharedState") {
      try FocusAudioNativePlayer.shared.syncFromSharedState()
    }
  }
}
