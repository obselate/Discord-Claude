/**
 * Slash command handlers — the big switch statement, extracted from bot.js.
 */

const { mkdirSync } = require("fs");
const { resolve } = require("path");
const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelType,
} = require("discord.js");

const { sessions, botThreads, getSession, WORKING_DIR } = require("./sessions.js");
const { loadSDK } = require("./sdk.js");
const { chunkMessage, buildBar, getMcpServers } = require("./formatting.js");
const { registerThread, unregisterThread } = require("../dashboard.js");

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const FORUM_CHANNEL_ID = process.env.FORUM_CHANNEL_ID || "";

async function handleCommand(interaction) {
  const { commandName, channelId } = interaction;

  switch (commandName) {
    case "clear": {
      sessions.delete(channelId);
      unregisterThread(channelId);
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

      const resolvedPath = resolve(WORKING_DIR, directory);

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
        let targetChannel;
        if (FORUM_CHANNEL_ID) {
          targetChannel =
            interaction.client.channels.cache.get(FORUM_CHANNEL_ID) ||
            (await interaction.client.channels.fetch(FORUM_CHANNEL_ID));
        } else {
          targetChannel = interaction.channel;
        }

        let starterMessage = `📁 **Project:** \`${resolvedPath}\``;
        if (description) {
          starterMessage += `\n📝 ${description}`;
        }
        starterMessage += `\n\nSend a message to start chatting with Claude!`;

        let thread;
        console.log(`[/thread] Target channel: ${targetChannel.id}, type: ${targetChannel.type}, expected GuildForum: ${ChannelType.GuildForum}`);
        const isForum = targetChannel.type === ChannelType.GuildForum;

        if (isForum) {
          thread = await targetChannel.threads.create({
            name: threadName,
            message: { content: starterMessage },
            reason: `Claude forum post created by ${interaction.user.tag}`,
          });
        } else {
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

        botThreads.add(thread.id);

        const session = getSession(thread.id);
        session.cwd = resolvedPath;

        registerThread(thread, resolvedPath).catch((err) =>
          console.error("[/thread] Dashboard registration failed:", err.message)
        );

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

    case "compact": {
      const session = getSession(channelId);
      session.sessionId = null;
      await interaction.reply(
        "🗜️ Session compacted. Claude will start fresh on your next message, retaining your model and working directory settings."
      );
      break;
    }

    case "memory": {
      const { existsSync, readFileSync } = require("fs");
      const path = require("path");
      const session = getSession(channelId);

      const found = [];
      let dir = path.resolve(session.cwd);
      const root = path.resolve(WORKING_DIR);
      const normalise = (p) => p.replace(/\\/g, "/");

      while (true) {
        const candidate = path.join(dir, "CLAUDE.md");
        if (existsSync(candidate)) {
          found.push(candidate);
        }
        if (normalise(dir) === normalise(root)) break;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }

      if (found.length === 0) {
        await interaction.reply(
          "📝 No CLAUDE.md memory files found in your working directory tree."
        );
        break;
      }

      let output = "📝 **Memory files found:**\n";
      for (const filePath of found) {
        const contents = readFileSync(filePath, "utf8");
        output += `\n**\`${filePath}\`**\n\`\`\`\n${contents}\n\`\`\`\n`;
      }

      const chunks = chunkMessage(output.trim());
      await interaction.reply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp(chunks[i]);
      }
      break;
    }

    case "cost": {
      const session = getSession(channelId);
      const inputTokens = typeof session.inputTokens === "number" && !isNaN(session.inputTokens) ? session.inputTokens : 0;
      const outputTokens = typeof session.outputTokens === "number" && !isNaN(session.outputTokens) ? session.outputTokens : 0;

      if (inputTokens === 0 && outputTokens === 0) {
        await interaction.reply("📊 No token usage recorded yet for this session.");
        break;
      }

      const total = inputTokens + outputTokens;
      const CONTEXT_MAX = 200_000;

      const inputBar = buildBar(inputTokens, CONTEXT_MAX);
      const outputBar = buildBar(outputTokens, CONTEXT_MAX);
      const totalBar = buildBar(total, CONTEXT_MAX);

      await interaction.reply(
        `📊 **Token Usage**\n` +
        `Input:  ${inputBar}  ${inputTokens.toLocaleString()} tokens\n` +
        `Output: ${outputBar}  ${outputTokens.toLocaleString()} tokens\n` +
        `Total:  ${totalBar}  ${total.toLocaleString()} / ${CONTEXT_MAX.toLocaleString()}`
      );
      break;
    }

    case "doctor": {
      const health = require("../scripts/health.js");

      const nodeResult   = health.checkNodeVersion();
      const tokenResult  = health.checkDiscordToken();
      const cliResult    = health.checkClaudeCLI();
      const dirResult    = health.checkWorkingDir(WORKING_DIR);
      const forumResult  = health.checkForumChannelId();

      const fmt = (result, optional = false) => {
        if (result.ok) return `✅ ${result.message}`;
        return optional ? `⚠️ ${result.message}` : `❌ ${result.message}`;
      };

      const output = [
        "🩺 **Bot Health Check**",
        fmt(nodeResult),
        fmt(tokenResult),
        fmt(cliResult),
        fmt(dirResult),
        fmt(forumResult, true),
      ].join("\n");

      await interaction.reply(output);
      break;
    }

    case "status": {
      await interaction.deferReply();

      const session = sessions.get(channelId);

      if (!session || session.sessionId === null) {
        await interaction.editReply(
          "📡 **Bot Status**\nNo active session. Send a message to start one."
        );
        break;
      }

      const mcpList = getMcpServers(session.cwd);
      const mcpDisplay = mcpList.length > 0 ? mcpList.join(", ") : "none";

      const total = (session.inputTokens || 0) + (session.outputTokens || 0);
      const CONTEXT_MAX = 200_000;
      const bar = buildBar(total, CONTEXT_MAX);

      const shortId = session.sessionId ? session.sessionId.slice(0, 8) : "none";
      const modelDisplay = session.model || "(SDK default)";

      const output =
        `📡 **Bot Status**\n\n` +
        `**Model:** ${modelDisplay}\n` +
        `**Session:** active (ID: ${shortId}...) | Messages: ${session.messageCount}\n` +
        `**Working Dir:** ${session.cwd}\n\n` +
        `**Context:**\n` +
        `${bar}  ${total.toLocaleString()} / ${CONTEXT_MAX.toLocaleString()} tokens\n\n` +
        `**MCP Servers:** ${mcpDisplay}`;

      await interaction.editReply(output);
      break;
    }

    case "mcp": {
      await interaction.deferReply();
      const session = getSession(channelId);
      const servers = getMcpServers(session.cwd);

      let output = "🔌 **MCP Servers**\n";
      if (servers.length === 0) {
        output += "No MCP servers configured. Run `claude mcp add` to configure one.";
      } else {
        output += servers.map((s) => `• ${s}`).join("\n");
      }

      await interaction.editReply(output);
      break;
    }

    case "tools": {
      await interaction.deferReply();
      const session = getSession(channelId);
      const mcpServers = getMcpServers(session.cwd);

      let output =
        "🛠️ **Available Tools**\n\n" +
        "**Built-in:**\n" +
        "• Read, Write, Edit, Bash, Glob, Grep\n" +
        "• WebSearch, WebFetch\n" +
        "• TodoWrite, NotebookEdit\n\n";

      if (mcpServers.length === 0) {
        output += "**MCP Servers:** none configured";
      } else {
        output += "**MCP Servers:**\n" + mcpServers.map((s) => `• ${s}`).join("\n");
      }

      await interaction.editReply(output);
      break;
    }
  }
}

module.exports = { handleCommand };
