import SwiftUI

struct ContentView: View {
    @EnvironmentObject var connectivity: WatchConnectivityManager

    var body: some View {
        NavigationStack {
            Group {
                if connectivity.sessions.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "terminal")
                            .font(.largeTitle)
                            .foregroundColor(.secondary)
                        Text("No Sessions")
                            .font(.headline)
                        Text("Open Free on your iPhone to start a coding session.")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding()
                } else {
                    List(connectivity.sessions) { session in
                        NavigationLink(destination: SessionDetailView(session: session)) {
                            SessionRow(session: session)
                        }
                    }
                }
            }
            .navigationTitle("Free")
        }
    }
}

// MARK: - Session Row

struct SessionRow: View {
    let session: WatchSession

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)
                Text(session.projectName)
                    .font(.headline)
                    .lineLimit(1)
            }

            if let summary = session.summary {
                Text(summary)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }

            HStack {
                if let flavor = session.flavor {
                    Text(flavor)
                        .font(.caption2)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(Color.blue.opacity(0.2))
                        .cornerRadius(4)
                }
                Spacer()
                Text(session.statusText)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 2)
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
