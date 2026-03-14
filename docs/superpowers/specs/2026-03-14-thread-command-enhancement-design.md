# `/thread` Command Enhancement: Project Directory Support

## Problem

Clod's `/thread` command creates forum posts with fresh Claude sessions, but all sessions share the same global `WORKING_DIR`. Users cannot work on multiple projects simultaneously because every thread's Claude session operates in the same directory.

## Solution

Enhance `/thread` with two new parameters — `directory` (required) and `description` (optional) — so each thread's Claude session targets a specific project directory. This enables concurrent work across multiple projects via separate Discord forum posts.

## Design

### Command Definition

The `/thread` slash command gains two new options. Required options must come before optional ones in the array (Discord enforces this):

| Option | Type | Required | Max Length | Description |
|--------|------|----------|------------|-------------|
| `directory` | STRING | Yes | 260 | Filesystem path to the project directory |
| `topic` | STRING | No | 100 | Thread name (defaults to `Claude Thread – <date>`) |
| `description` | STRING | No | 1000 | Shown in the forum post starter message (cosmetic only, not stored on session) |

### Session Object

Add a `cwd` field to the session object:

```js
// Before
{ sessionId: null, model: "", messageCount: 0 }

// After
{ sessionId: null, model: "", messageCount: 0, cwd: WORKING_DIR }
```

`getSession()` initializes `cwd` to the global `WORKING_DIR`. The `/thread` handler overwrites it with the user-provided directory path.

### `sendToClaud` Change

One line changes — use the session's `cwd` directly (since `getSession()` always initializes it to `WORKING_DIR`, it is never falsy):

```js
// Before
cwd: WORKING_DIR,

// After
cwd: session.cwd,
```

Sessions created outside `/thread` (DMs, regular channels) get `WORKING_DIR` from `getSession()` initialization. No behavior change for existing usage.

### `saveAttachments` Change

The `saveAttachments` function currently saves files to the global `WORKING_DIR`. It needs to accept the session's `cwd` so attachments land in the correct project directory:

```js
// Before
const dest = resolve(WORKING_DIR, att.name);

// After — caller passes session.cwd, which always defaults to WORKING_DIR via getSession()
const dest = resolve(targetDir, att.name);
```

The `messageCreate` handler already has access to the session via `getSession(channelId)`, so it passes `session.cwd` to `saveAttachments`.

### `/thread` Handler Flow

1. Read `directory`, `topic`, and `description` from the interaction options.
2. Resolve the path: if the path is absolute, use it directly; if relative, resolve against `WORKING_DIR` (not `process.cwd()`).
3. Create the directory if it doesn't exist: `mkdirSync(resolvedPath, { recursive: true })`. This is a no-op for existing directories.
4. Build the forum post starter message:
   ```
   📁 Project: <resolvedPath>
   📝 <description>              ← only if provided

   Send a message to start chatting with Claude!
   ```
5. Create the forum post or thread (existing logic, unchanged).
6. Track the thread: `botThreads.add(thread.id)`.
7. Initialize the session with the project directory: set `getSession(thread.id).cwd = resolvedPath`.
8. Reply with confirmation (ephemeral).

### Error Handling

- If `mkdirSync` fails (permissions, invalid path), catch the error and reply with an ephemeral error message. Do not create the thread.
- Existing error handling for thread creation remains unchanged.

### Security Note

Directory paths come from Discord user input with no whitelist restriction. This is acceptable because Clod is intended for use on private servers with trusted users, and the bot already runs in `bypassPermissions` mode giving Claude unrestricted filesystem access. Discord enforces non-empty input for required string options, so no explicit empty-string check is needed. If Clod is ever deployed to untrusted servers, path validation (e.g., restricting to an allowed parent directory) should be added.

### Concurrent Access

Multiple threads may target the same directory. This is allowed — it mirrors how multiple terminal sessions can work in the same directory. Users are responsible for avoiding conflicting edits.

## Scope

All changes are in `bot.js`:

1. Command definition array — add `directory` (required, first) and `description` (optional) options.
2. Session `getSession()` — add `cwd` field with `WORKING_DIR` default.
3. `sendToClaud()` — use `session.cwd`.
4. `saveAttachments()` — accept a `targetDir` parameter instead of using global `WORKING_DIR`.
5. `messageCreate` handler — pass `session.cwd` to `saveAttachments`.
6. `/thread` case in `handleCommand()` — read new params, validate/create directory, build starter message, store `cwd`.

## Out of Scope

- Project registry / autocomplete from known projects (future enhancement).
- Per-thread model selection via `/thread` (already handled by `/model` within the thread).
- Persisting session-to-directory mappings across bot restarts (sessions are already in-memory only).
- `/resume` command using per-thread `cwd` for session listing (currently always uses global `WORKING_DIR`).
- Displaying `cwd` in `/session` output (easy future addition).
