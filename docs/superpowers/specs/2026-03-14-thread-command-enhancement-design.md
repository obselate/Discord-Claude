# `/thread` Command Enhancement: Project Directory Support

## Problem

Clod's `/thread` command creates forum posts with fresh Claude sessions, but all sessions share the same global `WORKING_DIR`. Users cannot work on multiple projects simultaneously because every thread's Claude session operates in the same directory.

## Solution

Enhance `/thread` with two new parameters — `directory` (required) and `description` (optional) — so each thread's Claude session targets a specific project directory. This enables concurrent work across multiple projects via separate Discord forum posts.

## Design

### Command Definition

The `/thread` slash command gains two new options:

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `directory` | STRING | Yes | Filesystem path to the project directory |
| `topic` | STRING | No | Thread name (defaults to `Claude Thread – <date>`) |
| `description` | STRING | No | Shown in the forum post starter message |

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

One line changes — use the session's `cwd` instead of the global constant:

```js
// Before
cwd: WORKING_DIR,

// After
cwd: session.cwd || WORKING_DIR,
```

Sessions created outside `/thread` (DMs, regular channels) fall back to `WORKING_DIR`. No behavior change for existing usage.

### `/thread` Handler Flow

1. Read `directory`, `topic`, and `description` from the interaction options.
2. Resolve the path with `resolve(directory)` to normalize it.
3. Create the directory if it doesn't exist: `mkdirSync(resolvedPath, { recursive: true })`.
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

## Scope

All changes are in `bot.js`:

1. Command definition array — add `directory` and `description` options.
2. Session `getSession()` — add `cwd` field with `WORKING_DIR` default.
3. `sendToClaud()` — use `session.cwd || WORKING_DIR`.
4. `/thread` case in `handleCommand()` — read new params, validate/create directory, build starter message, store `cwd`.

## Out of Scope

- Project registry / autocomplete from known projects (future enhancement).
- Per-thread model selection via `/thread` (already handled by `/model` within the thread).
- Persisting session-to-directory mappings across bot restarts (sessions are already in-memory only).
