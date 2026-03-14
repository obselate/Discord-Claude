# Text Formatting & Image Attachment Improvements

## Summary

Two small UX fixes to `bot.js`: clean up how Claude's responses are assembled and displayed, and make image attachments reliably analyzed by Claude.

## Feature 1: Text Formatting

### Problem

- Text blocks from the SDK are joined with `chunks.join("")`, concatenating separate thoughts without line breaks.
- Tool use is displayed as a chain of emoji lines (`🔧 *Read* → 🔧 *Edit*`) prepended to the response — noisy and hard to scan.

### Solution

1. **Text assembly**: Change `chunks.join("")` to `chunks.join("\n\n")` so separate SDK text blocks get paragraph breaks.
2. **Tool summary line**: Replace the emoji chain with a single deduped summary appended as a footer:
   ```
   > *Used 3 tools: Read, Edit, Bash*
   ```
   - Collect tool names in a `Set` for deduplication.
   - Place at the **end** of the response so the answer comes first.
   - Singular form when only one tool: `> *Used 1 tool: Read*`

### Files Changed

- `bot.js` — `sendToClaud()` function, response assembly section (lines ~200–270)

## Feature 2: Reliable Image Attachments

### Problem

When a user attaches an image, Claude receives `[Attached: /path/to/image.png]` — a generic label that doesn't signal it should view the image.

### Solution

1. **Detect image attachments**: Check `att.contentType` for `image/*` prefix.
2. **Use a stronger prompt hint** for images:
   ```
   [Attached image: /path/to/screenshot.png] — Use the Read tool to view this image.
   ```
   Non-image files keep the current format:
   ```
   [Attached: /path/to/data.csv]
   ```

### Files Changed

- `bot.js` — `saveAttachments()` return value updated to include content type, and prompt assembly in `MessageCreate` handler updated to format image hints differently.

## Out of Scope

- Embeds, buttons, or rich Discord components for responses
- Streaming/progressive display
- Post-processing Claude's markdown for Discord compatibility
- Sending images from Claude back to Discord
