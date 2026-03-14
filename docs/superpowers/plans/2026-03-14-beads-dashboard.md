# Beads Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-updating Discord message showing all open beads grouped by status and sorted by priority.

**Architecture:** New `dashboard.js` module (CommonJS) exports `startDashboard(client)` and `stopDashboard()`. Polls `bd` CLI every 30s via async `child_process.exec`, diffs against cached content, edits a single Discord message only when content changes. Called from `bot.js` `ClientReady` handler.

**Tech Stack:** Node.js, discord.js, child_process (promisified), `bd` CLI with `--json` output

**Spec:** `docs/superpowers/specs/2026-03-14-beads-dashboard-design.md`

**Working directory:** All commands assume `cwd` is the repo root: `C:\Users\zack7\Projects\Discord-Claude`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `dashboard.js` | Create | All dashboard logic: bd polling, message formatting, Discord message management |
| `bot.js` | Modify (line 22: add import, line 721: call startDashboard) | Import + call `startDashboard`, wire `stopDashboard` to SIGINT |
| `.env` | Modify (do NOT commit) | Add `BEADS_CHANNEL_ID=1482471217028923604` |

---

## Chunk 1: Core Dashboard Module

### Task 1: Create dashboard.js skeleton with config and exports

**Files:**
- Create: `dashboard.js`

- [ ] **Step 1: Create `dashboard.js` with config, state, and exported function stubs**

```js
/**
 * Beads dashboard — maintains an auto-updating Discord message
 * showing open beads grouped by status and sorted by priority.
 */

const { exec } = require("child_process");
const { promisify } = require("util");
const { resolve } = require("path");

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BEADS_CHANNEL_ID = process.env.BEADS_CHANNEL_ID || "";
const POLL_INTERVAL_MS = 30_000;
const MAX_MSG_LEN = 1900;

// Project root where .beads/ lives (parent of claude-workdir)
const PROJECT_ROOT = resolve(process.env.CLAUDE_WORKDIR || "./claude-workdir", "..");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let dashboardMessageId = null;
let cachedBody = "";
let intervalHandle = null;
let dashboardChannel = null;
let botUserId = null;

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Start the beads dashboard polling loop.
 * @param {import("discord.js").Client} client
 */
async function startDashboard(client) {
  // TODO: Task 5
}

/** Stop the polling loop. */
function stopDashboard() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("[Dashboard] Stopped.");
  }
}

module.exports = { startDashboard, stopDashboard };
```

- [ ] **Step 2: Verify the file parses without errors**

Run: `node -e "require('./dashboard.js')"`
Expected: No output (no errors)

- [ ] **Step 3: Commit**

```bash
git add dashboard.js
git commit -m "feat(dashboard): create dashboard.js skeleton with config and exports"
```

---

### Task 2: Verify `bd blocked --json` output shape

Before writing code that depends on `bd blocked --json`, we need to know the actual field names.

**Files:** None (research only)

- [ ] **Step 1: Create two test beads with a dependency to produce blocked output**

```bash
bd create --title="Blocker bead" --type=task --priority=1
bd create --title="Blocked bead" --type=task --priority=2
bd dep add <blocked-id> <blocker-id>
```

- [ ] **Step 2: Run `bd blocked --json` and inspect the output**

```bash
bd blocked --json
```

Record the actual field names. We need to know:
- Does each entry have a field like `blocked_by`, `blockers`, `dependencies`, or something else?
- Is that field an array of strings (IDs) or an array of objects?

- [ ] **Step 3: Clean up test beads**

```bash
bd close <blocker-id> <blocked-id> --reason="test data for dashboard plan"
```

- [ ] **Step 4: Note the findings for use in Task 3**

Update the `fetchBeads()` code in Task 3 if the field name differs from the assumed `blocked_by`.

---

### Task 3: Implement `fetchBeads()` — async bd CLI calls and grouping

**Files:**
- Modify: `dashboard.js`

- [ ] **Step 1: Add `fetchBeads()` function after the State section**

This function shells out to `bd list` and `bd blocked`, parses JSON, and returns beads grouped by status with blocked beads separated out. **Adjust the `blocked_by` field name based on Task 2 findings.**

```js
// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

/**
 * Fetch beads from bd CLI, grouped by status.
 * @returns {Promise<{ inProgress: Array, open: Array, blocked: Array } | null>}
 *   null if bd commands fail
 */
async function fetchBeads() {
  try {
    const opts = { cwd: PROJECT_ROOT };

    const [listResult, blockedResult] = await Promise.all([
      execAsync("bd list --json --sort=priority", opts),
      execAsync("bd blocked --json", opts),
    ]);

    const allBeads = JSON.parse(listResult.stdout || "[]");
    const blockedBeads = JSON.parse(blockedResult.stdout || "[]");

    // Build a Map of blocked bead IDs -> blocker info for quick lookup
    // NOTE: Adjust field name (blocked_by, blockers, etc.) based on Task 2 findings
    const blockedMap = new Map();
    for (const b of blockedBeads) {
      blockedMap.set(b.id, b.blocked_by || []);
    }

    // Group: blocked beads go to blocked section regardless of their status field
    const groups = { inProgress: [], open: [], blocked: [] };

    for (const bead of allBeads) {
      if (blockedMap.has(bead.id)) {
        groups.blocked.push({ ...bead, blockedBy: blockedMap.get(bead.id) });
      } else if (bead.status === "in_progress") {
        groups.inProgress.push(bead);
      } else {
        groups.open.push(bead);
      }
    }

    return groups;
  } catch (err) {
    console.error("[Dashboard] bd command failed:", err.message);
    return null;
  }
}
```

- [ ] **Step 2: Verify the module still parses**

Run: `node --check dashboard.js`
Expected: No output (no syntax errors)

- [ ] **Step 3: Commit**

```bash
git add dashboard.js
git commit -m "feat(dashboard): implement fetchBeads with bd CLI calls and status grouping"
```

---

### Task 4: Implement `formatHeader()`, `formatBody()`, and helpers — message builder

The header and body are separate from the start so that the lazy diff in `tick()` can compare body content only (timestamps change every call and would defeat the diff).

**Files:**
- Modify: `dashboard.js`

- [ ] **Step 1: Add formatting functions after `fetchBeads()`**

```js
// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

/**
 * Format the dashboard header with timestamp.
 * @returns {string}
 */
function formatHeader() {
  const now = new Date();
  const timestamp = now.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `📋 **Beads Dashboard**\nLast updated: ${timestamp}\n\n`;
}

// Header length is stable (varies by ~1 char for hour digit). Use a safe estimate.
const HEADER_RESERVE = 60;

/**
 * Format grouped beads into the body (no header/timestamp).
 * @param {{ inProgress: Array, open: Array, blocked: Array }} groups
 * @returns {string}
 */
function formatBody(groups) {
  const { inProgress, open, blocked } = groups;

  if (inProgress.length === 0 && open.length === 0 && blocked.length === 0) {
    return "No open beads 🎉";
  }

  const maxBody = MAX_MSG_LEN - HEADER_RESERVE;
  const lines = [];

  if (inProgress.length > 0) {
    lines.push("🔴 **In Progress**");
    lines.push(...truncateSection(formatSection(inProgress), maxBody, lines));
    lines.push("");
  }

  if (open.length > 0) {
    lines.push("🟡 **Open**");
    lines.push(...truncateSection(formatSection(open), maxBody, lines));
    lines.push("");
  }

  if (blocked.length > 0) {
    lines.push("🔵 **Blocked**");
    lines.push(...truncateSection(formatBlockedSection(blocked), maxBody, lines));
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

/**
 * Format a list of beads as bullet lines, sorted by priority.
 * @param {Array} beads
 * @returns {string[]}
 */
function formatSection(beads) {
  return beads
    .sort((a, b) => (a.priority ?? 4) - (b.priority ?? 4))
    .map((b) => `• [P${b.priority ?? "?"}] ${b.id} — ${b.title}`);
}

/**
 * Format blocked beads with blocker info.
 * @param {Array} beads
 * @returns {string[]}
 */
function formatBlockedSection(beads) {
  return beads
    .sort((a, b) => (a.priority ?? 4) - (b.priority ?? 4))
    .map((b) => {
      const blockers = b.blockedBy;
      const suffix =
        Array.isArray(blockers) && blockers.length > 0
          ? ` ⛔ blocked by ${blockers.join(", ")}`
          : "";
      return `• [P${b.priority ?? "?"}] ${b.id} — ${b.title}${suffix}`;
    });
}

/**
 * Truncate section lines if adding them would exceed the max body length.
 * Returns the lines that fit, plus an "...and N more" line if truncated.
 * @param {string[]} sectionLines - formatted bead lines for this section
 * @param {number} maxBody - max total body length
 * @param {string[]} existingLines - lines already accumulated
 * @returns {string[]}
 */
function truncateSection(sectionLines, maxBody, existingLines) {
  const currentLen = existingLines.join("\n").length;
  const result = [];

  for (let i = 0; i < sectionLines.length; i++) {
    const candidateLen = currentLen + [...result, sectionLines[i]].join("\n").length;
    if (candidateLen > maxBody - 30) {
      const remaining = sectionLines.length - i;
      result.push(`*...and ${remaining} more*`);
      break;
    }
    result.push(sectionLines[i]);
  }

  return result;
}
```

- [ ] **Step 2: Verify the module still parses**

Run: `node --check dashboard.js`
Expected: No output (no syntax errors)

- [ ] **Step 3: Commit**

```bash
git add dashboard.js
git commit -m "feat(dashboard): implement formatHeader, formatBody with per-section truncation"
```

---

### Task 5: Implement message persistence and `startDashboard()` with poll loop

**Files:**
- Modify: `dashboard.js`

- [ ] **Step 1: Add `findExistingMessage()` and `updateMessage()` after the formatting section**

```js
// ---------------------------------------------------------------------------
// Message persistence
// ---------------------------------------------------------------------------

/**
 * Search the dashboard channel for the bot's most recent message to reuse.
 * @returns {Promise<string|null>} message ID or null
 */
async function findExistingMessage() {
  try {
    const messages = await dashboardChannel.messages.fetch({ limit: 20 });
    const botMsg = messages.find((m) => m.author.id === botUserId);
    return botMsg ? botMsg.id : null;
  } catch (err) {
    console.error("[Dashboard] Failed to search for existing message:", err.message);
    return null;
  }
}

/**
 * Send or edit the dashboard message.
 * @param {string} content
 */
async function updateMessage(content) {
  // Try to edit existing message
  if (dashboardMessageId) {
    try {
      const msg = await dashboardChannel.messages.fetch(dashboardMessageId);
      await msg.edit(content);
      return;
    } catch {
      console.warn("[Dashboard] Failed to edit message, sending new one.");
      dashboardMessageId = null;
    }
  }

  // Send a new message
  try {
    const msg = await dashboardChannel.send(content);
    dashboardMessageId = msg.id;
  } catch (err) {
    console.error("[Dashboard] Failed to send message:", err.message);
  }
}
```

- [ ] **Step 2: Replace the `startDashboard` stub with the full implementation**

Replace the `async function startDashboard(client) { // TODO: Task 5 }` stub:

```js
async function startDashboard(client) {
  if (!BEADS_CHANNEL_ID) {
    console.log("[Dashboard] BEADS_CHANNEL_ID not set, dashboard disabled.");
    return;
  }

  botUserId = client.user.id;

  // Fetch the target channel
  try {
    dashboardChannel =
      client.channels.cache.get(BEADS_CHANNEL_ID) ||
      (await client.channels.fetch(BEADS_CHANNEL_ID));
  } catch (err) {
    console.warn("[Dashboard] Could not fetch channel:", err.message);
    return;
  }

  // Look for an existing dashboard message to reuse
  dashboardMessageId = await findExistingMessage();
  if (dashboardMessageId) {
    console.log(`[Dashboard] Reusing existing message: ${dashboardMessageId}`);
  }

  // Run immediately, then on interval
  await tick();
  intervalHandle = setInterval(tick, POLL_INTERVAL_MS);
  console.log(`[Dashboard] Polling every ${POLL_INTERVAL_MS / 1000}s in #${dashboardChannel.name || BEADS_CHANNEL_ID}`);
}
```

- [ ] **Step 3: Add `tick()` function right before `startDashboard`**

```js
/** Single poll tick: fetch, format, diff, update. */
async function tick() {
  const groups = await fetchBeads();
  if (!groups) return; // bd failed, skip this tick

  // Build body without timestamp for diffing
  const body = formatBody(groups);

  // Lazy: skip if bead data hasn't changed
  if (body === cachedBody) return;

  cachedBody = body;

  // Build full message with fresh timestamp
  const content = formatHeader() + body;
  await updateMessage(content);
}
```

- [ ] **Step 4: Verify the module parses**

Run: `node --check dashboard.js`
Expected: No output (no syntax errors)

- [ ] **Step 5: Commit**

```bash
git add dashboard.js
git commit -m "feat(dashboard): implement startDashboard with poll loop, persistence, and lazy diffing"
```

---

## Chunk 2: Integration with bot.js

### Task 6: Add env var and wire dashboard into bot.js

**Files:**
- Modify: `bot.js` (after line 22 for import, between lines 721-722 for startup call)
- Modify: `.env` (do NOT stage/commit this file — it contains the bot token)

- [ ] **Step 1: Add `BEADS_CHANNEL_ID` to `.env`**

Append to `.env`:

```
BEADS_CHANNEL_ID=1482471217028923604
```

⚠️ Do NOT commit `.env` — it contains `DISCORD_BOT_TOKEN`.

- [ ] **Step 2: Add import at top of `bot.js` after the existing `require` statements (after line 22)**

After `const { mkdirSync, writeFileSync } = require("fs");` add:

```js
const { startDashboard, stopDashboard } = require("./dashboard.js");
```

- [ ] **Step 3: Call `startDashboard` in `ClientReady` handler**

Insert between the closing brace of the slash-command try/catch (line 721) and the closing `});` of ClientReady (line 722):

```js

  // Start beads dashboard polling
  startDashboard(c).catch((err) =>
    console.error("[Dashboard] Startup failed:", err)
  );
```

- [ ] **Step 4: Add graceful shutdown handler at the end of bot.js, before `client.login()`**

Insert before `client.login(DISCORD_TOKEN);`:

```js
// Graceful shutdown — clean up dashboard interval (useful for --watch restarts)
process.on("SIGINT", () => {
  stopDashboard();
  client.destroy();
  process.exit(0);
});
```

- [ ] **Step 5: Verify bot.js parses without errors**

Run: `node --check bot.js`
Expected: No output (no syntax errors)

- [ ] **Step 6: Commit (bot.js only — NOT .env)**

```bash
git add bot.js
git commit -m "feat(dashboard): wire beads dashboard into bot.js startup with graceful shutdown"
```

---

### Task 7: Manual end-to-end test

**Files:** None (manual verification)

- [ ] **Step 1: Start the bot**

Run: `npm start`

Expected in console:
- `[Dashboard] Polling every 30s in #<channel-name>`
- OR `[Dashboard] BEADS_CHANNEL_ID not set, dashboard disabled.` if env var missing

- [ ] **Step 2: Create a test bead and observe the dashboard**

In another terminal:
```bash
bd create --title="Dashboard test bead" --type=task --priority=1
```

Wait up to 30 seconds. Check the Discord channel — the dashboard message should appear or update with the new bead under the 🟡 **Open** section.

- [ ] **Step 3: Update the bead status and verify the dashboard updates**

```bash
bd update <id> --status=in_progress
```

Wait up to 30 seconds. The bead should move from the Open section to 🔴 **In Progress**.

- [ ] **Step 4: Close the bead and verify it disappears**

```bash
bd close <id> --reason="test complete"
```

Wait up to 30 seconds. The bead should be removed from the dashboard. If no other beads exist, message should show "No open beads 🎉".

- [ ] **Step 5: Stop the bot and restart — verify it reuses the existing message**

Stop the bot (Ctrl+C), restart with `npm start`. Check console for `[Dashboard] Reusing existing message: <id>`. The dashboard channel should still have only one message (not a duplicate).

- [ ] **Step 6: Final commit (if any fixes were needed during testing)**

```bash
git add dashboard.js bot.js
git commit -m "fix(dashboard): adjustments from manual testing"
```
