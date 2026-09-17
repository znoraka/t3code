// [FORK] lempire: does a review still describe the branch it read?
//
// Only used when the report predates `pr.headSha` in plandrop's index; with a
// head sha the question is answered by comparing commits, not clocks.

/** A full agent review never finishes faster than this. */
const MIN_REVIEW_DURATION_MS = 15 * 60_000;

/**
 * Epoch ms of the moment the review started looking at the code — the cutoff a
 * push has to beat to be covered. A review takes at least
 * `MIN_REVIEW_DURATION_MS`, so the report's own timestamp is far too late to
 * compare against: a push mid-review would look reviewed. Prefer a known start,
 * and never assume a run shorter than the floor (a "start" only a couple of
 * minutes before the report is some follow-up, not the beginning).
 * `NaN` when neither timestamp parses.
 */
export function reviewStartedAt(finishedAt: string, startedAt: string | null): number {
  const finished = Date.parse(finishedAt);
  if (Number.isNaN(finished)) return Number.NaN;
  const latestPlausibleStart = finished - MIN_REVIEW_DURATION_MS;
  const started = startedAt === null ? Number.NaN : Date.parse(startedAt);
  return Number.isNaN(started) ? latestPlausibleStart : Math.min(started, latestPlausibleStart);
}

/**
 * True when the branch's newest commit landed after the review started reading,
 * i.e. the report describes code that has since moved. The two timestamps come
 * from different clocks (the review from whoever ran it, the commit from whoever
 * authored it), so a sub-minute gap is treated as skew rather than a new push.
 */
export function isReviewStale(
  lastCommitAt: string | null | undefined,
  reviewStartMs: number,
): boolean {
  if (!lastCommitAt || Number.isNaN(reviewStartMs)) return false;
  const pushed = Date.parse(lastCommitAt);
  if (Number.isNaN(pushed)) return false;
  return pushed - reviewStartMs >= 60_000;
}
