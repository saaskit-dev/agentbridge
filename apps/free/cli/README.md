# @saaskit-dev/free

[![npm version](https://img.shields.io/npm/v/@saaskit-dev/free.svg)](https://www.npmjs.com/package/@saaskit-dev/free)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Multi-Agent CLI - Command AI agents (Claude, Gemini, Codex, OpenCode) anytime, anywhere with enhanced workflows and remote control via mobile app.

## Installation

```bash
npm install -g @saaskit-dev/free
```

## Quick Start

```bash
# Start Claude Code session (default)
free

# Start with specific agent
free gemini
free codex
free opencode

# Authenticate
free auth

# Check system health
free doctor
```

On launch, a QR code is displayed for connecting the [Free mobile app](https://github.com/saaskit-dev/agentbridge) for real-time monitoring and control.

## Commands

### Agent Sessions

| Command         | Description                         |
| --------------- | ----------------------------------- |
| `free`          | Start Claude Code session (default) |
| `free gemini`   | Start Gemini CLI session            |
| `free codex`    | Start Codex session                 |
| `free opencode` | Start OpenCode session              |

### Management

| Command                                   | Description                                      |
| ----------------------------------------- | ------------------------------------------------ |
| `free auth`                               | Manage authentication                            |
| `free connect [vendor]`                   | Store AI vendor API keys (gemini, claude, codex) |
| `free connect status`                     | Show connection status for all vendors           |
| `free daemon start\|stop\|status`         | Manage background daemon                         |
| `free doctor`                             | System diagnostics & troubleshooting             |
| `free sandbox configure\|status\|disable` | Configure sandbox runtime                        |
| `free notify`                             | Send push notification to your devices           |

### Claude Options

- `-m, --model <model>` - Claude model to use (default: sonnet)
- `-p, --permission-mode <mode>` - Permission mode: auto, default, or plan
- `--claude-env KEY=VALUE` - Set environment variable for Claude Code
- `--claude-arg ARG` - Pass additional argument to Claude CLI

### Global Options

- `-h, --help` - Show help
- `-v, --version` - Show version
- `--no-sandbox` - Disable sandbox for the current run

## Environment Variables

| Variable                  | Description                                      | Default                           |
| ------------------------- | ------------------------------------------------ | --------------------------------- |
| `FREE_SERVER_URL`         | Custom server URL                                | `https://free-server.saaskit.app` |
| `FREE_WEBAPP_URL`         | Custom web app URL                               | `https://free-server.saaskit.app` |
| `FREE_HOME_DIR`           | Custom home directory for Free data              | `~/.free`                         |
| `FREE_DISABLE_CAFFEINATE` | Disable macOS sleep prevention                   | -                                 |
| `FREE_EXPERIMENTAL`       | Enable experimental features                     | -                                 |
| `GEMINI_MODEL`            | Override default Gemini model                    | -                                 |
| `GOOGLE_CLOUD_PROJECT`    | Google Cloud Project ID (for Workspace accounts) | -                                 |

## Architecture

Free CLI wraps AI agent CLIs (Claude Code, Gemini CLI, Codex, OpenCode) with:

- **Daemon process** — Persistent background service that owns agent processes; CLI crash doesn't interrupt agents
- **End-to-end encryption** — All communications encrypted with TweetNaCl before leaving the device
- **Real-time sync** — WebSocket-based session streaming to mobile app and web client
- **MCP bridge** — Model Context Protocol permission server for remote approval/denial
- **Multi-agent ACP** — Unified Agent Client Protocol backend for all supported agents

## Bundled Tools

The package includes platform-specific binaries (downloaded on `postinstall`):

- **difftastic** — Structural diff tool
- **ripgrep** — Fast code search

Supported platforms: macOS (arm64/x64), Linux (arm64/x64), Windows (x64/arm64).

## Requirements

- Node.js >= 20.0.0
- For Claude: Claude CLI installed & logged in (`claude` in PATH)
- For Gemini: Gemini CLI installed (`npm install -g @google/gemini-cli`) + `free connect gemini`
- For Codex: Codex CLI installed

## License

MIT
