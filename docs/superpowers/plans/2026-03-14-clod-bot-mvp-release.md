# Clod Bot MVP Public Release Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Clod Bot GitHub-ready for public release with full Claude CLI command parity and Discord-native markdown formatting.

**Architecture:** Three independent workstreams executed in order: (1) repo polish and setup verifier, (2) seven new slash commands wired into bot.js's existing command switch, (3) a `formatForDiscord()` post-processor and system prompt preamble applied to all Claude responses. Token counts are accumulated per-session to power `/cost` and `/status` context bars.

**Tech Stack:** Node.js 18+ (CJS), discord.js 14, @anthropic-ai/claude-agent-sdk (ESM via dynamic import), dotenv

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `bot.js` | Modify | Add 7 new commands, token tracking, `buildBar()`, `formatForDiscord()`, system prompt constant |
| `package.json` | Modify | Add `"check": "node scripts/check.js"` script |
| `.gitignore` | Modify | Add `.superpowers/`, `*.claude-session` exclusions |
| `README.md` | Modify | Full overhaul: prerequisites, expanded setup, troubleshooting |
| `.env.example` | Create | Documented env vars template |
| `scripts/health.js` | Create | Shared health-check helpers (used by both `check.js` and `/doctor`) |
| `scripts/check.js` | Create | CLI env verifier — `npm run check` |

---

## Chunk 1: Deployability

### Task 1: Fix .gitignore and create .env.example

**Files:**
- Modify: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Update .gitignore**

Open `.gitignore` and replace its contents with:

```
node_modules/
.env
claude-workdir/
.superpowers/
```

- [ ] **Step 2: Verify .gitignore doesn't accidentally exclude the claude-workdir directory itself**

The line `claude-workdir/` excludes the directory and all its contents. That's correct — we want the directory committed (via an empty `.gitkeep`) but not its contents.

- [ ] **Step 3: Add .gitkeep to preserve the claude-workdir directory**

Run:
```bash
touch claude-workdir/.gitkeep
```

- [ ] **Step 4: Create .env.example**

Create `.env.example` with:

```
# Required — get this from Discord Developer Portal → Bot tab → Reset Token
DISCORD_BOT_TOKEN=

# Optional — working directory for Claude's file operations. Default: ./claude-workdir
CLAUDE_WORKDIR=

# Optional — model override. Default: SDK default (claude-opus-4-5)
# Examples: claude-sonnet-4-5, claude-haiku-4-5
CLAUDE_MODEL=

# Optional — Discord channel ID for /thread command (must be a Forum channel)
# Leave blank to create threads in the current channel instead
FORUM_CHANNEL_ID=
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore .env.example claude-workdir/.gitkeep
git commit -m "chore: add .env.example and fix .gitignore for public release"
```

---

### Task 2: Create scripts/health.js (shared health-check helpers)

**Files:**
- Create: `scripts/health.js`

This module exports individual check functions used by both `scripts/check.js` (pre-run CLI verifier) and the `/doctor` bot command. Each function returns `{ ok: boolean, message: string }`.

- [ ] **Step 1: Create scripts/ directory**

```bash
mkdir -p scripts
```

- [ ] **Step 2: Write scripts/health.js**

```js
/**
 * Shared health-check helpers.
 * Each function returns { ok: boolean, message: string }.
 * Used by scripts/check.js (CLI) and the /doctor slash command (bot).
 */

const { execSync } = require("child_process");
const { accessSync, mkdirSync, constants } = require("fs");
const { resolve } = require("path");

/**
 * Check Node.js version is >= 18.
 */
function checkNodeVersion() {
  const major = parseInt(process.versions.node.split(".")[0], 10);
  if (major >= 18) {
    return { ok: true, message: `Node.js ${process.versions.node}` };
  }
  return { ok: false, message: `Node.js ${process.versions.node} — need >= 18` };
}

/**
 * Check DISCORD_BOT_TOKEN is set in environment.
 */
function checkDiscordToken() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (token && token.length > 10) {
    return { ok: true, message: "DISCORD_BOT_TOKEN is set" };
  }
  return { ok: false, message: "DISCORD_BOT_TOKEN is not set — add it to .env" };
}

/**
 * Check `claude` CLI is on PATH and responds to --version.
 */
function checkClaudeCLI() {
  try {
    const output = execSync("claude --version", { encoding: "utf8", timeout: 5000 }).trim();
    return { ok: true, message: `Claude CLI: ${output}` };
  } catch {
    return {
      ok: false,
      message: "`claude` not found on PATH — install Claude Code CLI and make sure it's authenticated",
    };
  }
}

/**
 * Check working directory exists or can be created, and is writable.
 * @param {string} dir - Absolute path to check
 */
function checkWorkingDir(dir) {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return { ok: true, message: `Working directory: ${dir}` };
  } catch (err) {
    return { ok: false, message: `Working directory not writable: ${dir} — ${err.message}` };
  }
}

/**
 * Check FORUM_CHANNEL_ID is set (optional — only needed for /thread).
 */
function checkForumChannelId() {
  const id = process.env.FORUM_CHANNEL_ID;
  if (id && id.length > 5) {
    return { ok: true, message: `FORUM_CHANNEL_ID: ${id}` };
  }
  return { ok: false, message: "FORUM_CHANNEL_ID not set (optional — needed for /thread forum posts)" };
}

module.exports = { checkNodeVersion, checkDiscordToken, checkClaudeCLI, checkWorkingDir, checkForumChannelId };
```

- [ ] **Step 3: Verify module loads without errors**

```bash
node -e "const h = require('./scripts/health.js'); console.log(Object.keys(h));"
```

Expected output: `[ 'checkNodeVersion', 'checkDiscordToken', 'checkClaudeCLI', 'checkWorkingDir', 'checkForumChannelId' ]`

- [ ] **Step 4: Commit**

```bash
git add scripts/health.js
git commit -m "feat(check): add shared health-check helpers in scripts/health.js"
```

---

### Task 3: Create scripts/check.js

**Files:**
- Create: `scripts/check.js`

- [ ] **Step 1: Write scripts/check.js**

```js
#!/usr/bin/env node
/**
 * Environment verifier — run with `npm run check` before starting the bot.
 * Exits 0 if all required checks pass, 1 if any required check fails.
 */

require("dotenv/config");
const { resolve } = require("path");
const {
  checkNodeVersion,
  checkDiscordToken,
  checkClaudeCLI,
  checkWorkingDir,
  checkForumChannelId,
} = require("./health.js");

const WORKING_DIR = resolve(process.env.CLAUDE_WORKDIR || "./claude-workdir");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function pass(msg) { console.log(`${GREEN}  ✅ ${msg}${RESET}`); }
function fail(msg) { console.log(`${RED}  ❌ ${msg}${RESET}`); }
function warn(msg) { console.log(`${YELLOW}  ⚠️  ${msg}${RESET}`); }

console.log("\nClod Bot — Environment Check\n");

const required = [
  checkNodeVersion(),
  checkDiscordToken(),
  checkClaudeCLI(),
  checkWorkingDir(WORKING_DIR),
];

const optional = [
  checkForumChannelId(),
];

let failed = 0;

console.log("Required:");
for (const result of required) {
  if (result.ok) {
    pass(result.message);
  } else {
    fail(result.message);
    failed++;
  }
}

console.log("\nOptional:");
for (const result of optional) {
  if (result.ok) {
    pass(result.message);
  } else {
    warn(result.message);
  }
}

if (failed === 0) {
  console.log(`\n${GREEN}All required checks passed. Run \`npm start\` to launch the bot.${RESET}\n`);
  process.exit(0);
} else {
  console.log(`\n${RED}${failed} required check(s) failed. Fix the issues above before starting.${RESET}\n`);
  process.exit(1);
}
```

- [ ] **Step 2: Run the check script to verify it works**

```bash
node scripts/check.js
```

Expected: colored output showing each check result, exit 0 if env is configured.

- [ ] **Step 3: Commit**

```bash
git add scripts/check.js
git commit -m "feat(check): add npm run check environment verifier"
```

---

### Task 4: Add check script to package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add check script**

In `package.json`, update the `scripts` section to:

```json
"scripts": {
  "start": "node bot.js",
  "dev": "node --watch bot.js",
  "check": "node scripts/check.js"
}
```

- [ ] **Step 2: Verify npm run check works**

```bash
npm run check
```

Expected: same output as `node scripts/check.js`.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add npm run check script to package.json"
```

---

### Task 5: Overhaul README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace README.md with the full public-release version**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: overhaul README for public release with prerequisites and troubleshooting"
```

---

## Chunk 2: Command Parity

### Task 6: Add token tracking to session state

**Files:**
- Modify: `bot.js`

The `/cost` and `/status` commands need cumulative token counts per session. Add `inputTokens` and `outputTokens` fields to `getSession()` and capture them from the SDK's `result` message.

- [ ] **Step 1: Update getSession() to include token fields**

Find this block in `bot.js` (around line 68):
```js
sessions.set(channelId, {
  sessionId: null,
  model: DEFAULT_MODEL,
  messageCount: 0,
  cwd: WORKING_DIR,
});
```

Replace with:
```js
sessions.set(channelId, {
  sessionId: null,
  model: DEFAULT_MODEL,
  messageCount: 0,
  cwd: WORKING_DIR,
  inputTokens: 0,
  outputTokens: 0,
});
```

- [ ] **Step 2: Update JSDoc type hint for session**

Find (line 61):
```js
/** @type {Map<string, { sessionId: string|null, model: string, messageCount: number, cwd: string }>} */
```

Replace with:
```js
/** @type {Map<string, { sessionId: string|null, model: string, messageCount: number, cwd: string, inputTokens: number, outputTokens: number }>} */
```

- [ ] **Step 3: Capture token usage in the result message handler in sendToClaud()**

Find this block inside the `case "result":` handler (around line 239):
```js
        case "result":
          if (
            message.subtype === "success" &&
            message.result &&
            chunks.length === 0
          ) {
            chunks.push(message.result);
          } else if (message.subtype === "error") {
            chunks.push(`❌ **Error:** ${message.error || "Unknown error"}`);
          }
          // Capture session ID from result too
          if (message.session_id) {
            session.sessionId = message.session_id;
          }
          break;
```

Replace with:
```js
        case "result":
          if (
            message.subtype === "success" &&
            message.result &&
            chunks.length === 0
          ) {
            chunks.push(message.result);
          } else if (message.subtype === "error") {
            chunks.push(`❌ **Error:** ${message.error || "Unknown error"}`);
          }
          // Capture session ID from result too
          if (message.session_id) {
            session.sessionId = message.session_id;
          }
          // Accumulate token usage for /cost and /status
          if (message.usage) {
            session.inputTokens += message.usage.input_tokens || 0;
            session.outputTokens += message.usage.output_tokens || 0;
          }
          break;
```

- [ ] **Step 4: Add a temporary debug log to confirm SDK token field names**

In the `case "result":` handler, temporarily add a log line after the usage capture:

```js
          // Accumulate token usage for /cost and /status
          if (message.usage) {
            session.inputTokens += message.usage.input_tokens || 0;
            session.outputTokens += message.usage.output_tokens || 0;
            console.log("[debug] usage:", JSON.stringify(message.usage)); // TEMP
          }
```

- [ ] **Step 5: Start the bot and send one message, then check the console**

```bash
npm start
# Send any message to the bot in Discord, then check terminal output
```

Expected: a line like `[debug] usage: {"input_tokens":1234,"output_tokens":56}` confirming the field names. If the field names differ (e.g. camelCase), update the accessor in the code to match.

- [ ] **Step 6: Remove the temporary debug log**

Remove the `console.log("[debug] usage:...")` line added in Step 4.

- [ ] **Step 7: Verify bot still starts without errors**

```bash
node -e "require('./bot.js')" 2>&1 | head -5
```

Expected: no syntax errors.

- [ ] **Step 8: Commit**

```bash
git add bot.js
git commit -m "feat(session): track cumulative input/output tokens per session"
```

---

### Task 7: Add buildBar() and getMcpServers() helpers to bot.js

**Files:**
- Modify: `bot.js`

`buildBar()` is used by `/cost` and `/status` to render a 16-character block-character progress bar.

- [ ] **Step 1: Add buildBar() after the chunkMessage() function**

Find the section separator after `chunkMessage()` (around line 301):
```js
// ---------------------------------------------------------------------------
// File attachment handling
// ---------------------------------------------------------------------------
```

Insert before it:

```js
// ---------------------------------------------------------------------------
// Visual helpers
// ---------------------------------------------------------------------------

/**
 * Renders a 16-character block-character progress bar.
 * @param {number} value - Current value
 * @param {number} max - Maximum value
 * @returns {string} e.g. "████████░░░░░░░░  50%"
 */
function buildBar(value, max) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const filled = Math.round(pct * 16);
  const empty = 16 - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const label = `${Math.round(pct * 100)}%`;
  return `${bar}  ${label}`;
}

/**
 * Returns list of MCP server names via `claude mcp list`, or [] on failure.
 * Note: `claude mcp list` returns server names, not individual tool names.
 * Listing individual tools per server requires deeper SDK introspection
 * not available in the current Agent SDK version.
 * @param {string} cwd - Working directory for the claude command
 * @returns {string[]}
 */
function getMcpServers(cwd) {
  // child_process is required inline here to keep it co-located with the
  // function — execSync is only used by this helper so it isn't hoisted
  // to the top-level imports.
  const { execSync } = require("child_process");
  try {
    const out = execSync("claude mcp list", { encoding: "utf8", timeout: 5000, cwd }).trim();
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Verify buildBar() works correctly**

```bash
node -e "
function buildBar(value, max) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const filled = Math.round(pct * 16);
  const empty = 16 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const label = Math.round(pct * 100) + '%';
  return bar + '  ' + label;
}
console.log(buildBar(0, 200000));
console.log(buildBar(100000, 200000));
console.log(buildBar(200000, 200000));
"
```

Expected:
```
░░░░░░░░░░░░░░░░  0%
████████░░░░░░░░  50%
████████████████  100%
```

- [ ] **Step 3: Commit**

```bash
git add bot.js
git commit -m "feat(ui): add buildBar() block-character progress bar helper"
```

---

### Task 8: Register 7 new slash commands

**Files:**
- Modify: `bot.js`

- [ ] **Step 1: Add new command definitions to the commands array**

Find the end of the `commands` array (after the `thread` command definition, before the closing `]`):

```js
  },
];
```

Replace that closing `];` with:

```js
  },
  {
    name: "compact",
    description: "Compact the conversation context to free up context window",
    options: [
      {
        name: "instructions",
        description: "Optional guidance for the summary (e.g. 'focus on auth module')",
        type: 3, // STRING
        required: false,
        max_length: 500,
      },
    ],
  },
  {
    name: "memory",
    description: "List CLAUDE.md memory files in the working directory",
  },
  {
    name: "cost",
    description: "Show token usage and context window usage for this session",
  },
  {
    name: "doctor",
    description: "Run a health check on the bot environment",
  },
  {
    name: "status",
    description: "Show full session state summary",
  },
  {
    name: "mcp",
    description: "List connected MCP servers",
  },
  {
    name: "tools",
    description: "List available tools in this session",
  },
];
```

- [ ] **Step 2: Verify the commands array has 14 entries**

Count `name:` occurrences inside the `commands` array (each command definition has exactly one `name:` field):

```bash
node -e "
const src = require('fs').readFileSync('./bot.js', 'utf8');
// Extract the commands array literal by finding text between 'const commands = [' and the first '];'
const start = src.indexOf('const commands = [');
const end = src.indexOf('];', start) + 2;
const block = src.slice(start, end);
const count = (block.match(/\bname:/g) || []).length;
console.log('Command count:', count, count === 14 ? '✅' : '❌ expected 14');
"
```

Expected: `Command count: 14 ✅`

- [ ] **Step 3: Commit**

```bash
git add bot.js
git commit -m "feat(commands): register /compact, /memory, /cost, /doctor, /status, /mcp, /tools"
```

---

### Task 9: Add /compact handler

**Files:**
- Modify: `bot.js`

- [ ] **Step 1: Add compact case to handleCommand() switch**

Find this exact text at the very end of `handleCommand()` — the closing of `case "thread"` and the function:

```js
      break;
    }
  }
}
```

Replace with (inserts the compact case before the closing braces):

```js
      break;
    }

    case "compact": {
      const session = sessions.get(channelId);
      if (!session || session.sessionId === null) {
        await interaction.reply("> No active session to compact. Send a message first.");
        break;
      }

      const instructions = interaction.options.getString("instructions") || "";
      const prompt = instructions ? `/compact ${instructions}` : "/compact";

      await interaction.deferReply();
      try {
        await sendToClaud(prompt, session, interaction.channel);
        await interaction.editReply("> Session compacted.");
      } catch (err) {
        await interaction.editReply(`❌ Compact failed: ${err.message}`);
      }
      break;
    }
  }
}
```

- [ ] **Step 2: Test via Discord**

Send a few messages to the bot in a channel to create an active session, then run `/compact`. Expected: bot replies `> Session compacted.`

Test with no prior session: run `/compact` in a fresh channel. Expected: `> No active session to compact. Send a message first.`

- [ ] **Step 3: Commit**

```bash
git add bot.js
git commit -m "feat(commands): add /compact handler"
```

---

### Task 10: Add /memory handler

**Files:**
- Modify: `bot.js`

- [ ] **Step 1: Add required imports at top of bot.js**

Find (line 22):
```js
const { mkdirSync, writeFileSync } = require("fs");
```

Replace with:
```js
const { mkdirSync, writeFileSync, existsSync, readFileSync } = require("fs");
```

- [ ] **Step 2: Add memory case to handleCommand() switch**

```js
    case "memory": {
      const session = getSession(channelId);
      const cwd = session.cwd;

      // Walk up from session.cwd to WORKING_DIR, collecting CLAUDE.md files.
      // If cwd is outside WORKING_DIR (e.g. /thread set an absolute path),
      // only check cwd itself — don't traverse upward into unrelated directories.
      const found = [];
      const root = resolve(WORKING_DIR);
      const startDir = resolve(cwd);
      const isUnderRoot = startDir.startsWith(root);

      let dir = startDir;
      while (true) {
        const candidate = resolve(dir, "CLAUDE.md");
        if (existsSync(candidate)) {
          const preview = readFileSync(candidate, "utf8")
            .split("\n")
            .slice(0, 3)
            .join("\n")
            .trim();
          const rel = candidate.startsWith(root)
            ? candidate.slice(root.length).replace(/\\/g, "/")
            : candidate;
          found.push({ path: rel, preview });
        }

        // Stop at WORKING_DIR boundary or filesystem root; if cwd was outside
        // WORKING_DIR, stop immediately after checking the starting directory.
        if (!isUnderRoot || dir === root || dir === resolve(dir, "..")) break;
        dir = resolve(dir, "..");
      }

      if (found.length === 0) {
        await interaction.reply("> No CLAUDE.md files found in working directory.");
        break;
      }

      const lines = found.map(
        (f) => `**${f.path}**\n> ${f.preview.replace(/\n/g, "\n> ")}`
      );
      await interaction.reply(lines.join("\n\n"));
      break;
    }
```

- [ ] **Step 3: Test via Discord**

Run `/memory` in a channel where the session's cwd contains a CLAUDE.md. Expected: shows file paths and first 3 lines.

Run `/memory` where no CLAUDE.md exists. Expected: `> No CLAUDE.md files found in working directory.`

- [ ] **Step 4: Commit**

```bash
git add bot.js
git commit -m "feat(commands): add /memory handler"
```

---

### Task 11: Add /cost handler

**Files:**
- Modify: `bot.js`

- [ ] **Step 1: Add cost case to handleCommand() switch**

```js
    case "cost": {
      const session = sessions.get(channelId);
      if (!session || session.sessionId === null) {
        await interaction.reply("> No active session. Send a message first.");
        break;
      }

      const MAX_TOKENS = 200_000;
      const total = session.inputTokens + session.outputTokens;
      const hasData = total > 0;

      let reply;
      if (hasData) {
        const bar = buildBar(total, MAX_TOKENS);
        reply = [
          "```",
          `Context   ${bar}`,
          `Tokens    ${session.inputTokens.toLocaleString()} in / ${session.outputTokens.toLocaleString()} out`,
          `Session   ${session.sessionId}`,
          "```",
        ].join("\n");
      } else {
        reply = [
          "```",
          `Context   (context % unavailable — no usage data yet)`,
          `Session   ${session.sessionId}`,
          "```",
        ].join("\n");
      }

      await interaction.reply(reply);
      break;
    }
```

- [ ] **Step 2: Test via Discord**

Send a message to create a session with token data, then run `/cost`. Expected: code block with context bar and token counts.

Run `/cost` in a fresh channel. Expected: `> No active session. Send a message first.`

- [ ] **Step 3: Commit**

```bash
git add bot.js
git commit -m "feat(commands): add /cost handler with context bar"
```

---

### Task 12: Add /doctor handler

**Files:**
- Modify: `bot.js`

The `/doctor` handler reuses the health check functions from `scripts/health.js`.

- [ ] **Step 1: Add health.js require near the top of bot.js**

Find (line 21):
```js
const { resolve } = require("path");
```

Add after it:
```js
const health = require("./scripts/health.js");
```

- [ ] **Step 2: Add doctor case to handleCommand() switch**

```js
    case "doctor": {
      const cwd = getSession(channelId).cwd;

      // Required checks — shown as ✅ / ❌
      const required = [
        health.checkNodeVersion(),
        health.checkClaudeCLI(),
        health.checkWorkingDir(cwd),
        { ok: !!agentSDK, message: agentSDK ? "Agent SDK loaded" : "Agent SDK not loaded" },
        { ok: !!interaction.client.isReady(), message: interaction.client.isReady() ? "Discord connected" : "Discord not ready" },
      ];

      // Optional checks — shown as ✅ / ⚠️ (not a hard failure)
      const optional = [
        health.checkForumChannelId(),
      ];

      const lines = [
        ...required.map((c) => `${c.ok ? "✅" : "❌"} ${c.message}`),
        ...optional.map((c) => `${c.ok ? "✅" : "⚠️"} ${c.message}`),
      ];

      await interaction.reply(lines.join("\n"));
      break;
    }
```

- [ ] **Step 3: Test via Discord**

Run `/doctor`. Expected: green checkmarks for all required items, ⚠️ or ❌ for optional items that aren't configured.

- [ ] **Step 4: Commit**

```bash
git add bot.js
git commit -m "feat(commands): add /doctor health check handler"
```

---

### Task 13: Add /status handler

**Files:**
- Modify: `bot.js`

- [ ] **Step 1: Add status case to handleCommand() switch**

```js
    case "status": {
      const session = sessions.get(channelId);
      if (!session) {
        await interaction.reply("> No active session. Send a message first.");
        break;
      }

      const MAX_TOKENS = 200_000;
      const total = session.inputTokens + session.outputTokens;
      const contextLine = total > 0
        ? `Context   ${buildBar(total, MAX_TOKENS)}`
        : `Context   (no data yet)`;

      // MCP info via shared getMcpServers() helper
      const servers = getMcpServers(session.cwd);
      const mcpLine = servers.length > 0
        ? `MCP       ${servers.length} server(s): ${servers.join(", ")}`
        : "MCP       no servers connected";

      const reply = [
        "```",
        `Model     ${session.model || "(SDK default)"}`,
        `Session   ${session.sessionId || "none"} (${session.messageCount} messages)`,
        `CWD       ${session.cwd}`,
        contextLine,
        mcpLine,
        "```",
      ].join("\n");

      await interaction.reply(reply);
      break;
    }
```

- [ ] **Step 2: Test via Discord**

Send a message then run `/status`. Expected: code block showing model, session ID, message count, cwd, context bar, and MCP info.

- [ ] **Step 3: Commit**

```bash
git add bot.js
git commit -m "feat(commands): add /status session summary handler"
```

---

### Task 14: Add /mcp handler

**Files:**
- Modify: `bot.js`

- [ ] **Step 1: Add mcp case to handleCommand() switch**

```js
    case "mcp": {
      const session = getSession(channelId);
      const servers = getMcpServers(session.cwd);

      const reply = servers.length === 0
        ? "> No MCP servers connected."
        : `**MCP Servers (${servers.length})**\n` + servers.map((s) => `- ${s}`).join("\n");

      await interaction.reply(reply);
      break;
    }
```

- [ ] **Step 2: Test via Discord**

Run `/mcp`. Expected: list of MCP servers if any are configured, or the fallback message.

- [ ] **Step 3: Commit**

```bash
git add bot.js
git commit -m "feat(commands): add /mcp server list handler"
```

---

### Task 15: Add /tools handler

**Files:**
- Modify: `bot.js`

- [ ] **Step 1: Add tools case to handleCommand() switch**

```js
    case "tools": {
      const session = getSession(channelId);

      // Built-in tools from sendToClaud's allowedTools list
      const builtIn = ["Read", "Write", "Edit", "MultiEdit", "Bash", "Glob", "Grep", "Skill", "Agent"];

      // Note: claude mcp list returns server names, not individual tool names.
      // Listing per-server tool names requires deeper SDK introspection not
      // available in the current Agent SDK version.
      const mcpServers = getMcpServers(session.cwd);

      const lines = [
        `**Built-in (${builtIn.length})**`,
        builtIn.map((t) => `- ${t}`).join("\n"),
      ];

      if (mcpServers.length > 0) {
        lines.push(`\n**MCP Servers (${mcpServers.length})** *(tools vary per server)*`);
        lines.push(mcpServers.map((s) => `- ${s}`).join("\n"));
      }

      await interaction.reply(lines.join("\n"));
      break;
    }
```

- [ ] **Step 2: Test via Discord**

Run `/tools`. Expected: list of built-in tools (Read, Write, Edit, etc.), plus a section listing **MCP server names** (not per-server tool names) if any are configured. The "MCP Tools" section header reads "*(tools vary per server)*" to make this distinction clear.

- [ ] **Step 3: Commit**

```bash
git add bot.js
git commit -m "feat(commands): add /tools available tools handler"
```

---

## Chunk 3: Markdown Formatting

### Task 16: Add formatForDiscord() post-processor

**Files:**
- Modify: `bot.js`

- [ ] **Step 1: Add formatForDiscord() near the top of the Discord message chunking section**

Find:
```js
// ---------------------------------------------------------------------------
// Discord message chunking
// ---------------------------------------------------------------------------
```

Add a new section *before* it:

```js
// ---------------------------------------------------------------------------
// Discord markdown formatting
// ---------------------------------------------------------------------------

/**
 * Post-processes Claude's markdown output for Discord compatibility.
 * Discord supports: bold, italic, code fences, blockquotes, lists, strikethrough.
 * Discord does NOT support: # headings, markdown tables, horizontal rules.
 *
 * @param {string} text
 * @returns {string}
 */
function formatForDiscord(text) {
  return text
    // H2 → underline+bold (one level of visual distinction)
    .replace(/^## (.+)$/gm, "__**$1**__")
    // H1 and H3 → bold
    .replace(/^#{1,3} (.+)$/gm, "**$1**")
    // Markdown tables → fenced code block
    // A table starts with a | line followed by a |---| line
    .replace(/(\|.+\|\n\|[-| :]+\|\n(?:\|.+\|\n?)*)/g, (match) => {
      return "```\n" + match.trimEnd() + "\n```";
    })
    // Horizontal rules → stripped
    .replace(/^---+$/gm, "")
    // Clean up any triple+ blank lines left behind
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
```

- [ ] **Step 2: Verify formatForDiscord() transforms correctly**

```bash
node -e "
function formatForDiscord(text) {
  return text
    .replace(/^## (.+)$/gm, '__**\$1**__')
    .replace(/^#{1,3} (.+)/gm, '**\$1**')
    .replace(/(\|.+\|\n\|[-| :]+\|\n(?:\|.+\|\n?)*)/g, (m) => '\`\`\`\n' + m.trimEnd() + '\n\`\`\`')
    .replace(/^---+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const input = '# Title\n## Section\n### Sub\n---\n| A | B |\n|---|---|\n| 1 | 2 |\n';
console.log(formatForDiscord(input));
"
```

Expected output:
```
**Title**
__**Section**__
**Sub**

\`\`\`
| A | B |
|---|---|
| 1 | 2 |
\`\`\`
```

- [ ] **Step 3: Commit**

```bash
git add bot.js
git commit -m "feat(formatting): add formatForDiscord() markdown post-processor"
```

---

### Task 17: Add Discord system prompt constant

**Files:**
- Modify: `bot.js`

- [ ] **Step 1: Add DISCORD_SYSTEM_PROMPT constant in the Config section**

Find (after the FORUM_CHANNEL_ID line, around line 39):
```js
mkdirSync(WORKING_DIR, { recursive: true });
```

Insert before it:

```js
const DISCORD_SYSTEM_PROMPT = `You are responding inside a Discord channel. Format all responses using Discord-flavored markdown:
- Use **bold** for headers and strong emphasis — do NOT use # headings (Discord doesn't render them)
- Use \`\`\`language fenced code blocks with language tags (e.g. \`\`\`js, \`\`\`bash)
- Use > blockquote for callouts, warnings, and notes
- Use - bullet lists when enumerating items rather than prose
- Avoid HTML tags, wide markdown tables, and bare URLs without context
- Keep responses concise where possible — long replies will be split across multiple messages`;
```

- [ ] **Step 2: Inject the system prompt into sendToClaud() options**

Find in `sendToClaud()` (around line 174):
```js
  const options = {
    permissionMode: PERMISSION_MODE,
    allowedTools: [
```

Replace with:
```js
  const options = {
    permissionMode: PERMISSION_MODE,
    systemPrompt: DISCORD_SYSTEM_PROMPT,
    allowedTools: [
```

- [ ] **Step 3: Commit**

```bash
git add bot.js
git commit -m "feat(formatting): inject Discord markdown system prompt into all Claude sessions"
```

---

### Task 18: Wire formatForDiscord() into the response pipeline

**Files:**
- Modify: `bot.js`

- [ ] **Step 1: Apply formatForDiscord() in sendToClaud() before returning**

Find (around line 265):
```js
  // Assemble response with tool summary footer
  let response = chunks.join("\n\n").trim();
  if (toolNames.size > 0) {
    const count = toolNames.size;
    const label = count === 1 ? "tool" : "tools";
    response += `\n\n> *Used ${count} ${label}: ${[...toolNames].join(", ")}*`;
  }

  return response || "(empty response)";
```

Replace with:
```js
  // Assemble response with tool summary footer
  let response = chunks.join("\n\n").trim();
  if (toolNames.size > 0) {
    const count = toolNames.size;
    const label = count === 1 ? "tool" : "tools";
    response += `\n\n> *Used ${count} ${label}: ${[...toolNames].join(", ")}*`;
  }

  return formatForDiscord(response) || "(empty response)";
```

- [ ] **Step 2: Test via Discord**

Send a message that causes Claude to return markdown with headers or tables (e.g., "show me a comparison table of the three Claude models"). Verify:
- `#` headers are replaced with bold text
- Tables are wrapped in code blocks
- `---` dividers are gone
- Regular bold/italic/code blocks are unaffected

- [ ] **Step 3: Commit**

```bash
git add bot.js
git commit -m "feat(formatting): apply formatForDiscord() to all Claude responses"
```

---

## Final Verification

- [ ] **Run npm run check** — all required checks green
- [ ] **Restart bot** — all 14 slash commands appear in Discord after propagation
- [ ] **Test each new command** in Discord:
  - `/compact` — works with active session, errors on no session
  - `/memory` — lists CLAUDE.md files or shows fallback
  - `/cost` — shows context bar after a message exchange
  - `/doctor` — shows health check results
  - `/status` — shows full session state
  - `/mcp` — lists servers or shows fallback
  - `/tools` — lists built-in tools
- [ ] **Test markdown formatting** — send a message asking for a table and headers; verify Discord renders them cleanly
- [ ] **Final commit**

```bash
git add -A
git status  # verify nothing unexpected is staged
git commit -m "chore: MVP public release complete"
```
