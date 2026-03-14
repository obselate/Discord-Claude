# Beads Dashboard — Design Spec

## Overview

A dedicated Discord channel displays a single, auto-updating message showing all open beads grouped by status and sorted by priority. The bot maintains this message by polling `bd` CLI output every 30 seconds and editing the message only when the content changes.

## Configuration

- **New env var**: `BEADS_CHANNEL_ID` — the Discord channel where the dashboard message lives
- **Value**: `1482471217028923604`
- Added to `.env` alongside existing vars (`DISCORD_BOT_TOKEN`, `CLAUDE_WORKDIR`, etc.)

## Architecture

### New file: `dashboard.js`

Exports a single function: `startDashboard(client)`.

Called from `bot.js` inside the `ClientReady` handler, after SDK and MCP server setup.

### Data flow

1. **Startup**: `startDashboard(client)` fetches the target channel via `BEADS_CHANNEL_ID`.
2. **Find or create message**: Searches the channel for the bot's most recent message. If found, reuses it (edits). If not, sends a new one.
3. **Poll loop** (every 30s):
   - Shells out to `bd list --status=in_progress`, `bd list --status=open`, and `bd blocked` via `child_process.execSync` (or `exec` with await).
   - Parses output to extract bead ID, title, priority, status, and blocker info.
   - Builds the formatted message string.
   - Compares against the cached previous message content.
   - If identical, skips (lazy — no API call).
   - If different, edits the Discord message and updates the cache.

## Message Format

```
Beads Dashboard
Last updated: Mar 14, 2026 3:45 PM

In Progress
- [P1] beads-def — Fix poll timeout bug
- [P2] beads-abc — Implement beads dashboard

Open
- [P3] beads-ghi — Add /model autocomplete
- [P4] beads-jkl — Refactor session tracking

Blocked
- [P2] beads-mno — Write tests for polls (blocked by beads-abc)
```

### Formatting rules

- Sections use emoji headers: `In Progress`, `Open`, `Blocked`
- Each bead shows: `[P<n>] <id> — <title>`
- Blocked beads append: `(blocked by <id>)`
- Beads within each section are sorted by priority ascending (P0 first, P4 last)
- Empty sections are omitted entirely
- If no open beads exist: "No open beads"
- Timestamp updates on every edit

## Message Persistence

On startup, the bot fetches recent messages in the dashboard channel and looks for one authored by itself. If found, it reuses that message ID for all subsequent edits. This prevents duplicate dashboard messages after bot restarts.

If the tracked message is deleted or the edit fails, the bot sends a new message and tracks the new ID.

## Parsing `bd` Output

The bot uses `bd list --json` if available for structured output. Falls back to parsing text output if `--json` is not supported. Key fields needed per bead:

- ID (e.g., `beads-abc`)
- Title
- Priority (0-4)
- Status (`open`, `in_progress`)
- Blocked-by list (from `bd blocked`)

## Error Handling

- **`bd` command fails**: Log the error, skip this polling tick, retain the previous message content. Do not update the Discord message with error state.
- **Channel not found**: Log a warning at startup, disable dashboard entirely. Do not crash the bot.
- **Message edit fails**: Attempt to send a new message. If that also fails, log and retry next tick.
- **`BEADS_CHANNEL_ID` not set**: Dashboard feature is silently disabled. No error, no warning beyond a startup log line.

## Integration with `bot.js`

Minimal changes to `bot.js`:

1. Add `BEADS_CHANNEL_ID` to the config section.
2. Import `startDashboard` from `./dashboard.js`.
3. Call `startDashboard(client)` at the end of the `ClientReady` handler.

## Scope Exclusions

- No slash command to manually refresh (polling handles it).
- No historical tracking or archival of closed beads.
- No notification/ping when beads change — the message is a passive dashboard.
- Dashboard does not interact with or depend on the polling MCP server or session system.
