# Claude Code Discord Bot

Discord frontend for Claude Code via the Agent SDK. No API key — uses your Claude subscription auth. Full Claude Code capabilities: tools, MCP servers, skills, plugins, agents, the works.

## How It Works

Each message spawns a `query()` call through the Claude Agent SDK. Session IDs are tracked per channel/thread and passed via `resume` for conversation continuity. The SDK handles all tool execution, context management, and session persistence internally.

## Setup

### 1. Create Discord Bot

1. https://discord.com/developers/applications → New Application
2. Bot tab → Reset Token → copy it
3. Bot tab → enable **Message Content Intent**
4. OAuth2 → URL Generator:
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Send Messages`, `Read Message History`, `Attach Files`, `Use Slash Commands`, `View Channels`
5. Copy URL → open → add to your server

### 2. Install & Run

```bash
npm install
cp .env.example .env
# Edit .env with your bot token
node bot.js
```

Claude Code CLI must be installed and authenticated on the host (`claude` on PATH).

## Usage

- **@mention the bot** or **DM it** — messages go through the Agent SDK
- Attach files — they're saved to the working directory
- Each channel/thread = isolated session with resume

## Discord Slash Commands

| Command     | Description                              |
|-------------|------------------------------------------|
| `/clear`    | Reset session for current channel/thread |
| `/session`  | Show session ID, model, message count    |
| `/sessions` | List all active sessions                 |
| `/resume`   | Dropdown picker of existing CLI sessions |
| `/model`    | Switch model (sonnet, opus, haiku)       |
| `/kill_all` | Clear all sessions                       |

## What You Get

Since this runs through the Agent SDK (not raw API), you get:

- Full tool access (Read, Write, Edit, Bash, Glob, Grep)
- MCP server integration
- Skills and plugins (loaded via `settingSources`)
- Agent/subagent support
- Session persistence and resume
- Automatic context management and compaction

## Config

Environment variables (or `.env`):

| Variable          | Default            | Description                          |
|-------------------|--------------------|--------------------------------------|
| `DISCORD_BOT_TOKEN` | (required)       | Discord bot token                    |
| `CLAUDE_WORKDIR`  | `./claude-workdir` | Working directory for Claude         |
| `CLAUDE_MODEL`    | (SDK default)      | Default model                        |

## Notes

- No `ANTHROPIC_API_KEY` needed — SDK falls back to your subscription auth
- `permissionMode: "bypassPermissions"` is set so Claude doesn't prompt for tool approval interactively
- `settingSources: ["project", "user"]` loads skills from both project and user `.claude/skills/`
- Solo use. Each message blocks while Claude processes — fine for one person, not for a public bot
