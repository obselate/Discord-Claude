/**
 * Per-thread beads dashboard — each forum thread with a .beads/ project
 * gets a pinned message showing open beads grouped by status and priority.
 * A single ticker updates all tracked threads on an interval.
 */

const { exec } = require("child_process");
const { promisify } = require("util");
const { existsSync } = require("fs");
const { resolve } = require("path");

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 30_000;
const MAX_MSG_LEN = 1900;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Map<threadId, { cwd: string, messageId: string, cachedBody: string }>
 * Each entry tracks a thread's dashboard message and the project root to poll.
 */
const threadDashboards = new Map();

let intervalHandle = null;
let discordClient = null;

// ---------------------------------------------------------------------------
// Beads directory resolution
// ---------------------------------------------------------------------------

/**
 * Walk up from cwd looking for a .beads/ directory.
 * @param {string} cwd
 * @returns {string|null} the directory containing .beads/, or null
 */
function findBeadsRoot(cwd) {
  let dir = resolve(cwd);
  const root = resolve("/");
  while (true) {
    if (existsSync(resolve(dir, ".beads"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir || dir === root) return null;
    dir = parent;
  }
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

/**
 * Fetch beads from bd CLI for a specific project root, grouped by status.
 * @param {string} projectRoot
 * @returns {Promise<{ inProgress: Array, open: Array, blocked: Array } | null>}
 */
async function fetchBeads(projectRoot) {
  try {
    const opts = { cwd: projectRoot };

    const [listResult, blockedResult] = await Promise.all([
      execAsync("bd list --json --sort=priority", opts),
      execAsync("bd blocked --json", opts),
    ]);

    const allBeads = JSON.parse(listResult.stdout || "[]");
    const blockedBeads = JSON.parse(blockedResult.stdout || "[]");

    const blockedMap = new Map();
    for (const b of blockedBeads) {
      blockedMap.set(b.id, b.blocked_by || []);
    }

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
    console.error(`[Dashboard] bd command failed for ${projectRoot}:`, err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

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

function formatSection(beads) {
  return beads
    .sort((a, b) => (a.priority ?? 4) - (b.priority ?? 4))
    .map((b) => `• [P${b.priority ?? "?"}] ${b.id} — ${b.title}`);
}

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

// ---------------------------------------------------------------------------
// Per-thread dashboard management
// ---------------------------------------------------------------------------

/**
 * Register a thread for dashboard tracking. Sends and pins the initial message.
 * Called from bot.js after /thread creates a forum post.
 * @param {import("discord.js").ThreadChannel} thread
 * @param {string} cwd - the session's working directory
 * @returns {Promise<boolean>} true if dashboard was created
 */
async function registerThread(thread, cwd) {
  const beadsRoot = findBeadsRoot(cwd);
  if (!beadsRoot) return false;

  try {
    // Fetch initial data for the first render
    const groups = await fetchBeads(beadsRoot);
    const body = groups ? formatBody(groups) : "Loading beads...";
    const content = formatHeader() + body;

    const msg = await thread.send(content);
    await msg.pin().catch(() => {
      console.warn(`[Dashboard] Could not pin message in ${thread.id}`);
    });

    threadDashboards.set(thread.id, {
      cwd: beadsRoot,
      messageId: msg.id,
      cachedBody: body,
    });

    console.log(`[Dashboard] Registered thread ${thread.id} → ${beadsRoot}`);
    return true;
  } catch (err) {
    console.error(`[Dashboard] Failed to register thread ${thread.id}:`, err.message);
    return false;
  }
}

/**
 * Unregister a thread from dashboard tracking.
 * @param {string} threadId
 */
function unregisterThread(threadId) {
  if (threadDashboards.delete(threadId)) {
    console.log(`[Dashboard] Unregistered thread ${threadId}`);
  }
}

// ---------------------------------------------------------------------------
// Tick loop
// ---------------------------------------------------------------------------

/** Single poll tick: update all tracked thread dashboards. */
async function tick() {
  if (threadDashboards.size === 0) return;

  const updates = [];

  for (const [threadId, entry] of threadDashboards) {
    updates.push(
      (async () => {
        try {
          // Check if thread is still accessible / not archived
          const thread =
            discordClient.channels.cache.get(threadId) ||
            (await discordClient.channels.fetch(threadId).catch(() => null));

          if (!thread || thread.archived) {
            unregisterThread(threadId);
            return;
          }

          const groups = await fetchBeads(entry.cwd);
          if (!groups) return;

          const body = formatBody(groups);
          if (body === entry.cachedBody) return;

          entry.cachedBody = body;
          const content = formatHeader() + body;

          const msg = await thread.messages.fetch(entry.messageId).catch(() => null);
          if (msg) {
            await msg.edit(content);
          } else {
            // Message was deleted — send a new one and pin it
            const newMsg = await thread.send(content);
            await newMsg.pin().catch(() => {});
            entry.messageId = newMsg.id;
          }
        } catch (err) {
          console.error(`[Dashboard] Tick failed for thread ${threadId}:`, err.message);
        }
      })()
    );
  }

  await Promise.allSettled(updates);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the dashboard polling loop.
 * @param {import("discord.js").Client} client
 */
function startDashboard(client) {
  discordClient = client;
  intervalHandle = setInterval(tick, POLL_INTERVAL_MS);
  console.log(`[Dashboard] Polling every ${POLL_INTERVAL_MS / 1000}s for per-thread dashboards`);
}

/** Stop the polling loop. */
function stopDashboard() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("[Dashboard] Stopped.");
  }
}

module.exports = { startDashboard, stopDashboard, registerThread, unregisterThread };
