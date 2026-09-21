// [FORK] lempire: the review of record for a pull request, and whether it still
// describes the branch.
//
// Reports come from the environment's plandrop lookup rather than from thread
// messages, so a review counts wherever it ran. Staleness prefers the head
// commit the review read; a report published before the uploader recorded one
// falls back to the timestamp estimate below. Shared so the web card and the
// mobile card cannot hold two opinions about what "stale" means.
import type {
  PlandropListReportsResult,
  PlandropReport,
  PlandropReportsResult,
  PlandropVerdictState,
} from "@t3tools/contracts";

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

/**
 * What a card can honestly say about a pull request's review. An empty index is
 * only "nobody has reviewed this" when the environment actually answered: a
 * lookup still in flight, one the environment could not answer, and one the host
 * has no credential for each look identical in the data and must not be reported
 * as an unreviewed pull request.
 */
export type ReviewLookup =
  | { readonly state: "reviewed"; readonly review: PullRequestReview }
  | { readonly state: "looking" }
  /** The environment or plandrop could not answer; `reason` is worth showing. */
  | { readonly state: "unavailable"; readonly reason: string }
  | { readonly state: "unreviewed" }
  /** This host holds no plandrop credential, so the card says nothing at all. */
  | { readonly state: "unconfigured" };

/**
 * The query's answer, read as something a card can render. A report already in
 * hand outranks a failed revalidation: the verdict a client is showing does not
 * disappear because the next refresh could not reach the host.
 */
export function resolveReviewLookup(input: {
  readonly result: PlandropReportsResult | null;
  /** The query's failure, already formatted for a human, or null. */
  readonly error: string | null;
  readonly commits: ReadonlyArray<ReviewedCommit>;
  readonly activityPending: boolean;
}): ReviewLookup {
  const review =
    input.result === null
      ? null
      : resolveReviewOfRecord({
          report: input.result.reports[0] ?? null,
          commits: input.commits,
          activityPending: input.activityPending,
        });
  if (review !== null) return { state: "reviewed", review };
  if (input.error !== null) return { state: "unavailable", reason: input.error };
  if (input.result === null) return { state: "looking" };
  return input.result.configured ? { state: "unreviewed" } : { state: "unconfigured" };
}

/** What a list row can show about its review: the verdict, and whether to trust it. */
export interface ReviewRowBadge {
  /** The verdict the review reached, or null for a report this fork cannot read one from. */
  readonly state: PlandropVerdictState | null;
  /** The review predates the pull request's last update, so it may not describe it. */
  readonly stale: boolean;
  readonly report: PlandropReport;
}

/**
 * The badge for one listed pull request. Staleness is a weaker claim than the
 * detail card's: a listing carries no commits, only `updatedAt`, which a comment
 * moves as surely as a push does. So a stale badge means "something happened
 * after this review", and the card is where the exact answer lives.
 */
export function resolveRowReviewBadge(report: PlandropReport, updatedAt: string): ReviewRowBadge {
  return {
    state: report.verdict?.state ?? null,
    stale: isReviewStale(updatedAt, reviewStartedAt(report.generatedAt, null)),
    report,
  };
}

/** How a row finds its badge. Repositories are compared case-insensitively, as hosts do. */
export function reviewBadgeKey(reference: {
  readonly repository: string;
  readonly number: number;
}): string {
  return `${reference.repository.toLowerCase()}#${reference.number}`;
}

/**
 * A badge per listed pull request that has a review, keyed by
 * `reviewBadgeKey`. Rows the lookup said nothing about are simply absent: no
 * review, no failed lookup to explain, nothing to draw.
 */
export function buildRowReviewBadges(
  result: PlandropListReportsResult | null,
  rows: ReadonlyArray<{
    readonly repository: string;
    readonly number: number;
    readonly updatedAt: string;
  }>,
): ReadonlyMap<string, ReviewRowBadge> {
  if (result === null || result.entries.length === 0) return new Map();
  const updatedAt = new Map(rows.map((row) => [reviewBadgeKey(row), row.updatedAt]));
  return new Map(
    result.entries.flatMap((found) => {
      const key = reviewBadgeKey(found);
      const rowUpdatedAt = updatedAt.get(key);
      return rowUpdatedAt === undefined
        ? []
        : [[key, resolveRowReviewBadge(found.report, rowUpdatedAt)] as const];
    }),
  );
}
