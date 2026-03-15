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
  ChannelType,
} = require("discord.js");
const { mkdirSync } = require("fs");

// Lib modules
const { sessions, botThreads, getSession, WORKING_DIR } = require("./lib/sessions.js");
const commands = require("./lib/commands.js");
const { handleCommand } = require("./lib/handlers.js");
const { loadSDK, sendToClaude, pollContext, mcpState } = require("./lib/sdk.js");
const { chunkMessage } = require("./lib/formatting.js");
const { saveAttachments } = require("./lib/attachments.js");
const { startDashboard, stopDashboard } = require("./dashboard.js");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!DISCORD_TOKEN) {
  console.error("DISCORD_BOT_TOKEN not set. Set it in .env or environment.");
  process.exit(1);
}

const FORUM_CHANNEL_ID = process.env.FORUM_CHANNEL_ID || "";

mkdirSync(WORKING_DIR, { recursive: true });

// Polls block until a human clicks "Close Poll" — override SDK's 60s timeout
process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = "2764800000"; // 768 hours in ms

// ---------------------------------------------------------------------------
// Poll state
// ---------------------------------------------------------------------------

/** @type {Map<string, { resolve: Function, timeout: NodeJS.Timeout, closed: boolean }>} */
const pendingPolls = new Map();

/**
 * Resolves a pending poll by collecting results and cleaning up.
 * Idempotent — returns false if already closed.
 */
async function resolvePoll(messageId, pollMessage) {
  const entry = pendingPolls.get(messageId);
  if (!entry || entry.closed) return false;

  entry.closed = true;
  clearTimeout(entry.timeout);

  try {
    await pollMessage.poll.end();
  } catch {
    // PollAlreadyExpired — that's fine
  }

  let updatedMessage;
  try {
    updatedMessage = await pollMessage.channel.messages.fetch(messageId);
  } catch {
    entry.resolve("Poll closed but failed to fetch results.");
    pendingPolls.delete(messageId);
    return true;
  }

  try {
    await updatedMessage.edit({ components: [] });
  } catch {
    // Non-critical — button removal failed
  }

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
// Ready — load SDK, register MCP tools, register slash commands
// ---------------------------------------------------------------------------

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);

  // Pre-load the Agent SDK
  await loadSDK();
  console.log("Claude Agent SDK loaded.");

  // Create in-process MCP server for Discord tools
  const { z } = await import("zod");
  const sdk = await loadSDK();
  const { createSdkMcpServer, tool } = sdk;

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
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("close_poll_pending")
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

        const updatedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`close_poll_${pollMessage.id}`)
            .setLabel("Close Poll")
            .setStyle(ButtonStyle.Secondary)
        );
        await pollMessage.edit({ components: [updatedRow] });

        console.log(`[Poll] Created poll "${args.question}" in ${channel.id}, message ${pollMessage.id}`);

        const resultText = await new Promise((resolve) => {
          const timeout = setTimeout(async () => {
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

  // Wire MCP state so sdk.js can attach it to queries
  mcpState.tool = createPollTool;
  mcpState.createServer = createSdkMcpServer;
  console.log("Discord polls MCP tool registered.");

  // Register slash commands
  const rest = new REST().setToken(DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
    console.log("Slash commands registered globally.");
  } catch (err) {
    console.error("Failed to register slash commands:", err);
  }

  // Start beads dashboard polling (per-thread, no initial fetch needed)
  startDashboard(c);
});

// ---------------------------------------------------------------------------
// Handle interactions (slash commands + button clicks)
// ---------------------------------------------------------------------------

client.on(Events.InteractionCreate, async (interaction) => {
  // Handle "Close Poll" button clicks
  if (interaction.isButton() && interaction.customId.startsWith("close_poll_")) {
    const messageId = interaction.customId.replace("close_poll_", "");
    const entry = pendingPolls.get(messageId);

    if (!entry || entry.closed) {
      await interaction.reply({ content: "Poll already closed.", ephemeral: true }).catch(() => {});
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
    try {
      const reply = interaction.deferred
        ? interaction.editReply
        : interaction.reply;
      await reply.call(interaction, `Error: ${err.message}`);
    } catch (replyErr) {
      console.error("Failed to send error reply:", replyErr.message);
    }
  }
});

// ---------------------------------------------------------------------------
// Handle messages
// ---------------------------------------------------------------------------

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const isDM = !message.guild;
  const isMentioned = message.mentions.has(client.user);
  const isBotThread = botThreads.has(message.channelId);
  const isForumThread =
    message.channel.isThread() &&
    message.channel.parent?.type === ChannelType.GuildForum &&
    (!FORUM_CHANNEL_ID || message.channel.parentId === FORUM_CHANNEL_ID);
  const isReplyToBot =
    message.reference &&
    (
      await message.channel.messages
        .fetch(message.reference.messageId)
        .catch(() => null)
    )?.author?.id === client.user.id;

  if (!isDM && !isMentioned && !isBotThread && !isForumThread && !isReplyToBot) return;

  let prompt = message.content
    .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
    .trim();

  const session = getSession(message.channelId);

  // Handle attachments
  if (message.attachments.size > 0) {
    const saved = await saveAttachments(message.attachments, session.cwd);
    const refs = saved
      .map((att) =>
        att.isImage
          ? `[Attached image: ${att.path}] — Use the Read tool to view this image.`
          : `[Attached: ${att.path}]`
      )
      .join("\n");
    prompt = prompt ? `${prompt}\n\n${refs}` : refs;
  }

  if (!prompt) return;

  // Show typing while Claude works
  await message.channel.sendTyping();
  const typingInterval = setInterval(() => {
    message.channel.sendTyping().catch(() => {});
  }, 8_000);

  try {
    const response = await sendToClaude(prompt, session, message.channel);

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

process.on("SIGINT", () => {
  stopDashboard();
  client.destroy();
  process.exit(0);
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

client.on(Events.Error, (err) => {
  console.error("[Discord] Client error:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("[Process] Unhandled rejection:", err);
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

client.login(DISCORD_TOKEN);
