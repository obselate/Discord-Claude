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
