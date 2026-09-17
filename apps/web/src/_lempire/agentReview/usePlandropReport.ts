// [FORK] lempire: the review of record for a pull request, and whether it still
// describes the branch.
//
// Reports come from the environment's plandrop lookup rather than from thread
// messages, so a review counts wherever it ran. Staleness prefers the head
// commit the review read; a report published before the uploader recorded one
// falls back to the timestamp estimate.
import { createPlandropReportsAtomFamily } from "@t3tools/client-runtime/_lempire/plandrop-reports";
import type { EnvironmentId, PlandropReport, PullRequestDetailView } from "@t3tools/contracts";
import { useMemo } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { reviewStartedAt, isReviewStale } from "./reviewStaleness";

const plandropReportsAtom = createPlandropReportsAtomFamily(connectionAtomRuntime);

export interface PullRequestReview {
  readonly report: PlandropReport;
  /** The commit that outdated the review, or null when it still covers the branch. */
  readonly stalePushedAt: string | null;
}

/** Head commit of the pull request: the newest one the detail carries. */
function headCommit(
  detail: PullRequestDetailView,
): { readonly oid: string; readonly committedDate: string } | null {
  let head: { oid: string; committedDate: string } | null = null;
  for (const commit of detail.commits) {
    if (head === null || commit.committedDate >= head.committedDate) {
      head = { oid: commit.oid, committedDate: commit.committedDate };
    }
  }
  return head;
}

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

  return useMemo(() => {
    if (report === null) return null;
    const head = activityPending ? null : headCommit(detail);
    if (head === null) return { report, stalePushedAt: null };
    const stale =
      report.headSha === undefined
        ? isReviewStale(head.committedDate, reviewStartedAt(report.generatedAt, null))
        : report.headSha !== head.oid;
    return { report, stalePushedAt: stale ? head.committedDate : null };
  }, [report, detail, activityPending]);
}
