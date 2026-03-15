# Discord Claude Bot

## Project Overview
Discord bot wrapping Claude Code via the Agent SDK. CommonJS with dynamic ESM import for the SDK.

## Commands
- `npm start` — run the bot
- `npm run dev` — run with `--watch` for auto-reload
- `npm run check` — run health/lint checks

## Architecture
- `bot.js` — orchestrator: config, client setup, poll state, event wiring (~380 lines)
- `lib/sessions.js` — session Map + `getSession()`
- `lib/commands.js` — slash command definitions array
- `lib/handlers.js` — slash command handler switch
- `lib/sdk.js` — Agent SDK loading + `sendToClaude()`
- `lib/formatting.js` — Discord markdown, chunking, progress bars, MCP helpers
- `lib/attachments.js` — file attachment saving
- `dashboard.js` — per-thread pinned beads dashboards (~315 lines)
- `scripts/` — `check.js`, `health.js` utilities
- Agent SDK is ESM-only, loaded via dynamic `import()` in CJS
- Sessions tracked per channel/thread ID in an in-memory Map
- Slash commands registered globally on startup (propagation ~1 hour; use guild commands for instant dev testing)

## Environment
- Windows (Git Bash) — use forward slashes in paths
- `.env`: `DISCORD_BOT_TOKEN` (required), `CLAUDE_WORKDIR`, `CLAUDE_MODEL`, `FORUM_CHANNEL_ID`
- No `ANTHROPIC_API_KEY` needed — SDK uses subscription auth

## Code Style
- CommonJS, no TypeScript
- Section separators: `// ---...---` comment blocks
- Commits: one logical change, prefixed `feat(scope):` / `fix(scope):` etc.

## Gotchas
- `claude-workdir/` is inside the repo — don't commit its contents
- SDK `query()` blocks per message — single-user bot, not suited for concurrency
- `permissionMode: "bypassPermissions"` — headless, no interactive tool approval
