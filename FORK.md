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

| File                                                             | Reason                                                                                                            | PR / Feature            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `apps/web/src/components/Sidebar.tsx`                            | `useProjectAccents` on the project list; accent wash + tinted name on the project header row.                     | Sidebar machine colors  |
| `apps/web/src/components/SidebarV2.tsx`                          | `useEnvironmentAccents` for the thread list; tinted project name on each card and in the project scope menu.      | Sidebar machine colors  |
| `apps/mobile/src/features/threads/thread-list-items.tsx`         | `accentColors` prop on `ThreadListGroupHeader`; accent wash + tinted title.                                       | Sidebar machine colors  |
| `apps/mobile/src/features/threads/thread-list-v2-items.tsx`      | `accentColor` prop on `ThreadListV2Row`; tinted project name on each card (no wash — see the feature note).       | Sidebar machine colors  |
| `apps/mobile/src/features/home/HomeScreen.tsx`                   | Compute both accent assignments and pass them to the v1 group header and the v2 rows.                             | Sidebar machine colors  |
| `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx`   | Same wiring as HomeScreen — the iPad sidebar renders the same header and rows.                                    | Sidebar machine colors  |
| `packages/shared/package.json`                                   | `exports` entry for `./_lempire/environmentColor`. JSON, carries no `[FORK]` comment — noted here instead.        | Sidebar machine colors  |
| `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` | "Review with agent" + variant radio + "Copy review prompt" in the actions menu, next to upstream's own handoffs.  | Agent review            |
| `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx`  | `AgentReviewCard` at the top of the scroll root; renders nothing for an unreviewed PR.                            | Agent review            |
| `apps/web/src/routes/__root.tsx`                                 | Mounts `PendingLinksBootstrap` (and the notification-sounds bootstrap).                                           | Agent review            |
| `apps/server/src/ws.ts`                                          | Registers the `plandrop.reportsForPullRequest` handler next to upstream's own RPCs.                               | Agent review            |
| `packages/contracts/src/rpc.ts` / `src/index.ts`                 | The plandrop reports RPC and its schema exports.                                                                  | Agent review            |
| `apps/mobile/src/Stack.tsx`                                      | The `PullRequests` / `PullRequest` routes, and `useApplyPendingReviewLinks` in the outbox worker leaf.            | Pull requests on mobile |
| `apps/mobile/src/features/home/HomeHeader.tsx`                   | A pull-requests button in all three header shapes (iOS glass right items, pre-glass toolbar, Android toolbar).    | Pull requests on mobile |
| `apps/mobile/src/features/home/HomeRouteScreen.tsx`              | Passes `onOpenPullRequests` to the header.                                                                        | Pull requests on mobile |
| `apps/mobile/src/features/home/MaterialThreadListToolbar.tsx`    | Optional `onOpenPullRequests` icon button; the iPad sidebar copy leaves it out.                                   | Pull requests on mobile |
| `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx`        | `claimPendingReviewLink` at send: the one place a draft key and its new thread id both exist.                     | Pull requests on mobile |
| `apps/mobile/src/features/keyboard/CommandPalette.tsx`           | One "Pull requests" command for hardware keyboards.                                                               | Pull requests on mobile |
| `vite.config.ts`                                                 | Allowlists the feed screen for `no-mobile-uniwind-theme-escape-hatches` (author colors mixed against foreground). | Pull requests on mobile |
| `packages/client-runtime/package.json`                           | `exports` entries for `./_lempire/*`. JSON, carries no `[FORK]` comment — noted here instead.                     | Pull requests on mobile |
| `pnpm-workspace.yaml` / `pnpm-lock.yaml`                         | `expo-modules-core` patch entry. YAML, carries a `# [FORK]` comment in the workspace file only.                   | iOS build fix           |

---

## Fork-Only Features

> Track what this fork adds, so it's easy to audit what needs carrying forward after a large upstream rebase.

| Feature                 | Location                                                                                                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar machine colors  | `packages/shared/src/_lempire/environmentColor.ts`, `apps/web/src/_lempire/projectAccent.ts`, `apps/mobile/src/_lempire/projectAccent.ts` | Tints each sidebar row by the **machine** it runs on — every project on the same laptop/VPS shares a hue. Keyed on `environmentId`, which the server mints once and every client copies verbatim, so web and mobile agree with nothing stored or synced (the connection catalog is per-device and does not sync). Colors are **assigned**, not hashed: hashing alone duplicates a slot in ~95% of 8-machine sidebars, and — worse — picks perceptually identical hues (four machines all landed on cyan/teal/emerald/lime). Assignment gives each machine after the first the unused hue farthest from those already taken. A row aggregating one repo across machines blends their colors left to right. Assignment runs over the _unfiltered_ project list, so searching never reshuffles. Trade-off: connecting/removing a machine can shift colors. On web the accents ride on the project snapshot (`WithProjectAccent`) rather than a context provider, to avoid re-indenting hot upstream JSX. Thread list v2 (web Sidebar V2, mobile Home + iPad sidebar) lists threads flat with no project header, so it assigns once for the whole list (`useEnvironmentAccents`, one per platform) and tints the project name on each card instead of a wash — one wash per card would be ten washes on screen. Mobile skips the tint on the selected iPad row, which is filled with the selection color and needs its white-on-accent text.                            |
| Agent review            | `apps/web/src/_lempire/agentReview/`, `apps/server/src/_lempire/PlandropReports.ts`, `packages/client-runtime/src/_lempire/`              | Kicks off the `test-and-review` skill on a pull request from upstream's PR panel and shows its plandrop report. `useStartAgentReview` opens a draft in the PR's project with `$test-and-review <n>` staged in the composer (no checkout: the skill reads the PR through `gh`); the draft has no server thread yet, so `pendingLinks` remembers the PR for the draft's thread id and `PendingLinksBootstrap` dispatches `thread.meta.update` with `linkedPullRequest` once the shell appears. The report itself comes from **plandrop's own index**, keyed by pull request, asked of the environment (`plandrop.reportsForPullRequest`) because the lookup needs the host's plandrop token: a review counts wherever it ran — another machine, an archived thread, a thread nobody linked — which is the normal case. A host with no credential answers `configured: false` and the card stays quiet. Staleness is an exact commit comparison against the head the review read (`headSha`), falling back to a timestamp estimate only for reports published before the uploader recorded one. `AgentReviewCard` renders the verdict ribbon and crit/warn/good tiles above the threads linked to the PR, matched through `linkedPullRequest ?? branchPullRequest`, never by title. The decision half (`reviewOfRecord`, `reviewVariant`) lives in `client-runtime/_lempire` because the mobile card shares it.                                                        |
| Pull requests on mobile | `apps/mobile/src/_lempire/pullRequests/`, `packages/client-runtime/src/_lempire/pullRequestSections.ts`                                   | Triage and review pull requests from the phone: no diff, no conversation, no merge. One feed across every environment whose server reports the `pullRequests` capability — four listings per environment (`reviewing`, `involved`, `authored`, `merged`) asked **without** a `projectId`, so one read covers all of that environment's projects, collapsed into a single subscription by an atom keyed on the environment list (the `createArchivedThreadSnapshotsAtomFamily` shape). Each bucket is deduplicated by `host:repo#number` before bucketing, because one repository checked out as two projects — or present on two machines — answers twice. Buckets, the settled tail and the author hue are the same shared code the web column uses, so both surfaces agree; `authorAccentHex` exists because React Native has no `color-mix`. The detail screen reads `detail` plus `activity` (for `commits`, the only source of the head commit the stale check needs) and renders the native twin of the web review card. "Review with agent" creates a new-task draft, stages the prompt, and opens it by id; the PR link waits under the draft key because the phone only mints a thread id at send, is claimed there, and is written onto the thread by `useApplyPendingReviewLinks` in the outbox worker leaf. Links are held in memory, not persisted: losing one costs the link, not the review, and the verdict still arrives through plandrop's index. |

---

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
