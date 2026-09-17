// [FORK] lempire: the review of record for a pull request, and whether it still
// describes the branch.
//
// Reports come from the environment's plandrop lookup rather than from thread
// messages, so a review counts wherever it ran. Staleness prefers the head
// commit the review read; a report published before the uploader recorded one
// falls back to the timestamp estimate below. Shared so the web card and the
// mobile card cannot hold two opinions about what "stale" means.
import type { PlandropReport } from "@t3tools/contracts";

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

export interface PullRequestReview {
  readonly report: PlandropReport;
  /** The commit that outdated the review, or null when it still covers the branch. */
  readonly stalePushedAt: string | null;
}

/** One commit as both clients carry it: the activity half of a pull request detail. */
interface ReviewedCommit {
  readonly oid: string;
  readonly committedDate: string;
}

/** Head commit of the pull request: the newest one the activity carries. */
function headCommit(commits: ReadonlyArray<ReviewedCommit>): ReviewedCommit | null {
  let head: ReviewedCommit | null = null;
  for (const commit of commits) {
    if (head === null || commit.committedDate >= head.committedDate) {
      head = { oid: commit.oid, committedDate: commit.committedDate };
    }
  }
  return head;
}

/**
 * The newest report for a pull request, with the push that outdated it where
 * there is one. Commits ride on the slower activity half of a detail, so a
 * caller still waiting for them passes `activityPending` and gets the report
 * without a staleness claim rather than a wrong one.
 */
export function resolveReviewOfRecord(input: {
  readonly report: PlandropReport | null;
  readonly commits: ReadonlyArray<ReviewedCommit>;
  readonly activityPending: boolean;
}): PullRequestReview | null {
  const { report } = input;
  if (report === null) return null;
  const head = input.activityPending ? null : headCommit(input.commits);
  if (head === null) return { report, stalePushedAt: null };
  const stale =
    report.headSha === undefined
      ? isReviewStale(head.committedDate, reviewStartedAt(report.generatedAt, null))
      : report.headSha !== head.oid;
  return { report, stalePushedAt: stale ? head.committedDate : null };
}
