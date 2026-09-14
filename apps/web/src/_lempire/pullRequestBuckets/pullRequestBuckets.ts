import type { PullRequestListEntry } from "@t3tools/contracts";

import type {
  PullRequestGroup,
  PullRequestGroupKey,
} from "~/components/pullRequest/pullRequestList.logic";

/** Merged rows shown before the reader has to ask for the rest. */
export const SETTLED_INITIAL_COUNT = 5;

/**
 * The fork's reading order: what needs the reader sits on top with no heading, the way active
 * threads do in the sidebar; their own work follows; everything else waits on someone else.
 */
const BUCKET_ORDER: ReadonlyArray<PullRequestGroupKey> = ["reviewRequested", "authored", "others"];
const BUCKET_LABELS: Record<PullRequestGroupKey, string> = {
  reviewRequested: "",
  authored: "Your pull requests",
  others: "Waiting on others",
};

/**
 * Reorders and relabels upstream's involvement groups into the fork's buckets. A list that is
 * not grouped by involvement — an Authored or Reviewing tab, or a search — is one flat group and
 * passes through untouched.
 */
export function bucketPullRequestGroups<Entry extends PullRequestListEntry>(
  groups: ReadonlyArray<PullRequestGroup<Entry>>,
  grouped: boolean,
): ReadonlyArray<PullRequestGroup<Entry>> {
  if (!grouped) return groups;
  return BUCKET_ORDER.flatMap((key) => {
    const group = groups.find((candidate) => candidate.key === key);
    return group ? [{ ...group, label: BUCKET_LABELS[key] }] : [];
  });
}

/**
 * Identity of one row, or of the selection, with the host folded to lower case the way the open
 * rows compare it. Shaped as a plain object so a selection missing its host still gets a key.
 */
export function pullRequestSelectionKey(target: {
  readonly environmentId?: string | undefined;
  readonly host?: string | undefined;
  readonly repository: string;
  readonly number: number;
}): string {
  const scope = target.environmentId === undefined ? "" : `${target.environmentId}:`;
  return `${scope}${(target.host ?? "").toLowerCase()}:${target.repository}#${target.number}`;
}

/** Newest merge first, cut to the collapsed count unless the reader asked for all of them. */
export function sliceSettledPullRequests<Entry extends PullRequestListEntry>(
  entries: ReadonlyArray<Entry>,
  expanded: boolean,
): { readonly visible: ReadonlyArray<Entry>; readonly hiddenCount: number } {
  const ordered = entries.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const visible = expanded ? ordered : ordered.slice(0, SETTLED_INITIAL_COUNT);
  return { visible, hiddenCount: ordered.length - visible.length };
}
