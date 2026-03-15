/**
 * Session tracking — per-channel/thread session state.
 */

const { resolve } = require("path");

const WORKING_DIR = resolve(process.env.CLAUDE_WORKDIR || "./claude-workdir");
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {Map<string, { sessionId: string|null, model: string, messageCount: number, cwd: string, inputTokens: number, outputTokens: number }>} */
const sessions = new Map();

/** @type {Set<string>} Track thread IDs created by the bot so we respond without @mention */
const botThreads = new Set();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSession(channelId) {
  if (!sessions.has(channelId)) {
    sessions.set(channelId, {
      sessionId: null,
      model: DEFAULT_MODEL,
      messageCount: 0,
      cwd: WORKING_DIR,
      inputTokens: 0,
      outputTokens: 0,
    });
  }
  return sessions.get(channelId);
}

module.exports = { sessions, botThreads, getSession, WORKING_DIR, DEFAULT_MODEL };
