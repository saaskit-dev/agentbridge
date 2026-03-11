# Free

**Remote Control Platform for AI Coding Agents**

Control Claude Code, Codex, Gemini, and OpenCode from anywhere. Monitor progress, handle permission requests, and manage multiple AI agents through a unified mobile interface.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

## Features

- **Multi-Agent Support** — Unified management for Claude Code, OpenAI Codex, Google Gemini CLI, and OpenCode
- **Remote Control** — Monitor agent progress, handle permission requests, and manage sessions from your phone
- **End-to-End Encryption** — X25519 + AES-256-GCM ensures your code never leaves your device unencrypted
- **Real-Time Sync** — WebSocket-based communication with millisecond latency
- **Session Persistence** — Resume sessions across devices seamlessly
- **Background Daemon** — Keep agents running even when CLI is closed

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Free Platform                             │
│                                                                  │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────┐    │
│  │  Mobile App │ ←→  │   Server    │ ←→  │   CLI / Daemon  │    │
│  │  (React     │     │  (Fastify)  │     │   (Node.js)     │    │
│  │   Native)   │     │             │     │                 │    │
│  └─────────────┘     └─────────────┘     └────────┬────────┘    │
│                                                   │              │
│                                          ┌───────┴───────┐      │
│                                          │  AI Agents    │      │
│                                          │ Claude, Codex │      │
│                                          │ Gemini, etc.  │      │
│                                          └───────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
agentbridge/
├── packages/
│   └── core/              # @agentbridge/core - Shared types & interfaces
│
└── apps/free/
    ├── cli/               # CLI & Daemon for local AI agents
    ├── server/            # Backend API & WebSocket server
    └── app/               # React Native mobile client
```

| Package | Description |
|---------|-------------|
| `@agentbridge/core` | Core types, interfaces, and cross-platform implementations |
| `@saaskit-dev/free` (CLI) | Command-line tool for spawning and managing AI agents |
| `@free/server` | Fastify-based backend with encryption relay and session management |
| `@free/app` | React Native (Expo) mobile and web client |

## Quick Start

### Install CLI

**One-line install (recommended):**

```bash
curl -fsSL https://raw.githubusercontent.com/saaskit-dev/agentbridge/main/install.sh | bash
```

**Or via npm:**

```bash
npm install -g @saaskit-dev/free
```

**Uninstall:**

```bash
curl -fsSL https://raw.githubusercontent.com/saaskit-dev/agentbridge/main/uninstall.sh | bash
```

### Start an Agent Session

```bash
# Claude Code (default)
free

# Gemini CLI
free gemini

# OpenAI Codex
free codex

# OpenCode
free opencode
```

### Connect Mobile App

The CLI displays a QR code on startup. Scan it with the Free mobile app to start remote control.

## CLI Commands

### Agent Sessions

```bash
free                    # Start Claude Code session
free gemini             # Start Gemini CLI session
free codex              # Start Codex session
free opencode           # Start OpenCode session
```

### Authentication

```bash
free connect gemini     # Google account authentication
free connect claude     # Anthropic authentication
free connect codex      # OpenAI authentication
free connect status     # View connection status
free auth               # Manage authentication
```

### Daemon Management

```bash
free daemon start       # Start background daemon
free daemon stop        # Stop daemon
free daemon status      # Check daemon status
```

### Utilities

```bash
free doctor             # System diagnostics
free --help             # Show help
```

### Options

```bash
free -m sonnet                    # Specify model
free -p auto                      # Permission mode: auto, default, plan
free --claude-env KEY=VALUE       # Pass environment variables
free --no-sandbox                 # Disable sandbox mode
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `FREE_SERVER_URL` | Backend server URL | `https://free-server.saaskit.app` |
| `FREE_HOME_DIR` | Data directory | `~/.free` |
| `FREE_DISABLE_CAFFEINATE` | Disable macOS sleep prevention | `false` |
| `GEMINI_MODEL` | Gemini model to use | - |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID (required for Workspace accounts) | - |

## Development

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 8.0.0
- For mobile development: Expo CLI

### Setup

```bash
# Clone the repository
git clone https://github.com/saaskit-dev/agentbridge.git
cd agentbridge

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Run Locally

```bash
# Start backend server (development)
pnpm server

# Start mobile app
pnpm app

# iOS specific
pnpm app:ios

# Android specific
pnpm app:android
```

### Testing

```bash
pnpm test
```

## Deployment

### Docker

```bash
cd apps/free/server
./build.sh
./deploy.sh
```

### Server Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `FREE_MASTER_SECRET` | Master encryption key | Yes |
| `PORT` | Server port | No (default: 3000) |
| `DATABASE_URL` | PostgreSQL connection string | No (uses PGlite by default) |

## Security

- **End-to-End Encryption**: All data is encrypted using X25519 for key exchange and AES-256-GCM for symmetric encryption
- **No Code Storage**: Your code never leaves your machine; only encrypted metadata is synced
- **Challenge-Response Auth**: Cryptographic authentication prevents replay attacks
- **Session Isolation**: Each session uses unique encryption keys

## Telemetry

Free uses a unified telemetry system for logging:

- **Local Logs**: Stored in `~/.free/logs/` as JSONL files
- **Remote Logs**: Only `info`, `warn`, `error` levels are sent to the server
- **Trace Correlation**: Full trace ID propagation across Daemon → CLI → Server → App

## System Requirements

- **Node.js**: >= 20.0.0
- **Claude CLI**: Required for Claude mode
- **Gemini CLI**: Required for Gemini mode
- **Codex CLI**: Required for Codex mode

## Roadmap

- [ ] Web dashboard for session management
- [ ] Multiple session support per machine
- [ ] Custom MCP server configuration via UI
- [ ] Team collaboration features
- [ ] Self-hosted server option

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Anthropic](https://anthropic.com) for Claude Code
- [OpenAI](https://openai.com) for Codex
- [Google](https://ai.google.dev) for Gemini CLI
- [OpenCode](https://github.com/opencode-ai/opencode) for OpenCode
