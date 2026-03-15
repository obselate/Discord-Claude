/**
 * File attachment handling — saves Discord attachments to the working directory.
 */

const { resolve } = require("path");
const { writeFileSync } = require("fs");

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

module.exports = { saveAttachments };
