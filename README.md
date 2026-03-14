# Clod Bot

Discord bot powered by [Claude Code](https://claude.ai/code) via the Agent SDK. No API key needed — uses your Claude subscription auth. Full Claude Code capabilities: tools, MCP servers, skills, plugins, agents, session persistence.

## Prerequisites

Before you start, make sure you have:

- **Node.js 18+** — `node --version` should print `v18.x` or higher
- **Claude Code CLI** — install at [claude.ai/code](https://claude.ai/code), then run `claude --version` to confirm it's on your PATH and authenticated
- **A Discord bot token** — see setup steps below

## Setup

### 1. Create a Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**
2. **Bot** tab → **Reset Token** → copy the token
3. **Bot** tab → **Privileged Gateway Intents** → enable **Message Content Intent**
4. **OAuth2** → **URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Read Message History`, `Attach Files`, `Use Slash Commands`, `View Channels`
5. Copy the generated URL → open it in your browser → add the bot to your server

### 2. Install and Run

```bash
git clone <this-repo>
cd discord-claude-bot
npm install
cp .env.example .env
# Edit .env and paste your DISCORD_BOT_TOKEN
npm run check     # verify your environment
npm start         # launch the bot
```

## Slash Commands

| Command | Description |
|---------|-------------|
| `/clear` | Reset the Claude session for this channel |
| `/session` | Show current session ID, model, and message count |
| `/sessions` | List all active sessions across channels |
| `/resume` | Pick an existing Claude CLI session to resume |
| `/model <name>` | Switch model (e.g. `sonnet`, `opus`, `haiku`) |
| `/kill_all` | Clear all active sessions |
| `/thread` | Create a new forum post with a dedicated Claude session |
| `/compact [instructions]` | Compact the conversation context |
| `/memory` | List CLAUDE.md memory files in the working directory |
| `/cost` | Show token usage and context window usage for this session |
| `/status` | Show full session state summary |
| `/mcp` | List connected MCP servers |
| `/tools` | List available tools |
| `/doctor` | Run a health check on the bot's environment |

## Usage

- **@mention the bot** or **reply to one of its messages** to chat
- **DM the bot** directly — no mention needed
- **Attach files or images** — they're saved to the working directory and Claude can read them
- Each channel or thread gets its own isolated Claude session with full conversation history

## Configuration

Edit `.env` (copy from `.env.example`):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_BOT_TOKEN` | ✅ Yes | — | From Discord Developer Portal |
| `CLAUDE_WORKDIR` | No | `./claude-workdir` | Working directory for Claude's file operations |
| `CLAUDE_MODEL` | No | SDK default | Model override (e.g. `claude-sonnet-4-5`) |
| `FORUM_CHANNEL_ID` | No | — | Channel ID for `/thread` command (must be a Forum channel) |

## Troubleshooting

**Slash commands not showing up in Discord**
Global slash command registration can take up to 1 hour to propagate. This is a Discord limitation. If you need instant updates during development, switch to guild-scoped registration (see `CLAUDE.md` for details).

**Bot not responding to messages**
Check that **Message Content Intent** is enabled in your Discord bot settings (Bot tab → Privileged Gateway Intents).

**`claude` not found on PATH**
Claude Code CLI must be installed and on your PATH. Run `claude --version` in your terminal to verify. If it's not found, reinstall from [claude.ai/code](https://claude.ai/code).

**Working directory permission errors**
Check that `CLAUDE_WORKDIR` points to a directory your user can write to. The bot creates `./claude-workdir` by default.

**`npm run check` fails**
Run it and read the output — each failing check includes an explanation. Fix those issues before running `npm start`.

## How It Works

Each Discord channel or thread maps to a Claude Code session. Messages are sent through the Agent SDK's `query()` function, which handles tool execution, context management, and session persistence internally. Session IDs are tracked in memory and passed as `resume` on each subsequent message, giving Claude full conversation continuity.

Since this uses the Agent SDK (not raw API), Claude has access to:
- File tools: Read, Write, Edit, Bash, Glob, Grep
- MCP servers (configured via Claude Code's settings)
- Skills and plugins (loaded from `.claude/` directories)
- Sub-agents and parallel execution
- Automatic context compaction

## Notes

- **Single-user bot** — each message blocks while Claude processes. Not designed for high-concurrency public servers.
- **No API key needed** — the Agent SDK authenticates via your Claude subscription.
- `permissionMode: "bypassPermissions"` is set so Claude never prompts for tool approval interactively.
