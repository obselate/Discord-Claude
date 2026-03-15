/**
 * Slash command definitions — registered with Discord on startup.
 */

const commands = [
  {
    name: "clear",
    description: "Kill current Claude session and start fresh",
  },
  {
    name: "session",
    description: "Show current session info",
  },
  {
    name: "sessions",
    description: "List all active sessions across channels",
  },
  {
    name: "resume",
    description: "Resume an existing Claude CLI session",
  },
  {
    name: "model",
    description: "Switch Claude model for this session",
    options: [
      {
        name: "name",
        description: "Model name (e.g. sonnet, opus, haiku)",
        type: 3, // STRING
        required: true,
      },
    ],
  },
  {
    name: "kill_all",
    description: "Clear all active sessions",
  },
  {
    name: "thread",
    description: "Create a new thread with a fresh Claude session",
    options: [
      {
        name: "directory",
        description: "Project directory path (created if it doesn't exist)",
        type: 3, // STRING
        required: true,
        max_length: 260,
      },
      {
        name: "topic",
        description: "Thread name/topic (defaults to 'Claude Thread – <date>')",
        type: 3, // STRING
        required: false,
        max_length: 100,
      },
      {
        name: "description",
        description: "Description shown in the forum post starter message",
        type: 3, // STRING
        required: false,
        max_length: 1000,
      },
    ],
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

module.exports = commands;
