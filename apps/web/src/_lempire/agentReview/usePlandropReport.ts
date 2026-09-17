// [FORK] lempire: the review of record for a pull request, read over this
// client's socket.
//
// Reports come from the environment's plandrop lookup rather than from thread
// messages, so a review counts wherever it ran. The decision itself — newest
// report, whether the branch has moved past the commit it read, and what an
// empty or failed answer is allowed to claim — is shared with the mobile card in
// `@t3tools/client-runtime/_lempire/review-of-record`.
import {
  createPlandropReportsAtomFamily,
  REPORTS_STALE_TIME_MS,
} from "@t3tools/client-runtime/_lempire/plandrop-reports";
import {
  resolveReviewLookup,
  type PullRequestReview,
  type ReviewLookup,
} from "@t3tools/client-runtime/_lempire/review-of-record";
import type { EnvironmentId, PullRequestDetailView } from "@t3tools/contracts";
import { useEffect, useMemo, useRef } from "react";

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
  useEffect(() => {
    lastRefreshedAtRef.current = Date.now();
  }, []);
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
): { readonly lookup: ReviewLookup; readonly retry: () => void } {
  const query = useEnvironmentQuery(
    plandropReportsAtom({
      environmentId,
      input: { repository: detail.repository, number: detail.number },
    }),
  );
  const { data, error, refresh } = query;
  useRefreshWhenVisible(refresh);

  const lookup = useMemo(
    () =>
      resolveReviewLookup({
        result: data,
        error,
        commits: detail.commits,
        activityPending,
      }),
    [data, error, detail.commits, activityPending],
  );

  return { lookup, retry: refresh };
}
