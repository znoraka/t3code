# Fork Management

This repo is a fork of [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code).

- **Upstream remote:** `git@github.com:pingdotgg/t3code.git`
- **Fork remote:** `git@github.com:znoraka/t3code.git`

---

## Strategy

The upstream is under heavy, active development. The only sustainable way to maintain a long-lived fork is to **keep the diff against upstream as small as possible**. The smaller the overlap, the fewer the conflicts on each rebase.

### Isolation model

All fork-specific code lives inside `_lempire/` subdirectories. This keeps it invisible to upstream and grouped in one place per package:

```
apps/
  server/src/_lempire/      ← server-side fork features
  web/src/_lempire/         ← client-side fork features
packages/
  shared/src/_lempire/      ← shared fork utilities
  contracts/src/_lempire/   ← fork-only schema types
```

The `_` prefix is intentional: it sorts to the top, is never a valid upstream name, and makes it trivially obvious that a file is fork-owned.

### The three rules for writing new code

1. **New feature → new file in `_lempire/`**. Do not add logic to an existing upstream file.
2. **Need to wire it up → touch the upstream file at the call site only**. One import, one function call, wrapped in `// [FORK]` comments.
3. **Need to change upstream behavior → wrap, don't modify**. Re-export with a wrapper in `_lempire/`, then use your wrapper downstream.

### `// [FORK]` marker format

Every change inside an upstream file must be bracketed:

```ts
// [FORK] lempire: <short description of why this touch was unavoidable>
import { featureX } from "./_lempire/featureX";
featureX.register(server);
// [FORK] end
```

This makes it trivial to grep for all upstream touchpoints (`grep -r '\[FORK\]' .`) and review them before a rebase.

### Composition patterns

| Situation                                              | What to do                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Upstream exports a function you want to extend         | Create `_lempire/wrappedFn.ts` that re-exports with additions                                 |
| Upstream defines a type you want to augment            | Intersection type in `_lempire/types.ts`                                                      |
| Upstream has a router/server you want to add routes to | New route file in `_lempire/`, register with one `// [FORK]` line in the upstream router file |
| Upstream has a React component you want to modify      | Wrap it in `_lempire/WrappedComponent.tsx`, use the wrapper instead                           |
| Upstream has a config you want to extend               | Import upstream config in `_lempire/`, spread and override                                    |

---

## Upstream Sync Process

```bash
# 1. Fetch latest upstream
git fetch upstream

# 2. Rebase your fork on upstream main (never merge)
git rebase upstream/main

# 3. Conflicts will appear — they should only be in files listed below
#    Fix each conflict, then:
git add <conflicted-file>
git rebase --continue

# 4. Push to your fork
git push origin main --force-with-lease
```

> **Always rebase, never merge.** Merges create a tangle of diverging histories that make future rebases exponentially harder. Rebase keeps the fork's commits on top of upstream's, producing a clean linear diff.

### Before each rebase

Run `grep -rn '\[FORK\]' . --include='*.ts' --include='*.tsx'` to get the current list of upstream touchpoints. These are the only files that can possibly conflict.

---

## Upstream Files Touched

> **Agents: update this table every time you add a `// [FORK]` marker to an upstream file.**
> If you remove a fork change from an upstream file, remove it from this table too.

| File                                                                         | Reason                                                                                                                                         | PR / Feature           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `apps/web/src/components/Sidebar.tsx`                                        | `useProjectAccents` on the project list; accent wash + tinted name on the project header row.                                                  | Sidebar machine colors |
| `apps/web/src/components/SidebarV2.tsx`                                      | `useEnvironmentAccents` for the thread list; tinted project name on each card and in the project scope menu.                                   | Sidebar machine colors |
| `apps/web/src/components/Sidebar.tsx`                                        | Renders `SidebarModeTabSwitcher` / `SidebarPullRequestsContent` from `_lempire/SidebarPullRequests`.                                           | PR workspace           |
| `apps/web/src/components/SidebarV2.tsx`                                      | `SidebarV2ModeToggle` in the header row; early return to `SidebarV2PullRequestsPane` in PR mode.                                               | PR workspace           |
| `apps/mobile/src/features/threads/thread-list-items.tsx`                     | `accentColors` prop on `ThreadListGroupHeader`; accent wash + tinted title.                                                                    | Sidebar machine colors |
| `apps/mobile/src/features/threads/thread-list-v2-items.tsx`                  | `accentColor` prop on `ThreadListV2Row`; tinted project name on each card (no wash — see the feature note).                                    | Sidebar machine colors |
| `apps/mobile/src/features/home/HomeScreen.tsx`                               | Compute both accent assignments and pass them to the v1 group header and the v2 rows.                                                          | Sidebar machine colors |
| `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx`               | Same wiring as HomeScreen — the iPad sidebar renders the same header and rows.                                                                 | Sidebar machine colors |
| `packages/shared/package.json`                                               | `exports` entry for `./_lempire/environmentColor`. JSON, carries no `[FORK]` comment — noted here instead.                                     | Sidebar machine colors |
| `apps/server/src/git/GitManager.ts`                                          | PR contracts imported; upstream's inline service shape extracted to an exported `GitManagerShape` so the PR mixins in `./Layers/` can name it. | PR workspace           |
| `packages/client-runtime/src/rpc/http.ts`                                    | `fetchEnvironmentJsonDocument` — text-body fetch path for multi-megabyte snapshots on React Native.                                            | Mobile sync unfreeze   |
| `packages/client-runtime/src/state/shell.ts`, `threadShell.ts`, `threads.ts` | Cooperative-yield calls in the sync apply loops.                                                                                               | Mobile sync unfreeze   |
| `pnpm-workspace.yaml` / `pnpm-lock.yaml`                                     | `expo-modules-core` patch entry. YAML, carries a `# [FORK]` comment in the workspace file only.                                                | iOS build fix          |

---

## Fork-Only Features

> Track what this fork adds, so it's easy to audit what needs carrying forward after a large upstream rebase.

| Feature                | Location                                                                                                                                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar machine colors | `packages/shared/src/_lempire/environmentColor.ts`, `apps/web/src/_lempire/projectAccent.ts`, `apps/mobile/src/_lempire/projectAccent.ts`                                 | Tints each sidebar row by the **machine** it runs on — every project on the same laptop/VPS shares a hue. Keyed on `environmentId`, which the server mints once and every client copies verbatim, so web and mobile agree with nothing stored or synced (the connection catalog is per-device and does not sync). Colors are **assigned**, not hashed: hashing alone duplicates a slot in ~95% of 8-machine sidebars, and — worse — picks perceptually identical hues (four machines all landed on cyan/teal/emerald/lime). Assignment gives each machine after the first the unused hue farthest from those already taken. A row aggregating one repo across machines blends their colors left to right. Assignment runs over the _unfiltered_ project list, so searching never reshuffles. Trade-off: connecting/removing a machine can shift colors. On web the accents ride on the project snapshot (`WithProjectAccent`) rather than a context provider, to avoid re-indenting hot upstream JSX. Thread list v2 (web Sidebar V2, mobile Home + iPad sidebar) lists threads flat with no project header, so it assigns once for the whole list (`useEnvironmentAccents`, one per platform) and tints the project name on each card instead of a wash — one wash per card would be ten washes on screen. Mobile skips the tint on the selected iPad row, which is filled with the selection color and needs its white-on-accent text. |
| Mobile sync unfreeze   | `packages/client-runtime/src/state/cooperativeYield.ts`, `packages/client-runtime/src/rpc/http.ts`                                                                        | Keeps the React Native JS thread responsive during a sync burst. Two halves: read snapshot bodies as text rather than array buffers (RN's `readAsArrayBuffer` round-trips through base64 and cost ~18s of GC on a multi-megabyte snapshot), and time-slice the stream apply loop so the host gets the thread back at least every 50ms. The yield must go through a real `setTimeout` — RN flushes immediates before returning to native, so microtasks and `Effect.sleep` never let queued touches through. Both suppression comments in `cooperativeYield.ts` exist for that reason.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| PR workspace           | `apps/web/src/routes/_chat.pull-requests.tsx`, `apps/web/src/prViewStore.ts`, `apps/web/src/components/PullRequest*.tsx`, `apps/web/src/_lempire/SidebarPullRequests.tsx` | Review pull requests in-app over the `gh` CLI. Predates the `_lempire/` convention, so most of it still sits in plainly-named `components/` files — only the sidebar half has been isolated. The route component renders nothing but a store sync layer: the **sidebar is the PR navigation**, so every sidebar has to carry both a mode control and the list, or PRs become unreachable. `_lempire/SidebarPullRequests.tsx` holds the shared list plus one control per sidebar (v1 two-tab switcher, v2 single icon toggle) over a shared navigation hook — v2 would otherwise import from the 3.8k-line v1 `Sidebar.tsx`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

---

## Sync Log

> Note: the strategy section above says "always rebase, never merge", but every
> sync this fork has actually done is a merge. With ~57 fork commits on top of a
> 34-commit upstream — and upstream rewriting `SidebarV2.tsx` wholesale — a
> rebase means replaying every fork commit through the same conflict. Merging
> resolves it once. Treat "always rebase" as aspirational until the fork's own
> history is short enough for it to be cheap.

| Date       | From commit | To commit   | Conflicts                                                                 | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | ----------- | ----------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-28 | `13ff6b5fa` | `dd5ea3248` | `SidebarV2.tsx`, `GitManager.ts`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | Upstream moved the v2 sidebar header into a `fixedHeader` prop on `SidebarContent` and added a `size="icon"` button variant — the fork's header touches were re-applied on top of upstream's structure rather than merged line by line. Effect went 4.0.0-beta.78 → beta.102, whose language service newly flags `Date.now()`/`setTimeout`/`JSON.stringify`/`unknown` error channels; fixed in `cooperativeYield.ts`, `http.ts`, `http.test.ts`. Upstream also migrated tests from `vitest` to `vite-plus/test`. |
