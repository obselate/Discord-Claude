#!/usr/bin/env node
/**
 * Environment verifier — run with `npm run check` before starting the bot.
 * Exits 0 if all required checks pass, 1 if any required check fails.
 */

require("dotenv/config");
const { resolve } = require("path");
const {
  checkNodeVersion,
  checkDiscordToken,
  checkClaudeCLI,
  checkWorkingDir,
  checkForumChannelId,
} = require("./health.js");

const WORKING_DIR = resolve(process.env.CLAUDE_WORKDIR || "./claude-workdir");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function pass(msg) { console.log(`${GREEN}  ✅ ${msg}${RESET}`); }
function fail(msg) { console.log(`${RED}  ❌ ${msg}${RESET}`); }
function warn(msg) { console.log(`${YELLOW}  ⚠️  ${msg}${RESET}`); }

console.log("\nClod Bot — Environment Check\n");

const required = [
  checkNodeVersion(),
  checkDiscordToken(),
  checkClaudeCLI(),
  checkWorkingDir(WORKING_DIR),
];

const optional = [
  checkForumChannelId(),
];

let failed = 0;

console.log("Required:");
for (const result of required) {
  if (result.ok) {
    pass(result.message);
  } else {
    fail(result.message);
    failed++;
  }
}

console.log("\nOptional:");
for (const result of optional) {
  if (result.ok) {
    pass(result.message);
  } else {
    warn(result.message);
  }
}

if (failed === 0) {
  console.log(`\n${GREEN}All required checks passed. Run \`npm start\` to launch the bot.${RESET}\n`);
  process.exit(0);
} else {
  console.log(`\n${RED}${failed} required check(s) failed. Fix the issues above before starting.${RESET}\n`);
  process.exit(1);
}
