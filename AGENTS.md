# AGENTS.md

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.

## Codex App Server (Important)

T3 Code is currently Codex-first. The server starts `codex app-server` (JSON-RPC over stdio) per provider session, then streams structured events to the browser through WebSocket push messages.

How we use it in this codebase:

- Session startup/resume and turn lifecycle are brokered in `apps/server/src/codexAppServerManager.ts`.
- Provider dispatch and thread event logging are coordinated in `apps/server/src/providerManager.ts`.
- WebSocket server routes NativeApi methods in `apps/server/src/wsServer.ts`.
- Web app consumes orchestration domain events via WebSocket push on channel `orchestration.domainEvent` (provider runtime activity is projected into orchestration events server-side).

Docs:

- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Fork Management (CRITICAL — read before touching any file)

This repo is a fork of `pingdotgg/t3code` (upstream). The upstream is under heavy active development. **The primary engineering constraint for all changes is: minimize the diff surface against upstream files.**

See `FORK.md` for the full strategy, sync process, and the running log of all upstream files this fork has touched.

### The golden rule

> Prefer adding new files over modifying existing upstream files.

Every line you add to an upstream file is a future merge conflict. Every new file you create is conflict-free by default.

### Where to put fork-specific code

- New features live in a `_lempire/` subdirectory alongside the upstream code they extend:
  - `apps/web/src/_lempire/`
  - `apps/server/src/_lempire/`
  - `packages/shared/src/_lempire/`
- Use the `_` prefix so it sorts first and is instantly recognizable as fork-only code.
- Never spread fork logic across multiple upstream files — keep it self-contained.

### When you MUST touch an upstream file

Sometimes you can't avoid it (e.g., registering a route, adding one import). If so:

1. Keep the change to the **absolute minimum** — one import + one call site at most.
2. Wrap the addition with a `// [FORK]` comment on both sides:
   ```ts
   // [FORK] lempire: <short reason>
   import { myFeature } from "./_lempire/myFeature";
   myFeature.register(app);
   // [FORK] end
   ```
3. **Log it in `FORK.md`** under "Upstream Files Touched" immediately — before finishing the task.

### Composition over modification

- If upstream exports a function, **wrap it** in `_lempire/` rather than editing it.
- If upstream defines a type, **extend it** with an intersection type in `_lempire/`.
- If upstream wires up a router/handler, **add a new route file** and register it in one line.

### Sync with upstream

```bash
git fetch upstream
git rebase upstream/main
```

Always rebase, never merge. This keeps the fork diff linear and makes conflict resolution tractable. Conflicts should almost exclusively appear in upstream files listed in `FORK.md`.
