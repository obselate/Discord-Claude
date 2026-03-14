# Discord Claude Bot

## Project Overview
Discord bot wrapping Claude Code via the Agent SDK. Single-file architecture (`bot.js`), CommonJS with dynamic ESM import for the SDK.

## Commands
- `npm start` / `node bot.js` — run the bot
- `npm run dev` — run with `--watch` for auto-reload

## Architecture
- `bot.js` — entire bot: config, session tracking, SDK interaction, Discord handlers
- Agent SDK (`@anthropic-ai/claude-agent-sdk`) is ESM-only, loaded via dynamic `import()` in CJS
- `permissionMode: "bypassPermissions"` — headless, no interactive tool approval
- Sessions tracked per channel/thread ID in an in-memory Map
- Slash commands registered globally on startup (propagation takes up to 1 hour; use guild commands for instant testing)

## Environment
- Windows (Git Bash) — use forward slashes in paths
- `.env` file: `DISCORD_BOT_TOKEN` (required), `CLAUDE_WORKDIR`, `CLAUDE_MODEL`, `FORUM_CHANNEL_ID`
- No `ANTHROPIC_API_KEY` needed — SDK uses subscription auth

## Code Style
- CommonJS (`require`/`module.exports`), no TypeScript
- JSDoc type hints for complex structures (see `sessions` Map)
- Section separators: `// ---...---` comment blocks with titles
- Incremental commits: one logical change per commit, prefixed with `feat(scope):` or similar

## Key Patterns
- `getSession(channelId)` — lazy-initializes session with defaults
- `chunkMessage(text)` — splits responses to fit Discord's 2000-char limit (using 1900 buffer)
- `sendToClaud(prompt, session)` — streams SDK response, collects text + tool use indicators
- `botThreads` Set — tracks bot-created threads so messages don't need @mention

## Testing
- No automated tests — test manually via Discord
- For slash command changes: use guild-scoped registration for instant updates during dev, switch to global for production

## Gotchas
- `claude-workdir/` is the default working directory AND is inside the repo — don't commit its contents
- The SDK `query()` blocks per message — this is a single-user bot, not suited for concurrent users
- Attachments are saved to `session.cwd` which defaults to WORKING_DIR but can be overridden by `/thread`
