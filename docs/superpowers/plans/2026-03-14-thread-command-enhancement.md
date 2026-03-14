# `/thread` Command Enhancement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the `/thread` command with `directory` and `description` parameters so each Discord thread targets a specific project directory.

**Architecture:** All changes in `bot.js`. Add `cwd` to the session object, wire it through `sendToClaud` and `saveAttachments`, and update the `/thread` handler to accept, validate, and store the project directory.

**Tech Stack:** Node.js, discord.js v14, Claude Agent SDK

**Spec:** `docs/superpowers/specs/2026-03-14-thread-command-enhancement-design.md`

---

## Chunk 1: Core Changes

### Task 1: Add `cwd` field to session object

**Files:**
- Modify: `bot.js:54` (JSDoc type)
- Modify: `bot.js:60-69` (`getSession` function)

- [ ] **Step 1: Update JSDoc type annotation**

Change line 54 from:
```js
/** @type {Map<string, { sessionId: string|null, model: string, messageCount: number }>} */
```
to:
```js
/** @type {Map<string, { sessionId: string|null, model: string, messageCount: number, cwd: string }>} */
```

- [ ] **Step 2: Add `cwd` to `getSession` initializer**

Change lines 62-66 from:
```js
    sessions.set(channelId, {
      sessionId: null,
      model: DEFAULT_MODEL,
      messageCount: 0,
    });
```
to:
```js
    sessions.set(channelId, {
      sessionId: null,
      model: DEFAULT_MODEL,
      messageCount: 0,
      cwd: WORKING_DIR,
    });
```

- [ ] **Step 3: Commit**

```bash
git add bot.js
git commit -m "feat(thread): add cwd field to session object"
```

---

### Task 2: Wire `session.cwd` through `sendToClaud`

**Files:**
- Modify: `bot.js:91` (`sendToClaud` options)

- [ ] **Step 1: Use `session.cwd` instead of global `WORKING_DIR`**

Change line 91 from:
```js
    cwd: WORKING_DIR,
```
to:
```js
    cwd: session.cwd,
```

- [ ] **Step 2: Commit**

```bash
git add bot.js
git commit -m "feat(thread): use session.cwd in sendToClaud"
```

---

### Task 3: Update `saveAttachments` to accept target directory

**Files:**
- Modify: `bot.js:196-207` (`saveAttachments` function)
- Modify: `bot.js:546` (caller in `messageCreate` handler)

- [ ] **Step 1: Add `targetDir` parameter to `saveAttachments`**

Change line 196 from:
```js
async function saveAttachments(attachments) {
```
to:
```js
async function saveAttachments(attachments, targetDir) {
```

- [ ] **Step 2: Use `targetDir` instead of `WORKING_DIR`**

Change line 199 from:
```js
    const dest = resolve(WORKING_DIR, att.name);
```
to:
```js
    const dest = resolve(targetDir, att.name);
```

- [ ] **Step 3: Update the caller in `messageCreate` to pass `session.cwd`**

The caller at line 546 currently reads:
```js
    const saved = await saveAttachments(message.attachments);
```

The session is retrieved at line 553 (`const session = getSession(message.channelId)`), which is AFTER this call. Move the session retrieval up and pass `session.cwd`:

Change lines 544-553 from:
```js
  // Handle attachments
  if (message.attachments.size > 0) {
    const saved = await saveAttachments(message.attachments);
    const refs = saved.map((p) => `[Attached: ${p}]`).join("\n");
    prompt = prompt ? `${prompt}\n\n${refs}` : refs;
  }

  if (!prompt) return;

  const session = getSession(message.channelId);
```
to:
```js
  const session = getSession(message.channelId);

  // Handle attachments
  if (message.attachments.size > 0) {
    const saved = await saveAttachments(message.attachments, session.cwd);
    const refs = saved.map((p) => `[Attached: ${p}]`).join("\n");
    prompt = prompt ? `${prompt}\n\n${refs}` : refs;
  }

  if (!prompt) return;
```

- [ ] **Step 4: Commit**

```bash
git add bot.js
git commit -m "feat(thread): pass session.cwd to saveAttachments"
```

---

### Task 4: Update `/thread` command definition

**Files:**
- Modify: `bot.js:246-258` (command definition)

- [ ] **Step 1: Replace the `/thread` command definition**

Change lines 246-258 from:
```js
  {
    name: "thread",
    description: "Create a new thread with a fresh Claude session",
    options: [
      {
        name: "topic",
        description: "Thread name/topic (defaults to 'Claude Thread – <date>')",
        type: 3, // STRING
        required: false,
        max_length: 100,
      },
    ],
  },
```
to:
```js
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
```

- [ ] **Step 2: Commit**

```bash
git add bot.js
git commit -m "feat(thread): add directory and description options to command definition"
```

---

### Task 5: Update `/thread` handler

**Files:**
- Modify: `bot.js:391-463` (`case "thread"` handler)

- [ ] **Step 1: Replace the entire `/thread` handler**

Change lines 391-463 from:
```js
    case "thread": {
      const topic = interaction.options.getString("topic");
      const now = new Date();
      const dateStr = now.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const threadName = topic || `Claude Thread – ${dateStr}`;

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

        let thread;
        console.log(`[/thread] Target channel: ${targetChannel.id}, type: ${targetChannel.type}, expected GuildForum: ${ChannelType.GuildForum}`);
        const isForum = targetChannel.type === ChannelType.GuildForum;

        if (isForum) {
          // Create a forum post (requires a starter message)
          thread = await targetChannel.threads.create({
            name: threadName,
            message: {
              content: `🧵 Forum post created by ${interaction.user}. Send a message to start chatting with Claude!`,
            },
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
          await thread.send(
            `🧵 Thread ready! Send me a message to get started.`
          );
        }

        // Track this thread so MessageCreate responds without @mention
        botThreads.add(thread.id);

        // Initialize a fresh session for the thread
        getSession(thread.id);

        // Confirm to the user (ephemeral so it doesn't clutter the channel)
        await interaction.reply({
          content: `Created ${isForum ? "forum post" : "thread"} **${threadName}**. Head over to ${thread} to start chatting!`,
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
```
to:
```js
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
```

- [ ] **Step 2: Commit**

```bash
git add bot.js
git commit -m "feat(thread): add directory and description support to /thread handler"
```

---

### Task 6: Manual verification

- [ ] **Step 1: Restart the bot**

```bash
node bot.js
```

Expected console output: `Logged in as ...`, `Claude Agent SDK loaded.`, `Slash commands registered globally.`

- [ ] **Step 2: Verify `/thread` appears in Discord**

Type `/thread` in Discord. It may take up to an hour for global command updates to propagate. If it doesn't appear, check bot console for registration errors.

- [ ] **Step 3: Test with an existing directory**

Run: `/thread directory:C:\Users\zack7\Projects\Discord-Claude topic:Test Thread description:Testing the new thread command`

Expected: Forum post created with starter message showing the project path and description.

- [ ] **Step 4: Test with a new directory**

Run: `/thread directory:C:\Users\zack7\Projects\test-new-project topic:New Project`

Expected: Directory created, forum post created. Verify `C:\Users\zack7\Projects\test-new-project` exists on disk.

- [ ] **Step 5: Test with a relative directory path**

Run: `/thread directory:my-relative-project topic:Relative Test`

Expected: Directory created at `<WORKING_DIR>/my-relative-project` (i.e. `claude-workdir/my-relative-project`). Forum post starter message shows the fully resolved absolute path.

- [ ] **Step 6: Test sending a message in the new thread**

Send a message in the created thread. Verify Claude responds and operates in the specified project directory (e.g. ask "what directory are you working in?").

- [ ] **Step 7: Test attachment saving**

Upload a file in the thread. Verify it's saved to the thread's project directory, not the global `claude-workdir`.
