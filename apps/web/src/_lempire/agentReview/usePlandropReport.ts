// [FORK] lempire: the review of record for a pull request, read from the environment's
// plandrop lookup so a review counts wherever it ran. The decision logic is shared with
// mobile in `@t3tools/client-runtime/_lempire/review-of-record`.
import {
  createPlandropReportsAtomFamily,
  REPORTS_STALE_TIME_MS,
} from "@t3tools/client-runtime/_lempire/plandrop-reports";
import {
  resolveReviewLookup,
  reviewBadgeKey,
  type PullRequestReview,
  type ReviewLookup,
} from "@t3tools/client-runtime/_lempire/review-of-record";
import { recordReviewStaleness } from "@t3tools/client-runtime/_lempire/review-staleness-store";
import type { EnvironmentId, PullRequestDetailView } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";

const plandropReportsAtom = createPlandropReportsAtomFamily(connectionAtomRuntime);

export type { PullRequestReview, ReviewLookup };

/**
 * Re-reads the lookup when a hidden tab is looked at again and its answer has
 * gone stale. The atom revalidates on mount, and a pull request left open in a
 * background tab never mounts again — the review of record is precisely the
 * field that changes while nobody is watching.
 */
function useRefreshWhenVisible(refresh: () => void): void {
  const lastRefreshedAtRef = useRef(0);
  // Mount reads through the atom's own revalidation: the window starts there.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- stamps the mount time read by the visibility listener
  useEffect(() => {
    lastRefreshedAtRef.current = Date.now();
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to document visibilitychange
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefreshedAtRef.current < REPORTS_STALE_TIME_MS) return;
      lastRefreshedAtRef.current = now;
      refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refresh]);
}

export function useReviewOfRecord(
  environmentId: EnvironmentId,
  detail: PullRequestDetailView,
  /** Commits ride on the activity half of the detail; no verdict on staleness until it lands. */
  activityPending: boolean,
): {
  readonly lookup: ReviewLookup;
  readonly refresh: () => void;
  readonly refreshing: boolean;
} {
  const query = useEnvironmentQuery(
    plandropReportsAtom({
      environmentId,
      input: { repository: detail.repository, number: detail.number },
    }),
  );
  const { data, error, refresh, isPending } = query;
  useRefreshWhenVisible(refresh);

  const lookup = resolveReviewLookup({
    result: data,
    error,
    commits: detail.commits,
    activityPending,
  });

  useAnswerRowBadge(lookup, detail);

  return { lookup, refresh, refreshing: isPending };
}

/**
 * Hands the list the answer this page just worked out. A row only has
 * `updatedAt` to go on and has to read the review's own comment as possible new
 * code; the card has the commits and knows, so what it knows goes back to the
 * row that was guessing.
 */
function useAnswerRowBadge(lookup: ReviewLookup, detail: PullRequestDetailView): void {
  const { repository, number, updatedAt } = detail;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes this page's answer to the list's external badge store
  useEffect(() => {
    if (lookup.state !== "reviewed" || !lookup.review.exact) return;
    recordReviewStaleness(reviewBadgeKey({ repository, number }), {
      reportUrl: lookup.review.report.url,
      updatedAt,
      stale: lookup.review.stalePushedAt !== null,
    });
  }, [lookup, repository, number, updatedAt]);
}
