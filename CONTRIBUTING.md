# Contributing

## Getting Started

1. Fork and clone the repository.
2. Install dependencies:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in `DISCORD_BOT_TOKEN` (at minimum).
4. Run the bot in development mode:
   ```
   npm run dev
   ```
5. Run health and lint checks before submitting changes:
   ```
   npm run check
   ```

Node.js 18 or later is required. The Claude Agent SDK is loaded automatically via dynamic import -- no separate install step needed.

## Code Style

- CommonJS modules throughout. No TypeScript.
- Use `// ---...---` comment blocks as section separators in longer files.
- Keep functions focused. If a block of logic grows past a clear single responsibility, extract it.
- The `claude-workdir/` directory is a gitignored scratch space -- never commit its contents.

## Commit Messages

Each commit should represent one logical change. Use a conventional-commit prefix with a scope:

```
feat(commands): add /ping slash command
fix(session): clear stale sessions on reconnect
chore(deps): bump discord.js to 14.x
refactor(bot): extract message formatting helpers
docs(readme): clarify environment variable setup
```

Common prefixes: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`.

## Pull Requests

- Branch from `main`. Keep the diff minimal and focused on a single concern.
- Include a short description of what changed and why.
- Make sure `npm run check` passes.
- If your change affects bot behavior, describe how you tested it (even if manually).
- Avoid bundling unrelated changes -- open separate PRs instead.
