# Free CLI

多智能体命令行工具 - 随时随地指挥 AI Agent，全流程增强，更智能的自动化体验

Multi-Agent CLI - Command AI agents anytime, anywhere with enhanced workflows.

## 安装

**一键安装（推荐）：**

```bash
curl -fsSL https://raw.githubusercontent.com/kilingzhang/agentbridge/main/install.sh | bash
```

**或通过 npm：**

```bash
npm install -g @free/cli
```

## Run From Source

From a repo checkout:

```bash
# repository root
yarn cli --help

# package directory
yarn cli --help
```

## 使用

### Claude（默认）

```bash
free
```

这会：

1. 启动 Claude Code 会话
2. 显示二维码，可用移动端扫码连接
3. 支持移动端实时监控和干预

### Gemini

```bash
free gemini
```

启动 Gemini CLI 会话，支持远程控制。

**First time setup:**

```bash
# Authenticate with Google
free connect gemini
```

## Commands

### Main Commands

- `free` – Start Claude Code session (default)
- `free gemini` – Start Gemini CLI session
- `free codex` – Start Codex mode

### Utility Commands

- `free auth` – Manage authentication
- `free connect` – Store AI vendor API keys in Free cloud
- `free sandbox` – Configure sandbox runtime restrictions
- `free notify` – Send a push notification to your devices
- `free daemon` – Manage background service
- `free doctor` – System diagnostics & troubleshooting

### Connect Subcommands

```bash
free connect gemini     # Authenticate with Google for Gemini
free connect claude     # Authenticate with Anthropic
free connect codex      # Authenticate with OpenAI
free connect status     # Show connection status for all vendors
```

### Gemini Subcommands

```bash
free gemini                      # Start Gemini session
free gemini model set <model>    # Set default model
free gemini model get            # Show current model
free gemini project set <id>     # Set Google Cloud Project ID (for Workspace accounts)
free gemini project get          # Show current Google Cloud Project ID
```

**Available models:** `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`

### Sandbox Subcommands

```bash
free sandbox configure  # Interactive sandbox setup wizard
free sandbox status     # Show current sandbox configuration
free sandbox disable    # Disable sandboxing
```

## Options

### Claude Options

- `-m, --model <model>` - Claude model to use (default: sonnet)
- `-p, --permission-mode <mode>` - Permission mode: auto, default, or plan
- `--claude-env KEY=VALUE` - Set environment variable for Claude Code
- `--claude-arg ARG` - Pass additional argument to Claude CLI

### Global Options

- `-h, --help` - Show help
- `-v, --version` - Show version
- `--no-sandbox` - Disable sandbox for the current Claude/Codex run

## Environment Variables

### Free Configuration

- `FREE_SERVER_URL` - Custom server URL (default: https://free-server.saaskit.app)
- `FREE_WEBAPP_URL` - Custom web app URL (default: https://free-server.saaskit.app)
- `FREE_HOME_DIR` - Custom home directory for Free data (default: ~/.free)
- `FREE_DISABLE_CAFFEINATE` - Disable macOS sleep prevention (set to `true`, `1`, or `yes`)
- `FREE_EXPERIMENTAL` - Enable experimental features (set to `true`, `1`, or `yes`)

### Gemini Configuration

- `GEMINI_MODEL` - Override default Gemini model
- `GOOGLE_CLOUD_PROJECT` - Google Cloud Project ID (required for Workspace accounts)

## Gemini Authentication

### Personal Google Account

Personal Gmail accounts work out of the box:

```bash
free connect gemini
free gemini
```

### Google Workspace Account

Google Workspace (organization) accounts require a Google Cloud Project:

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the Gemini API
3. Set the project ID:

```bash
free gemini project set your-project-id
```

Or use environment variable:

```bash
GOOGLE_CLOUD_PROJECT=your-project-id free gemini
```

**Guide:** https://goo.gle/gemini-cli-auth-docs#workspace-gca

## Contributing

Interested in contributing? See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## Requirements

- Node.js >= 20.0.0

### For Claude

- Claude CLI installed & logged in (`claude` command available in PATH)

### For Gemini

- Gemini CLI installed (`npm install -g @google/gemini-cli`)
- Google account authenticated via `free connect gemini`

## License

MIT
