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
