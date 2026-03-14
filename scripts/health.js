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
