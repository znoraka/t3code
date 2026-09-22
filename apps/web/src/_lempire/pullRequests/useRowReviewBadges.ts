// [FORK] lempire: one review lookup for a whole pull-request list.
//
// The badge answers "have I already reviewed this" from the same plandrop index
// the detail card reads, but a list cannot afford a query per row: the
// environment fans the lookups out itself (see the server's
// `_lempire/PlandropReports`) and the list asks once. What a badge may claim is
// shared with mobile in `@t3tools/client-runtime/_lempire/review-of-record`.
import { createPlandropListReportsAtomFamily } from "@t3tools/client-runtime/_lempire/plandrop-reports";
import {
  applyKnownReviewStaleness,
  buildRowReviewBadges,
  reviewBadgeKey,
  type ReviewRowBadge,
} from "@t3tools/client-runtime/_lempire/review-of-record";
import {
  reviewStalenessSnapshot,
  subscribeReviewStaleness,
} from "@t3tools/client-runtime/_lempire/review-staleness-store";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo, useSyncExternalStore } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";

const plandropListReportsAtom = createPlandropListReportsAtomFamily(connectionAtomRuntime);

export interface ReviewBadgeRow {
  readonly repository: string;
  readonly number: number;
  readonly updatedAt: string;
}

/**
 * A badge per row that has a review, keyed by `reviewBadgeKey`. Rows are sorted
 * into the request so that scrolling a list, or the host re-ordering it by
 * activity, reuses the answer already in hand rather than asking again.
 */
export function useRowReviewBadges(
  environmentId: EnvironmentId,
  rows: ReadonlyArray<ReviewBadgeRow>,
): ReadonlyMap<string, ReviewRowBadge> {
  const pullRequests = useMemo(
    () =>
      [...new Map(rows.map((row) => [reviewBadgeKey(row), row])).values()]
        .map((row) => ({ repository: row.repository, number: row.number }))
        .sort((a, b) => a.repository.localeCompare(b.repository) || a.number - b.number),
    [rows],
  );
  const { data } = useEnvironmentQuery(
    useMemo(
      () =>
        pullRequests.length === 0
          ? null
          : plandropListReportsAtom({ environmentId, input: { pullRequests } }),
      [environmentId, pullRequests],
    ),
  );
  // Rows a card has already answered for keep that answer over the estimate.
  const known = useSyncExternalStore(
    subscribeReviewStaleness,
    reviewStalenessSnapshot,
    reviewStalenessSnapshot,
  );
  return useMemo(
    () => applyKnownReviewStaleness(buildRowReviewBadges(data, rows), known),
    [data, rows, known],
  );
}
