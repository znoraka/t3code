// [FORK] lempire: the review of record for a pull request, read over this
// client's socket.
//
// Reports come from the environment's plandrop lookup rather than from thread
// messages, so a review counts wherever it ran. The decision itself — newest
// report, and whether the branch has moved past the commit it read — is shared
// with the mobile card in `@t3tools/client-runtime/_lempire/review-of-record`.
import { createPlandropReportsAtomFamily } from "@t3tools/client-runtime/_lempire/plandrop-reports";
import {
  resolveReviewOfRecord,
  type PullRequestReview,
} from "@t3tools/client-runtime/_lempire/review-of-record";
import type { EnvironmentId, PullRequestDetailView } from "@t3tools/contracts";
import { useMemo } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";

const plandropReportsAtom = createPlandropReportsAtomFamily(connectionAtomRuntime);

export type { PullRequestReview };

export function useReviewOfRecord(
  environmentId: EnvironmentId,
  detail: PullRequestDetailView,
  /** Commits ride on the activity half of the detail; no verdict on staleness until it lands. */
  activityPending: boolean,
): PullRequestReview | null {
  const query = useEnvironmentQuery(
    plandropReportsAtom({
      environmentId,
      input: { repository: detail.repository, number: detail.number },
    }),
  );
  const report = query.data?.reports[0] ?? null;

  return useMemo(
    () => resolveReviewOfRecord({ report, commits: detail.commits, activityPending }),
    [report, detail.commits, activityPending],
  );
}
