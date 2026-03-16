import Foundation

/// Lightweight session model for the Watch app.
/// Maps from the RN Session type sent via WatchConnectivity.
struct WatchSession: Identifiable {
    let id: String
    let projectPath: String       // metadata.path
    let projectName: String       // last component of path
    let host: String              // metadata.host
    let isActive: Bool            // session.active
    let isThinking: Bool          // session.thinking
    let presence: SessionPresence // "online" or last-seen timestamp
    let summary: String?          // metadata.summary.text
    let flavor: String?           // metadata.flavor (claude/codex/gemini etc.)
    let updatedAt: Date

    enum SessionPresence {
        case online
        case lastSeen(Date)
    }

    var statusText: String {
        if !isActive { return "Archived" }
        if isThinking { return "Thinking…" }
        switch presence {
        case .online: return "Online"
        case .lastSeen(let date):
            let interval = Date().timeIntervalSince(date)
            if interval < 60 { return "Just now" }
            if interval < 3600 { return "\(Int(interval / 60))m ago" }
            return "\(Int(interval / 3600))h ago"
        }
    }

    var statusColor: String {
        if !isActive { return "gray" }
        if isThinking { return "orange" }
        switch presence {
        case .online: return "green"
        case .lastSeen: return "yellow"
        }
    }

    static func from(_ dict: [String: Any]) -> WatchSession? {
        guard let id = dict["id"] as? String else { return nil }
        let path = dict["projectPath"] as? String ?? ""
        let name = (path as NSString).lastPathComponent
        return WatchSession(
            id: id,
            projectPath: path,
            projectName: name.isEmpty ? "Unknown" : name,
            host: dict["host"] as? String ?? "",
            isActive: dict["isActive"] as? Bool ?? false,
            isThinking: dict["isThinking"] as? Bool ?? false,
            presence: {
                if let p = dict["presence"] as? String, p == "online" {
                    return .online
                }
                if let ts = dict["presenceTimestamp"] as? Double {
                    return .lastSeen(Date(timeIntervalSince1970: ts / 1000))
                }
                return .lastSeen(Date())
            }(),
            summary: dict["summary"] as? String,
            flavor: dict["flavor"] as? String,
            updatedAt: Date(timeIntervalSince1970: (dict["updatedAt"] as? Double ?? 0) / 1000)
        )
    }
}
