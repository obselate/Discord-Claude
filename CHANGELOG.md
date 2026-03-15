# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Per-thread pinned beads dashboard — each forum thread with a `.beads/` project gets an auto-updating pinned status message.

### Changed

- Refactored bot.js (1200 → 383 lines) into focused `lib/` modules: sessions, commands, handlers, sdk, formatting, attachments.
- Dashboard rewritten from single-channel to per-thread model with single ticker loop.

## [1.0.0] - 2026-03-15

### Added

- Discord bot powered by Claude Code Agent SDK with full tool access.
- Per-channel and per-thread session management with conversation continuity.
- Slash commands: /clear, /session, /sessions, /resume, /model, /kill_all, /thread, /compact, /memory, /cost, /status, /mcp, /tools, /doctor.
- Forum channel support with /thread for creating dedicated Claude sessions.
- Auto-detection of forum threads by channel type, surviving bot restarts.
- File and image attachment handling for messages sent to Claude.
- MCP server integration for extended tool capabilities.
- Discord-flavored markdown formatting for Claude responses.
- Token usage and context window tracking per session.
- Environment health checker via `npm run check`.

### Fixed

- Bot crash from unhandled error events on slash command interactions.
