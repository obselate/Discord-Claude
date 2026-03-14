# Discord Polls via In-Process MCP Tool — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Claude the ability to create native Discord polls via a `CreatePoll` MCP tool, wait for results, and auto-continue.

**Architecture:** In-process MCP server created with the SDK's `createSdkMcpServer()` + `tool()`. A mutable `pollContext` object bridges the tool handler to the active Discord channel. A `pendingPolls` Map tracks Promises that resolve when polls close via button click or timeout.

**Tech Stack:** discord.js (native polls, buttons), @anthropic-ai/claude-agent-sdk (in-process MCP), zod 4 (already installed as SDK dependency)

**Spec:** `docs/superpowers/specs/2026-03-14-discord-polls-via-mcp-design.md`

---

## File Map

All changes are in a single file:

- **Modify:** `bot.js` — add imports, poll context, MCP server, button handler, modify `sendToClaud` and intents

No new files. Single-file architecture preserved.

---

## Chunk 1: Foundation — Imports, Config, Poll State

### Task 1: Add new discord.js imports and stream timeout

**Files:**
- Modify: `bot.js:8-20` (imports)
- Modify: `bot.js:26-38` (config)

- [ ] **Step 1: Add `ButtonBuilder` and `ButtonStyle` to discord.js imports**

In `bot.js`, update the discord.js destructure at lines 9-18:

```js
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Events,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require("discord.js");
```

- [ ] **Step 2: Add `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` to config section**

After line 38 (`mkdirSync(WORKING_DIR, { recursive: true });`), add:

```js
// Polls block until a human clicks "Close Poll" — override SDK's 60s timeout
process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = "2764800000"; // 768 hours in ms
```

- [ ] **Step 3: Commit**

```bash
git add bot.js
git commit -m "feat(polls): add ButtonBuilder import and stream close timeout"
```

---

### Task 2: Add poll context and pending polls state

**Files:**
- Modify: `bot.js:50-70` (after session tracking section)

- [ ] **Step 1: Add poll section after session tracking**

After the `getSession` function (line 70), add a new section:

```js
// ---------------------------------------------------------------------------
// Poll state
// ---------------------------------------------------------------------------

/** Mutable context so the MCP tool handler can access the current Discord channel */
const pollContext = { channel: null };

/** @type {Map<string, { resolve: Function, timeout: NodeJS.Timeout, closed: boolean }>} */
const pendingPolls = new Map();
```

- [ ] **Step 2: Commit**

```bash
git add bot.js
git commit -m "feat(polls): add pollContext and pendingPolls state"
```

---

## Chunk 2: Poll Resolution Helper

### Task 3: Add `resolvePoll` helper function

**Files:**
- Modify: `bot.js` (in the new Poll state section)

The button handler and timeout handler both need to resolve a poll the same way. Extract a shared helper to avoid duplication.

- [ ] **Step 1: Add `resolvePoll` function after the `pendingPolls` Map**

```js
/**
 * Resolves a pending poll by collecting results and cleaning up.
 * Idempotent — returns false if already closed.
 * @param {string} messageId - The poll message ID
 * @param {import("discord.js").Message} pollMessage - The poll message object
 * @returns {Promise<boolean>} true if resolved, false if already closed
 */
async function resolvePoll(messageId, pollMessage) {
  const entry = pendingPolls.get(messageId);
  if (!entry || entry.closed) return false;

  entry.closed = true;
  clearTimeout(entry.timeout);

  // End the poll (may already be expired)
  try {
    await pollMessage.poll.end();
  } catch {
    // PollAlreadyExpired — that's fine
  }

  // Re-fetch to get finalized vote counts
  let updatedMessage;
  try {
    updatedMessage = await pollMessage.channel.messages.fetch(messageId);
  } catch {
    entry.resolve("Poll closed but failed to fetch results.");
    pendingPolls.delete(messageId);
    return true;
  }

  // Remove the "Close Poll" button
  try {
    await updatedMessage.edit({ components: [] });
  } catch {
    // Non-critical — button removal failed
  }

  // Build result string
  const poll = updatedMessage.poll;
  const answers = poll.answers;
  let totalVotes = 0;
  const lines = [];

  for (const [, answer] of answers) {
    totalVotes += answer.voteCount;
    lines.push({ text: answer.text, votes: answer.voteCount });
  }

  if (totalVotes === 0) {
    entry.resolve("Poll closed with no votes.");
    pendingPolls.delete(messageId);
    return true;
  }

  // Find winner(s)
  const maxVotes = Math.max(...lines.map((l) => l.votes));

  let result = `Poll results for "${poll.question.text}":\n`;
  for (const line of lines) {
    const marker = line.votes === maxVotes ? " (winner)" : "";
    result += `- ${line.text}: ${line.votes} votes${marker}\n`;
  }
  const winners = lines.filter((l) => l.votes === maxVotes);
  if (winners.length === 1) {
    result += `Winner: ${winners[0].text} (${winners[0].votes} of ${totalVotes} votes)`;
  } else {
    result += `Tie between: ${winners.map((w) => w.text).join(", ")} (${maxVotes} votes each)`;
  }

  entry.resolve(result);
  pendingPolls.delete(messageId);
  return true;
}
```

- [ ] **Step 2: Verify the bot still starts**

Run: `node bot.js`
Expected: Bot logs in without errors. `Ctrl+C` to stop.

- [ ] **Step 3: Commit**

```bash
git add bot.js
git commit -m "feat(polls): add resolvePoll helper for collecting and formatting results"
```

---

## Chunk 3: MCP Server & CreatePoll Tool

### Task 4: Create the in-process MCP server with CreatePoll tool

**Files:**
- Modify: `bot.js` (loadSDK section and ClientReady handler)

- [ ] **Step 1: Add MCP server variable next to `agentSDK`**

After `let agentSDK = null;` (line 41), add:

```js
let pollServer = null; // In-process MCP server for Discord tools
```

- [ ] **Step 2: Create the MCP server in the `ClientReady` handler**

After `console.log("Claude Agent SDK loaded.");` (line 533), add:

```js
  // Create in-process MCP server for Discord tools
  const { z } = await import("zod");
  const { createSdkMcpServer, tool } = agentSDK;

  const createPollTool = tool(
    "CreatePoll",
    "Create a Discord poll to ask channel members a question with multiple choice options. Use this when you want to present users with choices and let them vote. The poll will be posted in the current Discord channel. Results are returned automatically when the poll is closed.",
    {
      question: z.string().max(300).describe("The poll question to ask"),
      options: z.array(z.string().max(55)).min(2).max(10).describe("Answer choices (2-10 options, max 55 chars each)"),
      duration: z.number().min(1).max(768).optional().default(1).describe("Poll duration in hours (default: 1)"),
    },
    async (args) => {
      const channel = pollContext.channel;
      if (!channel) {
        return { content: [{ type: "text", text: "Error: No Discord channel available to post poll." }] };
      }

      try {
        // Post the poll with a "Close Poll" button
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("close_poll_pending") // Updated after message is sent
            .setLabel("Close Poll")
            .setStyle(ButtonStyle.Secondary)
        );

        const pollMessage = await channel.send({
          poll: {
            question: { text: args.question },
            answers: args.options.map((opt) => ({ text: opt })),
            duration: args.duration,
            allowMultiselect: false,
          },
          components: [row],
        });

        // Update button custom ID to include the real message ID
        const updatedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`close_poll_${pollMessage.id}`)
            .setLabel("Close Poll")
            .setStyle(ButtonStyle.Secondary)
        );
        await pollMessage.edit({ components: [updatedRow] });

        console.log(`[Poll] Created poll "${args.question}" in ${channel.id}, message ${pollMessage.id}`);

        // Block until poll is closed
        const resultText = await new Promise((resolve) => {
          const timeout = setTimeout(async () => {
            // Timeout fallback — re-fetch message and resolve
            try {
              const msg = await channel.messages.fetch(pollMessage.id);
              await resolvePoll(pollMessage.id, msg);
            } catch {
              const entry = pendingPolls.get(pollMessage.id);
              if (entry && !entry.closed) {
                entry.closed = true;
                resolve("Poll timed out and results could not be fetched.");
                pendingPolls.delete(pollMessage.id);
              }
            }
          }, args.duration * 60 * 60 * 1000);

          pendingPolls.set(pollMessage.id, { resolve, timeout, closed: false });
        });

        return { content: [{ type: "text", text: resultText }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error creating poll: ${err.message}` }] };
      }
    }
  );

  pollServer = createSdkMcpServer({
    name: "discord-polls",
    tools: [createPollTool],
  });
  console.log("Discord polls MCP server created.");
```

- [ ] **Step 3: Verify the bot starts and logs the MCP server creation**

Run: `node bot.js`
Expected:
```
Logged in as <bot>
Claude Agent SDK loaded.
Discord polls MCP server created.
Slash commands registered globally.
```
`Ctrl+C` to stop.

- [ ] **Step 4: Commit**

```bash
git add bot.js
git commit -m "feat(polls): create in-process MCP server with CreatePoll tool"
```

---

## Chunk 4: Wire Up sendToClaud and Interactions

### Task 5: Pass MCP server and channel to query()

**Files:**
- Modify: `bot.js:76-102` (`sendToClaud` function)

- [ ] **Step 1: Set `pollContext.channel` and add `mcpServers` in `sendToClaud`**

At the start of `sendToClaud`, after `const { query } = await loadSDK();` (line 77), add:

```js
  // Set poll context so the MCP tool handler can access the channel
  pollContext.channel = channel || null;
```

After the `options` object is built (after line 93, `settingSources: ["project", "user"],`), add:

```js
  if (pollServer) {
    options.mcpServers = { "discord-polls": pollServer };
  }
```

- [ ] **Step 2: Commit**

```bash
git add bot.js
git commit -m "feat(polls): wire pollContext and mcpServers into sendToClaud"
```

---

### Task 6: Add button interaction handler

**Files:**
- Modify: `bot.js:548-559` (`InteractionCreate` handler)

- [ ] **Step 1: Add button handler before `isChatInputCommand()` guard**

Replace the existing `InteractionCreate` handler (lines 548-559):

```js
client.on(Events.InteractionCreate, async (interaction) => {
  // Handle "Close Poll" button clicks
  if (interaction.isButton() && interaction.customId.startsWith("close_poll_")) {
    const messageId = interaction.customId.replace("close_poll_", "");
    const entry = pendingPolls.get(messageId);

    if (!entry || entry.closed) {
      await interaction.reply({ content: "Poll already closed.", ephemeral: true });
      return;
    }

    await interaction.deferUpdate();

    try {
      const pollMessage = await interaction.channel.messages.fetch(messageId);
      await resolvePoll(messageId, pollMessage);
    } catch (err) {
      console.error("[Poll] Error closing poll:", err);
      if (entry && !entry.closed) {
        entry.closed = true;
        clearTimeout(entry.timeout);
        entry.resolve("Poll closed but failed to fetch results.");
        pendingPolls.delete(messageId);
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  try {
    await handleCommand(interaction);
  } catch (err) {
    console.error("Command error:", err);
    const reply = interaction.deferred
      ? interaction.editReply
      : interaction.reply;
    await reply.call(interaction, `Error: ${err.message}`);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add bot.js
git commit -m "feat(polls): add Close Poll button interaction handler"
```

---

### Task 7: Add GuildMessagePolls intent

**Files:**
- Modify: `bot.js:515-522` (client intents)

- [ ] **Step 1: Add `GuildMessagePolls` to the intents array**

```js
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessagePolls,
  ],
});
```

- [ ] **Step 2: Verify the bot starts with the new intent**

Run: `node bot.js`
Expected: Bot logs in without errors. If `GuildMessagePolls` isn't recognized, use the raw value `1 << 24` (16777216) instead.

- [ ] **Step 3: Commit**

```bash
git add bot.js
git commit -m "feat(polls): add GuildMessagePolls intent"
```

---

## Chunk 5: Manual Testing

### Task 8: End-to-end test in Discord

**Files:** None (manual testing only)

- [ ] **Step 1: Start the bot**

Run: `node bot.js`
Verify all startup logs appear including "Discord polls MCP server created."

- [ ] **Step 2: Test basic poll creation**

In Discord, send a message to the bot:
```
Ask me a poll: what's my favorite color? Options: Red, Blue, Green
```
Expected: Claude calls `CreatePoll`, a native Discord poll appears with 3 options and a "Close Poll" button. Bot shows typing while waiting.

- [ ] **Step 3: Vote and close the poll**

1. Click a vote option on the poll
2. Click "Close Poll" button
Expected: Button disappears, Claude receives results and responds with a message referencing the winner.

- [ ] **Step 4: Test no-vote close**

Trigger another poll, click "Close Poll" without voting.
Expected: Claude receives "Poll closed with no votes."

- [ ] **Step 5: Test double-close**

Trigger a poll, click "Close Poll" twice quickly.
Expected: Second click shows ephemeral "Poll already closed." — no errors in console.

- [ ] **Step 6: Final commit (if any fixes needed)**

```bash
git add bot.js
git commit -m "fix(polls): address issues found during manual testing"
```
