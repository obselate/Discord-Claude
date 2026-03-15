/**
 * Discord markdown formatting, message chunking, and visual helpers.
 */

const MAX_DISCORD_LEN = 1900;

// ---------------------------------------------------------------------------
// Markdown formatting
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
    .replace(/(\|.+\|\n\|[-| :]+\|\n(?:\|.+\|\n?)*)/g, (match) => {
      return "```\n" + match.trimEnd() + "\n```";
    })
    // Horizontal rules → stripped
    .replace(/^---+$/gm, "")
    // Clean up any triple+ blank lines left behind
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Message chunking
// ---------------------------------------------------------------------------

function chunkMessage(text) {
  if (text.length <= MAX_DISCORD_LEN) return [text];

  const result = [];
  while (text.length > 0) {
    if (text.length <= MAX_DISCORD_LEN) {
      result.push(text);
      break;
    }

    let splitAt = text.lastIndexOf("\n", MAX_DISCORD_LEN);
    if (splitAt === -1 || splitAt < MAX_DISCORD_LEN / 2) {
      splitAt = text.lastIndexOf(" ", MAX_DISCORD_LEN);
    }
    if (splitAt === -1) splitAt = MAX_DISCORD_LEN;

    result.push(text.slice(0, splitAt));
    text = text.slice(splitAt).replace(/^\n+/, "");
  }

  return result;
}

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
 * @param {string} cwd - Working directory for the claude command
 * @returns {string[]}
 */
function getMcpServers(cwd) {
  const { execSync } = require("child_process");
  try {
    const out = execSync("claude mcp list", { encoding: "utf8", timeout: 5000, cwd }).trim();
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { MAX_DISCORD_LEN, formatForDiscord, chunkMessage, buildBar, getMcpServers };
