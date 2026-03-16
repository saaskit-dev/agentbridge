import Foundation
import WatchConnectivity
import Combine

/// Manages WatchConnectivity communication with the iPhone app.
/// Receives session data from the RN side via applicationContext.
final class WatchConnectivityManager: NSObject, ObservableObject {
    static let shared = WatchConnectivityManager()

    @Published var sessions: [WatchSession] = []
    @Published var isReachable = false

    private override init() {
        super.init()
        if WCSession.isSupported() {
            let session = WCSession.default
            session.delegate = self
            session.activate()
        }
    }

    /// Send a command to the iPhone app (e.g. approve/deny permission, send message)
    func sendCommand(_ command: String, payload: [String: Any] = [:]) {
        guard WCSession.default.isReachable else { return }
        var message = payload
        message["command"] = command
        WCSession.default.sendMessage(message, replyHandler: nil, errorHandler: { error in
            print("[Watch] sendCommand error: \(error.localizedDescription)")
        })
    }
}

// MARK: - WCSessionDelegate

extension WatchConnectivityManager: WCSessionDelegate {
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async {
            self.isReachable = session.isReachable
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isReachable = session.isReachable
        }
    }

    /// iPhone sends updated session list via applicationContext
    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        guard let data = applicationContext["sessions"] as? [[String: Any]] else { return }
        let decoded = data.compactMap { WatchSession.from($0) }
        DispatchQueue.main.async {
            self.sessions = decoded
        }
    }

    /// iPhone sends real-time messages (e.g. permission requests)
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        // Handle real-time messages if needed
    }
}
