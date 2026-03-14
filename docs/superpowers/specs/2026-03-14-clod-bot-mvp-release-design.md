# Clod Bot — MVP Public Release Design

**Date:** 2026-03-14
**Status:** Approved
**Scope:** GitHub-ready deployability + full Claude CLI command parity + Discord markdown formatting

---

## Overview

Two independent workstreams that together constitute the MVP public release of Clod Bot:

1. **Deployability** — make the repo clean and welcoming enough that anyone with Claude Code CLI and a Discord token can clone it and get running
2. **Interactivity** — expose the full set of meaningful Claude CLI slash commands in Discord, and ensure output is formatted using Discord's native markdown features

Recommended build order: Deployability → Command parity → Markdown formatting. Note: Workstream 3's system prompt injection (Part B) should be applied before doing final testing of new commands, since it affects output quality for all of them. The `check.js` verifier (Workstream 1) and `/doctor` command (Workstream 2) share similar health-check logic — implementation should extract a shared helper to avoid duplication.

---

## Workstream 1: GitHub-Ready Deployability

### Goal
A new user clones the repo, reads the README, fills in `.env`, runs `npm run check`, and `npm start` — and it works. No guessing, no archaeology.

### Changes

#### README Overhaul
- **Prerequisites section** (top of file, before Setup): Node.js 18+, Claude Code CLI installed and authenticated (`claude --version` must work), a Discord account with a bot token
- **Setup steps** expanded to be explicit:
  1. Create Discord application at discord.com/developers
  2. Bot tab → Reset Token → copy it
  3. Enable **Message Content Intent** (Bot tab → Privileged Gateway Intents)
  4. OAuth2 → URL Generator → scopes: `bot`, `applications.commands` → permissions: Send Messages, Read Message History, Attach Files, Use Slash Commands, View Channels
  5. Open generated URL → add bot to server
  6. `git clone`, `npm install`, `cp .env.example .env`, fill in token
  7. `npm run check` to verify environment
  8. `npm start`
- **Troubleshooting section**: covers the top failure modes:
  - Slash commands not appearing → global propagation takes up to 1 hour; use guild commands for instant testing
  - Bot not responding → check Message Content Intent is enabled
  - `claude` not found → Claude Code CLI must be installed and on PATH
  - Permission errors on working directory → check `CLAUDE_WORKDIR` path

#### `.env.example`
```
# Required
DISCORD_BOT_TOKEN=        # From Discord Developer Portal → Bot tab

# Optional
CLAUDE_WORKDIR=           # Working directory for Claude. Default: ./claude-workdir
CLAUDE_MODEL=             # Model override. Default: SDK default (claude-opus-4-5)
FORUM_CHANNEL_ID=         # Channel ID for /thread command (forum channels only)
```

#### `scripts/check.js` (new) — `npm run check`
Validates the environment before the bot runs. Exits 0 on success, 1 with a clear error on failure.

Checks:
- Node.js version ≥ 18
- `DISCORD_BOT_TOKEN` is set in environment
- `claude` is on PATH (`claude --version` exits 0)
- Working directory exists or can be created
- Working directory is writable

Output style: green checkmarks for passing, red ✗ with explanation for failures.

#### `.gitignore` Audit
Ensure the following are excluded:
- `.env`
- `claude-workdir/` contents (keep the dir, not the contents — use `.gitignore` inside it)
- `.superpowers/`
- Any Claude session cache files

---

## Workstream 2: Command Parity

### Goal
All meaningful Claude CLI slash commands are available in Discord. The full command set a user would reach for in the CLI is accessible without leaving Discord.

### Command Inventory

| Command | Description | Status |
|---|---|---|
| `/clear` | Reset session for current channel/thread | ✅ exists |
| `/session` | Show session ID, model, message count | ✅ exists |
| `/sessions` | List all active sessions | ✅ exists |
| `/resume` | Dropdown picker of existing CLI sessions | ✅ exists |
| `/model` | Switch model (sonnet, opus, haiku) | ✅ exists |
| `/kill_all` | Clear all sessions | ✅ exists |
| `/thread` | Create new forum channel post | ✅ exists |
| `/compact [instructions]` | Compact conversation context | 🆕 new |
| `/memory` | List memory files (CLAUDE.md hierarchy) | 🆕 new |
| `/cost` | Show token usage and context bar for session | 🆕 new |
| `/doctor` | Health check (CLI, SDK, Discord, workdir) | 🆕 new |
| `/status` | Current session state summary | 🆕 new |
| `/mcp` | List connected MCP servers and tools | 🆕 new |
| `/tools` | List all tools available in current session | 🆕 new |
| `/skills` | List loaded skills | 🔜 later |
| `/plugins` | List loaded plugins | 🔜 later |

### New Command Specs

#### `/compact [instructions]`
- Sends `/compact [instructions]` as a user message to the active session via `sendToClaud()` — this is how Claude CLI itself triggers compaction internally (it's a special message, not a dedicated SDK method)
- Optional `instructions` string parameter to guide the summary (e.g., "focus on the auth module")
- Error condition: "no active session" means `session.sessionId === null` (the session Map entry exists via lazy init but no SDK query has been made yet — i.e., the bot hasn't exchanged any messages in this channel yet). Reply with `> No active session to compact.` in that case.

#### `/memory`
- Lists CLAUDE.md files that Claude has access to in the current session
- Traversal: walk upward from `session.cwd`, stopping at `WORKING_DIR` (the bot's configured root). Does not traverse above `WORKING_DIR` to avoid surfacing user-level memory files unexpectedly. Also checks `session.cwd` itself.
- Shows file path (relative to `WORKING_DIR`) and first 3 lines of each file
- Read-only in MVP; editing via Discord is a future enhancement
- Formatted as a blockquote list; falls back to "No CLAUDE.md files found in working directory" if none exist

#### `/cost`
- Shows token usage for the current session with a visual context bar:
  ```
  Context   █████████░░░░░░░  58%
  Tokens    12,847 in / 3,201 out
  Session   beads-abc123
  ```
- Uses `█` and `░` block characters for the bar (renders cleanly in Discord mono)
- Data sourced from session metadata returned by the SDK
- Context bar denominator: all current Claude models (Opus, Sonnet, Haiku) have a 200,000-token context window — hardcode 200k as the max. Bar shows `(input_tokens + output_tokens) / 200000 * 100%`
- If the SDK does not return cumulative token counts for a session, show token counts without the bar and note "context % unavailable"

#### `/doctor`
- Runs a quick health check and reports pass/fail for each item:
  ```
  ✅ Claude CLI on PATH (claude 1.x.x)
  ✅ Agent SDK loaded
  ✅ Discord connected
  ✅ Working directory writable (/path/to/claude-workdir)
  ❌ FORUM_CHANNEL_ID not set (optional — needed for /thread)
  ```

#### `/status`
- Shows current session state with visual context bar (same as `/cost`):
  ```
  Model     claude-opus-4-5
  Session   abc123 (14 messages)
  CWD       /path/to/claude-workdir
  Context   █████░░░░░░░░░░░  32%
  MCP       3 servers connected
  ```

#### `/mcp`
- Lists all MCP servers connected in the current session
- Data source: the SDK session object exposes connected MCP servers and their tools in the response metadata. If the SDK does not surface this at slash-command time (outside of an active query), fall back to shelling out to `claude mcp list` in `session.cwd` and parsing its output. The `claude mcp list` output is a plain-text list of server names, one per line, optionally with status indicators — parse by splitting on newlines and trimming whitespace. If that also fails or returns empty, show "No MCP servers found."
- Shows server name, connection status, and tool count
- Formatted as a clean list; falls back to "No MCP servers connected" if none found
- `/status` MCP count uses the same data source and degrades gracefully to "MCP: unknown" if unavailable

#### `/tools`
- Lists all tools available to Claude: built-in tools (Read, Write, Edit, Bash, Glob, Grep, etc.) and MCP-provided tools
- Grouped by source (Built-in / MCP server name)

---

## Workstream 3: Discord Markdown Formatting

### Goal
Claude's output takes full advantage of Discord's native markdown rendering. Responses are readable, well-structured, and never show raw unrendered syntax.

### Part A — Output Post-Processing (`formatForDiscord(text)`)

A post-processing function applied to every response before sending. Handles the gaps between standard markdown and what Discord actually renders:

| Input | Output | Reason |
|---|---|---|
| `# Heading` | `**Heading**` | Discord ignores `#` headers |
| `## Heading` | `__**Heading**__` | Same |
| `### Heading` | `**Heading**` | Intentional: H3 collapses to H1 treatment. Discord has no visual header hierarchy so three levels would look noisy. H1 and H3 both become bold; H2 gets underline+bold to provide one level of visual distinction. |
| Markdown tables | Fenced code block | Discord can't render `\|---|---\|` tables |
| `---` horizontal rules | *(stripped)* | Renders as literal `---` in Discord |
| Everything else | Pass through | Bold, italic, code fences, blockquotes, lists, strikethrough all work natively |

### Part B — System Prompt Formatting Instruction

A formatting preamble injected into each session's system prompt instructing Claude to use Discord-flavored markdown:

- Use fenced code blocks with language tags (` ```js `, ` ```bash `, etc.)
- Use `**bold**` for headers and strong emphasis — avoid `# headings`
- Use `> blockquote` for callouts, warnings, and notes
- Use `-` bullet lists over prose when enumerating items
- Avoid HTML tags, raw bare URLs without context, and wide tables
- Prefer concise responses that stay within Discord's 2000-character chunk limit where possible

### Part C — Visual Meters in Commands

Slash commands that show usage or progress use block-character meters:
```
█████████░░░░░░░  58%
```
- `█` for filled portion, `░` for empty
- Bar width: 16 characters
- Used in `/cost` and `/status`
- Rendered inside a code block for consistent monospace alignment

---

## Architecture Notes

- All three workstreams are independent in terms of feature scope — they do not depend on each other to be built. However, `check.js` (Workstream 1) and `/doctor` (Workstream 2) share health-check logic and should use a common helper to avoid duplication.
- `formatForDiscord()` is a pure function in `bot.js`, applied at the final response assembly step (after `sendToClaud` returns)
- New slash commands follow the exact same handler pattern as existing ones — register in the commands array, add a handler in the `InteractionCreate` switch
- The setup verifier (`check.js`) is a standalone script, no imports from `bot.js`
- Multi-user support is explicitly out of scope for MVP but the session-per-channel architecture already isolates state correctly — adding per-user sessions later is additive, not a rewrite

---

## Out of Scope (MVP)

- `/skills` and `/plugins` commands — require research into SDK introspection APIs
- Editing memory files via Discord
- Multi-user sessions / per-user isolation
- Docker packaging
- GitHub Actions CI
- Voice channel integration
