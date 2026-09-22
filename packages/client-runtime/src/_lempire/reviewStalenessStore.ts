// [FORK] lempire: the exact staleness answers this client has already worked
// out, so a list can stop guessing about a pull request somebody opened.
//
// A row knows only `updatedAt` and has to read any movement as a possible push;
// a detail holds the branch's commits and knows. The detail writes its answer
// here, the lists read it (see `applyKnownReviewStaleness`). In memory and per
// client: it is a cache of something the detail can always work out again, not
// state worth persisting or sending anywhere.
import type { KnownReviewStaleness } from "./reviewOfRecord.ts";

/** Plenty for the pull requests one sitting opens, and bounded for the ones it does not. */
const MAX_ENTRIES = 200;

const entries = new Map<string, KnownReviewStaleness>();
const listeners = new Set<() => void>();
/** Replaced rather than mutated, so `useSyncExternalStore` sees a new snapshot. */
let snapshot: ReadonlyMap<string, KnownReviewStaleness> = new Map();

/** The answer a detail reached, keyed by `reviewBadgeKey`. Unchanged answers cost nothing. */
export function recordReviewStaleness(key: string, answer: KnownReviewStaleness): void {
  const held = entries.get(key);
  if (
    held !== undefined &&
    held.reportUrl === answer.reportUrl &&
    held.updatedAt === answer.updatedAt &&
    held.stale === answer.stale
  ) {
    return;
  }
  // Re-inserted so the map's own order is least-recently-answered first.
  entries.delete(key);
  entries.set(key, answer);
  for (const oldest of entries.keys()) {
    if (entries.size <= MAX_ENTRIES) break;
    entries.delete(oldest);
  }
  snapshot = new Map(entries);
  for (const listener of listeners) listener();
}

export function reviewStalenessSnapshot(): ReadonlyMap<string, KnownReviewStaleness> {
  return snapshot;
}

export function subscribeReviewStaleness(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only: the store outlives any one of them. */
export function resetReviewStaleness(): void {
  entries.clear();
  snapshot = new Map();
  for (const listener of listeners) listener();
}
