import type { PullRequestListEntry } from "@t3tools/contracts";

/** Merged rows shown before the reader has to ask for the rest. */
export const SETTLED_INITIAL_COUNT = 5;

export interface PullRequestSections<Entry extends PullRequestListEntry = PullRequestListEntry> {
  /** Review requested of the reader and not yet answered — headerless at the top. */
  readonly needsMe: ReadonlyArray<Entry>;
  /** The reader's own open work. */
  readonly mine: ReadonlyArray<Entry>;
  /** Everything else the reader took part in: reviewed, commented, mentioned. */
  readonly waiting: ReadonlyArray<Entry>;
  /** Merged, newest first. */
  readonly settled: ReadonlyArray<Entry>;
}

/** Repository plus number identifies a row within one host. */
export function pullRequestRowKey(entry: {
  readonly host?: string | undefined;
  readonly repository: string;
  readonly number: number;
}): string {
  return `${(entry.host ?? "").toLowerCase()}:${entry.repository.toLowerCase()}#${entry.number}`;
}

export function byUpdatedAtDesc(a: PullRequestListEntry, b: PullRequestListEntry): number {
  const left = a.updatedAt ? Date.parse(a.updatedAt) : 0;
  const right = b.updatedAt ? Date.parse(b.updatedAt) : 0;
  return right - left;
}

/**
 * The sidebar's four buckets from the host's own answers. A request for review beats mere
 * involvement, and the reader's own work is never "waiting on others" even when they were
 * asked to review it.
 */
export function buildPullRequestSections<Entry extends PullRequestListEntry>(input: {
  readonly reviewRequested: ReadonlyArray<Entry>;
  readonly involved: ReadonlyArray<Entry>;
  readonly mine: ReadonlyArray<Entry>;
  readonly merged: ReadonlyArray<Entry>;
}): PullRequestSections<Entry> {
  const mineKeys = new Set(input.mine.map(pullRequestRowKey));
  const needsMe = input.reviewRequested
    .filter((entry) => !mineKeys.has(pullRequestRowKey(entry)))
    .toSorted(byUpdatedAtDesc);
  const claimed = new Set([...mineKeys, ...needsMe.map(pullRequestRowKey)]);
  const waiting = input.involved
    .filter((entry) => !claimed.has(pullRequestRowKey(entry)))
    .toSorted(byUpdatedAtDesc);
  return {
    needsMe,
    mine: input.mine.toSorted(byUpdatedAtDesc),
    waiting,
    settled: input.merged.toSorted(byUpdatedAtDesc),
  };
}

/** Newest merges first, cut to the collapsed count unless the reader asked for all of them. */
export function sliceSettled<Entry extends PullRequestListEntry>(
  settled: ReadonlyArray<Entry>,
  expanded: boolean,
): { readonly visible: ReadonlyArray<Entry>; readonly hiddenCount: number } {
  const visible = expanded ? settled : settled.slice(0, SETTLED_INITIAL_COUNT);
  return { visible, hiddenCount: settled.length - visible.length };
}

/** The sidebar's terse age: "just now", "5m", "3h", "2d", "4mo", "1y". */
export function relativeTime(value: string, now: number = Date.now()): string {
  if (!value) return "";
  const then = Date.parse(value);
  if (Number.isNaN(then)) return "";
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  return `${years}y`;
}

/** Deterministic per-author hue so the name line reads like the colored project line of threads. */
export function authorHue(login: string): number {
  let hash = 0;
  for (let i = 0; i < login.length; i += 1) {
    hash = (hash * 31 + login.charCodeAt(i)) | 0;
  }
  return ((hash % 360) + 360) % 360;
}
