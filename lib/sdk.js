/**
 * Claude Agent SDK interaction — loads the ESM SDK dynamically and
 * provides the main sendToClaude function.
 */

const { formatForDiscord } = require("./formatting.js");

const PERMISSION_MODE = "bypassPermissions";

const DISCORD_SYSTEM_PROMPT = `You are responding inside a Discord channel. Format all responses using Discord-flavored markdown:
- Use **bold** for headers and strong emphasis — do NOT use # headings (Discord doesn't render them)
- Use \`\`\`language fenced code blocks with language tags (e.g. \`\`\`js, \`\`\`bash)
- Use > blockquote for callouts, warnings, and notes
- Use - bullet lists when enumerating items rather than prose
- Avoid HTML tags, wide markdown tables, and bare URLs without context
- Keep responses concise where possible — long replies will be split across multiple messages`;

// ---------------------------------------------------------------------------
// SDK loading
// ---------------------------------------------------------------------------

let agentSDK = null;

async function loadSDK() {
  if (!agentSDK) {
    agentSDK = await import("@anthropic-ai/claude-agent-sdk");
  }
  return agentSDK;
}

// ---------------------------------------------------------------------------
// Poll MCP state (shared with bot.js for poll tool wiring)
// ---------------------------------------------------------------------------

/** Mutable context so the MCP tool handler can access the current Discord channel */
const pollContext = { channel: null };

/** @type {{ tool: any, createServer: any }} Set by bot.js after MCP tool is created */
const mcpState = { tool: null, createServer: null };

// ---------------------------------------------------------------------------
// Send to Claude
// ---------------------------------------------------------------------------

async function sendToClaude(prompt, session, channel) {
  const { query } = await loadSDK();

  // Set poll context so the MCP tool handler can access the channel
  pollContext.channel = channel || null;

  const options = {
    permissionMode: PERMISSION_MODE,
    systemPrompt: DISCORD_SYSTEM_PROMPT,
    allowedTools: [
      "Read",
      "Write",
      "Edit",
      "MultiEdit",
      "Bash",
      "Glob",
      "Grep",
      "Skill",
      "Agent",
    ],
    cwd: session.cwd,
    settingSources: ["project", "user"],
  };

  if (session.model) {
    options.model = session.model;
  }

  if (session.sessionId) {
    options.resume = session.sessionId;
  }

  if (mcpState.tool && mcpState.createServer) {
    options.mcpServers = {
      "discord-polls": mcpState.createServer({
        name: "discord-polls",
        tools: [mcpState.tool],
      }),
    };
  }

  const chunks = [];
  const toolNames = new Set();

  console.log(`Sending to Claude | resume: ${session.sessionId || "new"}`);

  try {
    for await (const message of query({ prompt, options })) {
      switch (message.type) {
        case "system":
          if (message.subtype === "init") {
            session.sessionId = message.session_id;
            console.log(`[${session.sessionId}] Session captured`);
          }
          if (message.subtype === "status" && message.status === "compacting" && channel) {
            channel.send("🔄 *Compacting context — this may take a moment…*").catch(() => {});
            console.log(`[${session.sessionId}] Compaction started`);
          }
          if (message.subtype === "compact_boundary" && channel) {
            channel.send("✅ *Context compacted — continuing with refreshed memory.*").catch(() => {});
            console.log(`[${session.sessionId}] Compaction complete`);
          }
          break;

        case "assistant":
          for (const block of message.message.content) {
            if (block.type === "text" && block.text) {
              chunks.push(block.text);
            }
            if (block.type === "tool_use") {
              toolNames.add(block.name);
            }
          }
          break;

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
          if (message.session_id) {
            session.sessionId = message.session_id;
          }
          if (message.usage) {
            session.inputTokens += message.usage.input_tokens || 0;
            session.outputTokens += message.usage.output_tokens || 0;
          }
          break;

        default:
          break;
      }
    }
  } catch (err) {
    chunks.push(`❌ **SDK Error:** ${err.message}`);
  }

  session.messageCount++;

  let response = chunks.join("\n\n").trim();
  if (toolNames.size > 0) {
    const count = toolNames.size;
    const label = count === 1 ? "tool" : "tools";
    response += `\n\n> *Used ${count} ${label}: ${[...toolNames].join(", ")}*`;
  }

  return formatForDiscord(response) || "(empty response)";
}

module.exports = { loadSDK, sendToClaude, pollContext, mcpState };
