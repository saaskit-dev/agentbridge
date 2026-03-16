import SwiftUI

struct SessionDetailView: View {
    @EnvironmentObject var connectivity: WatchConnectivityManager
    let session: WatchSession

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                // Status header
                HStack {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 10, height: 10)
                    Text(session.statusText)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }

                // Project info
                VStack(alignment: .leading, spacing: 4) {
                    Label(session.projectName, systemImage: "folder")
                        .font(.headline)
                    Label(session.host, systemImage: "desktopcomputer")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                // Summary
                if let summary = session.summary {
                    Divider()
                    Text(summary)
                        .font(.body)
                }

                Divider()

                // Quick actions
                if session.isActive {
                    Button(action: {
                        connectivity.sendCommand("stopSession", payload: ["sessionId": session.id])
                    }) {
                        Label("Stop Session", systemImage: "stop.circle")
                    }
                    .tint(.red)
                }
            }
            .padding()
        }
        .navigationTitle(session.projectName)
    }

    private var statusColor: Color {
        switch session.statusColor {
        case "green": return .green
        case "orange": return .orange
        case "yellow": return .yellow
        default: return .gray
        }
    }
}
