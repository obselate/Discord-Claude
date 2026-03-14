# Discord Polls via In-Process MCP Tool

## Problem

Claude needs a way to ask Discord users structured questions with multiple-choice options during a conversation. The SDK's built-in UserPrompt mechanism is freeform text — we need a dedicated tool that creates a native Discord poll, waits for results, and feeds them back to Claude automatically.

## Solution

An in-process MCP server using the Agent SDK's `createSdkMcpServer()` that exposes a `CreatePoll` tool. Claude calls it with a question and options, the bot posts a native Discord poll with a "Close Poll" button, waits for the poll to close, and returns the results to Claude.

## Architecture

### In-Process MCP Server

The SDK supports in-process MCP servers via `createSdkMcpServer()` and the `tool()` helper. The server runs in the same Node.js process as the bot — no IPC, no separate process. Tool handlers have full access to the bot's state via closures.

Created once on bot startup. Passed to every `query()` call via `options.mcpServers`:

```js
const pollServer = createSdkMcpServer({ name: "discord-polls", tools: [pollTool] });
// In query options:
options.mcpServers = { "discord-polls": pollServer };
```

### Stream Close Timeout

The SDK kills tool calls that exceed 60 seconds by default. Since polls block until a human clicks "Close Poll", `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` must be set at process startup to a value exceeding the maximum poll duration:

```js
process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = "2764800000"; // 768 hours in ms
```

### Channel Context

A mutable context object provides the tool handler with the current Discord channel:

```js
const pollContext = { channel: null };
```

- Updated in `sendToClaud` before each `query()` call: `pollContext.channel = channel`
- The tool handler reads `pollContext.channel` to post the poll
- Returns an error result if `channel` is null

### CreatePoll Tool Definition

```js
tool(
  "CreatePoll",
  "Create a Discord poll to ask channel members a question with multiple choice options",
  z.object({
    question: z.string().max(300),
    options: z.array(z.string().max(55)).min(2).max(10),
    duration: z.number().min(1).max(768).optional().default(1) // hours
  }),
  handler
)
```

Constraints match Discord's native poll limits:
- Question: max 300 characters
- Options: 2-10 items, max 55 characters each
- Duration: in hours (Discord API requirement), default 1 hour
- `allowMultiselect: false` — single choice for clear results

### Poll Lifecycle

1. **Claude calls `CreatePoll`** with question, options, and optional duration
2. **Tool handler posts a Discord message** with:
   - A native poll (`message.poll`)
   - A "Close Poll" button (`ActionRow` with `ButtonBuilder`)
3. **Handler returns a Promise** that blocks until the poll closes
4. **Poll closes** when either:
   - Someone clicks the "Close Poll" button
   - The duration timeout expires (local `setTimeout` fallback)
5. **Handler collects results** from `message.poll.answers` vote tallies
6. **Handler returns formatted results** to Claude as a text string
7. **Claude auto-continues** with the poll results — no user action needed

### Pending Polls Map

A `Map` tracks active polls so the button handler can resolve the tool handler's Promise:

```js
/** @type {Map<string, { resolve: Function, timeout: NodeJS.Timeout, closed: boolean }>} */
const pendingPolls = new Map();
```

Keyed by poll message ID. Each entry holds the Promise's `resolve` function, the timeout handle, and a `closed` guard flag to prevent double-resolution.

### Close Poll Button

- Custom ID format: `close_poll_<messageId>`
- Handled in the `InteractionCreate` listener — the button check **must come before** the existing `isChatInputCommand()` early return, since that guard would swallow button interactions
- On click:
  1. Acknowledges the interaction via `interaction.deferUpdate()`
  2. Checks the `closed` guard flag — if already closed, replies ephemeral "Poll already closed" and returns
  3. Sets `closed = true` and calls `clearTimeout` on the timeout handle
  4. Calls `message.poll.end()` (wrapped in try/catch to handle `PollAlreadyExpired`)
  5. Fetches vote tallies from `message.poll.answers`
  6. Edits the message to remove the button
  7. Resolves the pending Promise with the poll results
  8. Removes the entry from `pendingPolls`

### Timeout Fallback

A local `setTimeout` matching the poll duration fires if the button is never clicked:
- Checks the `closed` guard flag — skips if already resolved
- Sets `closed = true`
- Fetches the poll message to get final results
- Resolves the pending Promise the same way the button does
- Removes the entry from `pendingPolls`
- Wraps `poll.end()` in try/catch to handle already-expired polls

### Error Handling

- If `channel.send()` fails (missing permissions, channel deleted), the tool handler returns an error result to Claude rather than throwing
- `poll.end()` is always wrapped in try/catch to handle `PollAlreadyExpired` gracefully

### Result Format

Returned to Claude as a text content block:

```
Poll results for "What should we name this?":
- UserManager: 2 votes
- AuthHandler: 5 votes (winner)
- AccountService: 1 vote
Winner: AuthHandler (5 votes)
```

If no votes: `"Poll closed with no votes."`

## Changes to bot.js

### New Imports

- `ButtonBuilder`, `ButtonStyle` from discord.js
- `zod` (new dependency) for MCP tool schema
- `createSdkMcpServer`, `tool` from `@anthropic-ai/claude-agent-sdk` (loaded via dynamic import)

### New Intent

Add `GuildMessagePolls` to the client's intent list.

### New Sections

1. **Poll context object** — `const pollContext = { channel: null }`
2. **MCP server creation** — in `ClientReady` handler, after SDK loads
3. **CreatePoll tool handler** — async function that posts poll, awaits close, returns results
4. **Pending polls map** — `pendingPolls` Map for tracking active poll Promises
5. **Button interaction handler** — in `InteractionCreate`, **before** the `isChatInputCommand()` guard, handle `isButton()` with `close_poll_` prefix

### Modified Sections

1. **`sendToClaud`** — set `pollContext.channel = channel` before `query()`, add `mcpServers` to options
2. **Client intents** — add `GuildMessagePolls`

## Dependencies

- `zod` — new npm dependency for MCP tool input schema validation

## Testing

Manual testing via Discord:
1. Ask Claude a question that would benefit from a poll (e.g., "Ask me which name I prefer for this module")
2. Verify native poll appears with correct options and "Close Poll" button
3. Vote on the poll
4. Click "Close Poll" and verify Claude receives results and continues
5. Test timeout: let a poll expire without clicking the button
6. Test edge case: no votes cast
