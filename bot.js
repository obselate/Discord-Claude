/**
 * Discord bot that wraps Claude Code via the Agent SDK.
 * No API key — falls back to your Claude subscription auth.
 * Each channel/thread gets its own persistent session with full
 * Claude Code capabilities: tools, MCP, skills, plugins, the works.
 */

require("dotenv/config");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
} = require("discord.js");
const { resolve } = require("path");
const { mkdirSync, writeFileSync } = require("fs");
const { startDashboard, stopDashboard } = require("./dashboard.js");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!DISCORD_TOKEN) {
  console.error("DISCORD_BOT_TOKEN not set. Set it in .env or environment.");
  process.exit(1);
}

const MAX_DISCORD_LEN = 1900;
const WORKING_DIR = resolve(process.env.CLAUDE_WORKDIR || "./claude-workdir");
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || ""; // blank = SDK default
const PERMISSION_MODE = "bypassPermissions"; // headless, no interactive prompts
const FORUM_CHANNEL_ID = process.env.FORUM_CHANNEL_ID || ""; // Forum channel for /thread posts

mkdirSync(WORKING_DIR, { recursive: true });

// Polls block until a human clicks "Close Poll" — override SDK's 60s timeout
process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = "2764800000"; // 768 hours in ms

// Agent SDK is ESM-only, so we load it dynamically
let agentSDK = null;
let pollServer = null; // In-process MCP server for Discord tools

async function loadSDK() {
  if (!agentSDK) {
    agentSDK = await import("@anthropic-ai/claude-agent-sdk");
  }
  return agentSDK;
}

// ---------------------------------------------------------------------------
// Session tracking
// ---------------------------------------------------------------------------

/** @type {Map<string, { sessionId: string|null, model: string, messageCount: number, cwd: string }>} */
const sessions = new Map();

/** @type {Set<string>} Track thread IDs created by the bot so we respond without @mention */
const botThreads = new Set();

function getSession(channelId) {
  if (!sessions.has(channelId)) {
    sessions.set(channelId, {
      sessionId: null,
      model: DEFAULT_MODEL,
      messageCount: 0,
      cwd: WORKING_DIR,
    });
  }
  return sessions.get(channelId);
}

// ---------------------------------------------------------------------------
// Poll state
// ---------------------------------------------------------------------------

/** Mutable context so the MCP tool handler can access the current Discord channel */
const pollContext = { channel: null };

/** @type {Map<string, { resolve: Function, timeout: NodeJS.Timeout, closed: boolean }>} */
const pendingPolls = new Map();

/**
 * Resolves a pending poll by collecting results and cleaning up.
 * Idempotent — returns false if already closed.
 * @param {string} messageId - The poll message ID
 * @param {import("discord.js").Message} pollMessage - The poll message object
 * @returns {Promise<boolean>} true if resolved, false if already closed
 */
async function resolvePoll(messageId, pollMessage) {
  const entry = pendingPolls.get(messageId);
  if (!entry || entry.closed) return false;

  entry.closed = true;
  clearTimeout(entry.timeout);

  // End the poll (may already be expired)
  try {
    await pollMessage.poll.end();
  } catch {
    // PollAlreadyExpired — that's fine
  }

  // Re-fetch to get finalized vote counts
  let updatedMessage;
  try {
    updatedMessage = await pollMessage.channel.messages.fetch(messageId);
  } catch {
    entry.resolve("Poll closed but failed to fetch results.");
    pendingPolls.delete(messageId);
    return true;
  }

  // Remove the "Close Poll" button
  try {
    await updatedMessage.edit({ components: [] });
  } catch {
    // Non-critical — button removal failed
  }

  // Build result string
  const poll = updatedMessage.poll;
  const answers = poll.answers;
  let totalVotes = 0;
  const lines = [];

  for (const [, answer] of answers) {
    totalVotes += answer.voteCount;
    lines.push({ text: answer.text, votes: answer.voteCount });
  }

  if (totalVotes === 0) {
    entry.resolve("Poll closed with no votes.");
    pendingPolls.delete(messageId);
    return true;
  }

  // Find winner(s)
  const maxVotes = Math.max(...lines.map((l) => l.votes));

  let result = `Poll results for "${poll.question.text}":\n`;
  for (const line of lines) {
    const marker = line.votes === maxVotes ? " (winner)" : "";
    result += `- ${line.text}: ${line.votes} votes${marker}\n`;
  }
  const winners = lines.filter((l) => l.votes === maxVotes);
  if (winners.length === 1) {
    result += `Winner: ${winners[0].text} (${winners[0].votes} of ${totalVotes} votes)`;
  } else {
    result += `Tie between: ${winners.map((w) => w.text).join(", ")} (${maxVotes} votes each)`;
  }

  entry.resolve(result);
  pendingPolls.delete(messageId);
  return true;
}

// ---------------------------------------------------------------------------
// Claude Agent SDK interaction
// ---------------------------------------------------------------------------

async function sendToClaud(prompt, session, channel) {
  const { query } = await loadSDK();

  // Set poll context so the MCP tool handler can access the channel
  pollContext.channel = channel || null;

  const options = {
    permissionMode: PERMISSION_MODE,
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

  if (pollServer) {
    options.mcpServers = { "discord-polls": pollServer };
  }

  const chunks = [];
  const toolUseLog = [];

  console.log(`Sending to Claude | resume: ${session.sessionId || "new"}`);

  try {
    for await (const message of query({ prompt, options })) {
      switch (message.type) {
        case "system":
          if (message.subtype === "init") {
            session.sessionId = message.session_id;
            console.log(`[${session.sessionId}] Session captured`);
          }
          // Notify Discord channel about context compaction
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
              toolUseLog.push(`🔧 *${block.name}*`);
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
          // Capture session ID from result too
          if (message.session_id) {
            session.sessionId = message.session_id;
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

  // Combine tool use indicators with response
  let response = "";
  if (toolUseLog.length > 0) {
    response += toolUseLog.join(" → ") + "\n\n";
  }
  response += chunks.join("\n\n").trim();

  return response || "(empty response)";
}

// ---------------------------------------------------------------------------
// Discord message chunking
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
// File attachment handling
// ---------------------------------------------------------------------------

async function saveAttachments(attachments, targetDir) {
  const saved = [];
  for (const [, att] of attachments) {
    const dest = resolve(targetDir, att.name);
    const res = await fetch(att.url);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    saved.push(dest);
    console.log(`Saved attachment: ${dest}`);
  }
  return saved;
}

// ---------------------------------------------------------------------------
// Slash commands definition
// ---------------------------------------------------------------------------

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
];

// ---------------------------------------------------------------------------
// Slash command handlers
// ---------------------------------------------------------------------------

async function handleCommand(interaction) {
  const { commandName, channelId } = interaction;

  switch (commandName) {
    case "clear": {
      sessions.delete(channelId);
      await interaction.reply("Session cleared. Next message starts fresh.");
      break;
    }

    case "session": {
      const session = sessions.get(channelId);
      if (session) {
        await interaction.reply(
          `**Session ID:** \`${session.sessionId || "None (new session)"}\`\n` +
            `**Model:** \`${session.model || "(SDK default)"}\`\n` +
            `**Messages:** ${session.messageCount}`
        );
      } else {
        await interaction.reply(
          "No active session. Send a message to start one."
        );
      }
      break;
    }

    case "sessions": {
      if (sessions.size === 0) {
        await interaction.reply("No active sessions.");
        break;
      }

      const lines = [];
      for (const [cid, s] of sessions) {
        const channel = interaction.client.channels.cache.get(cid);
        const name = channel?.name || cid;
        lines.push(
          `• **#${name}** — ${s.messageCount} msgs, session: \`${
            s.sessionId || "pending"
          }\``
        );
      }
      await interaction.reply(lines.join("\n"));
      break;
    }

    case "resume": {
      await interaction.deferReply();

      try {
        const { listSessions } = await loadSDK();
        const sessionList = await listSessions({ dir: WORKING_DIR, limit: 25 });

        if (!sessionList || sessionList.length === 0) {
          await interaction.editReply("No existing sessions found.");
          break;
        }

        const options = sessionList.slice(0, 25).map((s) => {
          const sid = s.sessionId || s.id || "unknown";
          const label = (s.name || s.lastMessage || sid).slice(0, 100);
          return {
            label,
            value: sid,
            description: sid.slice(0, 100),
          };
        });

        const select = new StringSelectMenuBuilder()
          .setCustomId("resume_session")
          .setPlaceholder("Pick a session to resume...")
          .addOptions(options);

        const row = new ActionRowBuilder().addComponents(select);

        const reply = await interaction.editReply({
          content: "Select a session to resume:",
          components: [row],
        });

        // Wait for selection
        try {
          const selectInteraction = await reply.awaitMessageComponent({
            time: 60_000,
          });

          const chosenId = selectInteraction.values[0];
          const session = getSession(channelId);
          session.sessionId = chosenId;
          session.messageCount = 0;

          await selectInteraction.update({
            content: `Resumed session \`${chosenId}\`. Next message continues that conversation.`,
            components: [],
          });
        } catch {
          await interaction.editReply({
            content: "Selection timed out.",
            components: [],
          });
        }
      } catch (err) {
        await interaction.editReply(
          `Failed to list sessions: \`${err.message}\``
        );
      }
      break;
    }

    case "model": {
      const name = interaction.options.getString("name");
      const session = getSession(channelId);
      session.model = name.trim();
      await interaction.reply(
        `Model set to **${session.model || "(SDK default)"}** for this session.`
      );
      break;
    }

    case "kill_all": {
      const count = sessions.size;
      sessions.clear();
      await interaction.reply(`Cleared ${count} session(s).`);
      break;
    }

    case "thread": {
      const directory = interaction.options.getString("directory");
      const topic = interaction.options.getString("topic");
      const description = interaction.options.getString("description");
      const now = new Date();
      const dateStr = now.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const threadName = topic || `Claude Thread – ${dateStr}`;

      // Resolve directory: absolute paths used directly, relative resolved against WORKING_DIR
      const resolvedPath = resolve(WORKING_DIR, directory);

      // Ensure the directory exists (no-op if it already does)
      try {
        mkdirSync(resolvedPath, { recursive: true });
      } catch (dirErr) {
        await interaction.reply({
          content: `❌ Failed to create directory \`${resolvedPath}\`: ${dirErr.message}`,
          ephemeral: true,
        });
        break;
      }

      try {
        // Use the configured forum channel, or fall back to current channel
        let targetChannel;
        if (FORUM_CHANNEL_ID) {
          targetChannel =
            interaction.client.channels.cache.get(FORUM_CHANNEL_ID) ||
            (await interaction.client.channels.fetch(FORUM_CHANNEL_ID));
        } else {
          targetChannel = interaction.channel;
        }

        // Build the starter message
        let starterMessage = `📁 **Project:** \`${resolvedPath}\``;
        if (description) {
          starterMessage += `\n📝 ${description}`;
        }
        starterMessage += `\n\nSend a message to start chatting with Claude!`;

        let thread;
        console.log(`[/thread] Target channel: ${targetChannel.id}, type: ${targetChannel.type}, expected GuildForum: ${ChannelType.GuildForum}`);
        const isForum = targetChannel.type === ChannelType.GuildForum;

        if (isForum) {
          // Create a forum post (requires a starter message)
          thread = await targetChannel.threads.create({
            name: threadName,
            message: { content: starterMessage },
            reason: `Claude forum post created by ${interaction.user.tag}`,
          });
        } else {
          // Fall back to regular thread in current channel
          if (interaction.channel.isThread()) {
            await interaction.reply({
              content:
                "❌ Cannot create a thread inside a thread. Set FORUM_CHANNEL_ID to use a forum channel.",
              ephemeral: true,
            });
            break;
          }
          thread = await targetChannel.threads.create({
            name: threadName,
            type: ChannelType.PublicThread,
            reason: `Claude thread created by ${interaction.user.tag}`,
          });
          await thread.send(starterMessage);
        }

        // Track this thread so MessageCreate responds without @mention
        botThreads.add(thread.id);

        // Initialize a fresh session for the thread with the project directory
        const session = getSession(thread.id);
        session.cwd = resolvedPath;

        // Confirm to the user (ephemeral so it doesn't clutter the channel)
        await interaction.reply({
          content: `Created ${isForum ? "forum post" : "thread"} **${threadName}** → \`${resolvedPath}\`. Head over to ${thread} to start chatting!`,
          ephemeral: true,
        });
      } catch (err) {
        console.error("Thread creation error:", err);
        await interaction.reply({
          content: `❌ Failed to create thread: ${err.message}`,
          ephemeral: true,
        });
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Bot setup
// ---------------------------------------------------------------------------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessagePolls,
  ],
});

// ---------------------------------------------------------------------------
// Register slash commands on ready
// ---------------------------------------------------------------------------

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);

  // Pre-load the Agent SDK
  await loadSDK();
  console.log("Claude Agent SDK loaded.");

  // Create in-process MCP server for Discord tools
  const { z } = await import("zod");
  const { createSdkMcpServer, tool } = agentSDK;

  const createPollTool = tool(
    "CreatePoll",
    "Create a Discord poll to ask channel members a question with multiple choice options. Use this when you want to present users with choices and let them vote. The poll will be posted in the current Discord channel. Results are returned automatically when the poll is closed.",
    {
      question: z.string().max(300).describe("The poll question to ask"),
      options: z.array(z.string().max(55)).min(2).max(10).describe("Answer choices (2-10 options, max 55 chars each)"),
      duration: z.number().min(1).max(768).optional().default(1).describe("Poll duration in hours (default: 1)"),
    },
    async (args) => {
      const channel = pollContext.channel;
      if (!channel) {
        return { content: [{ type: "text", text: "Error: No Discord channel available to post poll." }] };
      }

      try {
        // Post the poll with a "Close Poll" button
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("close_poll_pending") // Updated after message is sent
            .setLabel("Close Poll")
            .setStyle(ButtonStyle.Secondary)
        );

        const pollMessage = await channel.send({
          poll: {
            question: { text: args.question },
            answers: args.options.map((opt) => ({ text: opt })),
            duration: args.duration,
            allowMultiselect: false,
          },
          components: [row],
        });

        // Update button custom ID to include the real message ID
        const updatedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`close_poll_${pollMessage.id}`)
            .setLabel("Close Poll")
            .setStyle(ButtonStyle.Secondary)
        );
        await pollMessage.edit({ components: [updatedRow] });

        console.log(`[Poll] Created poll "${args.question}" in ${channel.id}, message ${pollMessage.id}`);

        // Block until poll is closed
        const resultText = await new Promise((resolve) => {
          const timeout = setTimeout(async () => {
            // Timeout fallback — re-fetch message and resolve
            try {
              const msg = await channel.messages.fetch(pollMessage.id);
              await resolvePoll(pollMessage.id, msg);
            } catch {
              const entry = pendingPolls.get(pollMessage.id);
              if (entry && !entry.closed) {
                entry.closed = true;
                resolve("Poll timed out and results could not be fetched.");
                pendingPolls.delete(pollMessage.id);
              }
            }
          }, args.duration * 60 * 60 * 1000);

          pendingPolls.set(pollMessage.id, { resolve, timeout, closed: false });
        });

        return { content: [{ type: "text", text: resultText }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error creating poll: ${err.message}` }] };
      }
    }
  );

  pollServer = createSdkMcpServer({
    name: "discord-polls",
    tools: [createPollTool],
  });
  console.log("Discord polls MCP server created.");

  const rest = new REST().setToken(DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
    console.log("Slash commands registered globally.");
  } catch (err) {
    console.error("Failed to register slash commands:", err);
  }

  // Start beads dashboard polling
  startDashboard(c).catch((err) =>
    console.error("[Dashboard] Startup failed:", err)
  );
});

// ---------------------------------------------------------------------------
// Handle slash commands
// ---------------------------------------------------------------------------

client.on(Events.InteractionCreate, async (interaction) => {
  // Handle "Close Poll" button clicks
  if (interaction.isButton() && interaction.customId.startsWith("close_poll_")) {
    const messageId = interaction.customId.replace("close_poll_", "");
    const entry = pendingPolls.get(messageId);

    if (!entry || entry.closed) {
      await interaction.reply({ content: "Poll already closed.", ephemeral: true });
      return;
    }

    await interaction.deferUpdate();

    try {
      const pollMessage = await interaction.channel.messages.fetch(messageId);
      await resolvePoll(messageId, pollMessage);
    } catch (err) {
      console.error("[Poll] Error closing poll:", err);
      if (entry && !entry.closed) {
        entry.closed = true;
        clearTimeout(entry.timeout);
        entry.resolve("Poll closed but failed to fetch results.");
        pendingPolls.delete(messageId);
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  try {
    await handleCommand(interaction);
  } catch (err) {
    console.error("Command error:", err);
    const reply = interaction.deferred
      ? interaction.editReply
      : interaction.reply;
    await reply.call(interaction, `Error: ${err.message}`);
  }
});

// ---------------------------------------------------------------------------
// Handle messages
// ---------------------------------------------------------------------------

client.on(Events.MessageCreate, async (message) => {
  // Ignore bots
  if (message.author.bot) return;

  // Respond to @mentions, DMs, or replies to the bot's messages
  const isDM = !message.guild;
  const isMentioned = message.mentions.has(client.user);
  const isBotThread = botThreads.has(message.channelId);
  const isReplyToBot =
    message.reference &&
    (
      await message.channel.messages
        .fetch(message.reference.messageId)
        .catch(() => null)
    )?.author?.id === client.user.id;

  if (!isDM && !isMentioned && !isBotThread && !isReplyToBot) return;

  // Strip bot mention from prompt
  let prompt = message.content
    .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
    .trim();

  const session = getSession(message.channelId);

  // Handle attachments
  if (message.attachments.size > 0) {
    const saved = await saveAttachments(message.attachments, session.cwd);
    const refs = saved.map((p) => `[Attached: ${p}]`).join("\n");
    prompt = prompt ? `${prompt}\n\n${refs}` : refs;
  }

  if (!prompt) return;

  // Show typing while Claude works
  await message.channel.sendTyping();
  const typingInterval = setInterval(() => {
    message.channel.sendTyping().catch(() => {});
  }, 8_000);

  try {
    const response = await sendToClaud(prompt, session, message.channel);

    clearInterval(typingInterval);

    const chunks = chunkMessage(response);
    for (const chunk of chunks) {
      if (chunk.trim()) {
        await message.reply({
          content: chunk,
          allowedMentions: { repliedUser: false },
        });
      }
    }
  } catch (err) {
    clearInterval(typingInterval);
    console.error("Message handling error:", err);
    await message.reply(`Something broke:\n\`\`\`\n${err.message}\n\`\`\``);
  }
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

// Graceful shutdown — clean up dashboard interval (useful for --watch restarts)
process.on("SIGINT", () => {
  stopDashboard();
  client.destroy();
  process.exit(0);
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

client.login(DISCORD_TOKEN);
