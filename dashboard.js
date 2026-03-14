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
