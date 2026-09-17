// [FORK] lempire: the phone's pull-request feed, as a flat list of rows.
//
// The phone asks every pull-request-capable environment for each involvement
// bucket and shows one merged feed: you open this to see what needs you, not to
// browse a repository. Two things follow from merging. One pull request can be
// answered twice — a repository checked out as two projects, or the same
// repository on two machines — so each bucket is deduplicated by identity before
// the shared bucketing runs. And the rows have to arrive as one flat array,
// because that is what a virtualized list can measure.
import {
  buildPullRequestSections,
  pullRequestRowKey,
  sliceSettled,
} from "@t3tools/client-runtime/_lempire/pull-request-sections";
import type { EnvironmentId, PullRequestListEntry } from "@t3tools/contracts";

/** A listing row plus the environment that answered for it. */
export type PullRequestFeedEntry = PullRequestListEntry & {
  readonly environmentId: EnvironmentId;
};

/** One environment's answer to one involvement bucket. */
export interface PullRequestFeedSource {
  readonly environmentId: EnvironmentId;
  readonly entries: ReadonlyArray<PullRequestListEntry>;
}

export type PullRequestFeedItem =
  | { readonly kind: "header"; readonly key: string; readonly label: string }
  | {
      readonly kind: "row";
      readonly key: string;
      readonly entry: PullRequestFeedEntry;
      /** Review requested of the reader: the row wears the mark. */
      readonly needsMe: boolean;
      readonly isFirst: boolean;
      readonly isLast: boolean;
    }
  | { readonly kind: "settled"; readonly key: string; readonly entry: PullRequestFeedEntry }
  | { readonly kind: "more"; readonly key: string; readonly hiddenCount: number };

/**
 * One bucket across environments, stamped and deduplicated. The first answer
 * wins, which is stable because sources are read in environment order: the
 * duplicates describe the same pull request and differ only in which project
 * would host a review of it.
 */
export function mergeFeedBucket(
  sources: ReadonlyArray<PullRequestFeedSource>,
): ReadonlyArray<PullRequestFeedEntry> {
  const byKey = new Map<string, PullRequestFeedEntry>();
  for (const source of sources) {
    for (const entry of source.entries) {
      const key = pullRequestRowKey(entry);
      if (byKey.has(key)) continue;
      byKey.set(key, { ...entry, environmentId: source.environmentId });
    }
  }
  return [...byKey.values()];
}

function rowItems(
  entries: ReadonlyArray<PullRequestFeedEntry>,
  needsMe: boolean,
): ReadonlyArray<PullRequestFeedItem> {
  return entries.map((entry, index) => ({
    kind: "row" as const,
    key: `${entry.environmentId}:${pullRequestRowKey(entry)}`,
    entry,
    needsMe,
    isFirst: index === 0,
    isLast: index === entries.length - 1,
  }));
}

/**
 * The whole feed: buckets from the host's own answers, flattened into the rows
 * the list renders. `needsMe` stays headerless at the top, the way active
 * threads do on Home.
 */
export function buildPullRequestFeed(input: {
  readonly reviewRequested: ReadonlyArray<PullRequestFeedSource>;
  readonly involved: ReadonlyArray<PullRequestFeedSource>;
  readonly mine: ReadonlyArray<PullRequestFeedSource>;
  readonly merged: ReadonlyArray<PullRequestFeedSource>;
  readonly settledExpanded: boolean;
}): {
  readonly items: ReadonlyArray<PullRequestFeedItem>;
  readonly isEmpty: boolean;
} {
  const sections = buildPullRequestSections({
    reviewRequested: mergeFeedBucket(input.reviewRequested),
    involved: mergeFeedBucket(input.involved),
    mine: mergeFeedBucket(input.mine),
    merged: mergeFeedBucket(input.merged),
  });

  const items: PullRequestFeedItem[] = [...rowItems(sections.needsMe, true)];

  if (sections.mine.length > 0) {
    items.push({ kind: "header", key: "header:mine", label: "Your pull requests" });
    items.push(...rowItems(sections.mine, false));
  }
  if (sections.waiting.length > 0) {
    items.push({ kind: "header", key: "header:waiting", label: "Waiting on others" });
    items.push(...rowItems(sections.waiting, false));
  }
  if (sections.settled.length > 0) {
    const { visible, hiddenCount } = sliceSettled(sections.settled, input.settledExpanded);
    items.push({ kind: "header", key: "header:settled", label: "Settled" });
    items.push(
      ...visible.map((entry) => ({
        kind: "settled" as const,
        key: `${entry.environmentId}:${pullRequestRowKey(entry)}`,
        entry,
      })),
    );
    if (hiddenCount > 0) items.push({ kind: "more", key: "settled:more", hiddenCount });
  }

  return { items, isEmpty: items.length === 0 };
}
