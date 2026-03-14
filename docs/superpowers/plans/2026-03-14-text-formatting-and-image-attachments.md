# Text Formatting & Image Attachments Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up bot response formatting (text chunk separators + tool summary) and make image attachments reliably analyzed by Claude.

**Architecture:** Two changes to `bot.js` — modify the response assembly in `sendToClaud()` and the attachment handling in the `MessageCreate` handler. No new files, no new dependencies.

**Tech Stack:** Node.js, discord.js, Claude Agent SDK

---

## Chunk 1: Text Formatting & Image Attachments

### Task 1: Fix text chunk concatenation (dcbot-2vh)

**Files:**
- Modify: `bot.js:269` — change `chunks.join("")` to `chunks.join("\n\n")`

- [ ] **Step 1: Fix the join separator**

In `sendToClaud()`, change the text assembly line from:

```js
response += chunks.join("").trim();
```

to:

```js
response += chunks.join("\n\n").trim();
```

This ensures separate SDK text blocks get paragraph breaks instead of being concatenated directly.

- [ ] **Step 2: Commit**

```bash
git add bot.js
git commit -m "fix(ux): add newline separators between text chunks in bot responses"
```

### Task 2: Replace tool emoji chain with summary line (dcbot-2vh)

**Files:**
- Modify: `bot.js:203-204` — change `toolUseLog` from array of emoji strings to a `Set` of tool names
- Modify: `bot.js:232-234` — collect tool names into the Set instead of formatted strings
- Modify: `bot.js:264-268` — replace emoji chain assembly with summary footer

- [ ] **Step 1: Change toolUseLog to a Set**

Replace:

```js
const toolUseLog = [];
```

with:

```js
const toolNames = new Set();
```

- [ ] **Step 2: Collect tool names into the Set**

Replace:

```js
            if (block.type === "tool_use") {
              toolUseLog.push(`🔧 *${block.name}*`);
            }
```

with:

```js
            if (block.type === "tool_use") {
              toolNames.add(block.name);
            }
```

- [ ] **Step 3: Replace response assembly with summary footer**

Replace:

```js
  // Combine tool use indicators with response
  let response = "";
  if (toolUseLog.length > 0) {
    response += toolUseLog.join(" → ") + "\n\n";
  }
  response += chunks.join("\n\n").trim();
```

with:

```js
  // Assemble response with tool summary footer
  let response = chunks.join("\n\n").trim();
  if (toolNames.size > 0) {
    const count = toolNames.size;
    const label = count === 1 ? "tool" : "tools";
    response += `\n\n> *Used ${count} ${label}: ${[...toolNames].join(", ")}*`;
  }
```

- [ ] **Step 4: Test manually on Discord**

Send a message that triggers tool use (e.g., "read bot.js and tell me what it does"). Verify:
- Text blocks have paragraph breaks between them
- Tool use appears as a single italic summary line at the bottom: `> *Used 3 tools: Read, Grep, Glob*`
- No emoji chain at the top

- [ ] **Step 5: Commit**

```bash
git add bot.js
git commit -m "feat(ux): replace tool emoji chain with clean summary footer"
```

### Task 3: Image attachment detection and prompt hints (dcbot-nrc)

**Files:**
- Modify: `bot.js:305-316` — update `saveAttachments()` to return content type info
- Modify: `bot.js:804-806` — update prompt assembly to use image-specific hints

- [ ] **Step 1: Update saveAttachments to return content type**

Replace:

```js
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
```

with:

```js
async function saveAttachments(attachments, targetDir) {
  const saved = [];
  for (const [, att] of attachments) {
    const dest = resolve(targetDir, att.name);
    const res = await fetch(att.url);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    const isImage = att.contentType && att.contentType.startsWith("image/");
    saved.push({ path: dest, isImage });
    console.log(`Saved attachment: ${dest} (${isImage ? "image" : "file"})`);
  }
  return saved;
}
```

- [ ] **Step 2: Update prompt assembly for image-aware hints**

Replace:

```js
    const saved = await saveAttachments(message.attachments, session.cwd);
    const refs = saved.map((p) => `[Attached: ${p}]`).join("\n");
```

with:

```js
    const saved = await saveAttachments(message.attachments, session.cwd);
    const refs = saved
      .map((att) =>
        att.isImage
          ? `[Attached image: ${att.path}] — Use the Read tool to view this image.`
          : `[Attached: ${att.path}]`
      )
      .join("\n");
```

- [ ] **Step 3: Test manually on Discord**

1. Attach an image (PNG/JPG) to a message — verify Claude reads and describes the image
2. Attach a non-image file (e.g., .txt) — verify it uses the old generic format

- [ ] **Step 4: Commit**

```bash
git add bot.js
git commit -m "feat(ux): add image-aware attachment hints for reliable Claude analysis"
```
