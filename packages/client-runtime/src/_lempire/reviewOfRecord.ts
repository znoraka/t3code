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
  /**
   * The verdict was reached with the pull request's commits in hand, so
   * `stalePushedAt` is an answer rather than the absence of one. False while the
   * activity is still loading, and on a host that carried no commits at all.
   */
  readonly exact: boolean;
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
  if (head === null) return { report, stalePushedAt: null, exact: false };
  const stale =
    report.headSha === undefined
      ? isReviewStale(head.committedDate, reviewStartedAt(report.generatedAt, null))
      : report.headSha !== head.oid;
  return { report, stalePushedAt: stale ? head.committedDate : null, exact: true };
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
  /** The row's last update, as the badge read it: what an exact answer has to cover. */
  readonly updatedAt: string;
}

/**
 * The badge for one listed pull request. Staleness starts as a weaker claim than
 * the detail card's: a listing carries no commits, only `updatedAt`, which a
 * comment moves as surely as a push does. So a stale badge means "something
 * happened after this review" until the card has been opened and answered
 * properly, which `applyKnownReviewStaleness` folds back in.
 */
export function resolveRowReviewBadge(report: PlandropReport, updatedAt: string): ReviewRowBadge {
  return {
    state: report.verdict?.state ?? null,
    stale: isReviewStale(updatedAt, reviewStartedAt(report.generatedAt, null)),
    report,
    updatedAt,
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

/**
 * What opening a pull request taught the list about its review. The detail holds
 * the branch's commits and can say exactly whether the report still describes
 * them; a row holds only `updatedAt`, which a comment moves as surely as a push
 * does — including the comment the review itself posts. So the detail's answer
 * is carried back, and outranks the row's estimate for as long as it applies.
 */
export interface KnownReviewStaleness {
  /** The report that was judged: a newer review arrives with its own question. */
  readonly reportUrl: string;
  /** The pull request's `updatedAt` as the detail read it. */
  readonly updatedAt: string;
  readonly stale: boolean;
}

/** True when an exact answer read the row's update, or something later than it. */
function covers(answer: KnownReviewStaleness, badge: ReviewRowBadge): boolean {
  const known = Date.parse(answer.updatedAt);
  const row = Date.parse(badge.updatedAt);
  return !Number.isNaN(known) && !Number.isNaN(row) && known >= row;
}

/**
 * Badges with the exact answers folded in where one is known and still applies.
 * A row that has moved on since the detail read it keeps the estimate: whether
 * that movement was a push is precisely what the old answer cannot vouch for.
 *
 * Returns the very same map when nothing changed, so a list nobody has opened a
 * pull request from renders no differently for having asked.
 */
export function applyKnownReviewStaleness(
  badges: ReadonlyMap<string, ReviewRowBadge>,
  known: ReadonlyMap<string, KnownReviewStaleness>,
): ReadonlyMap<string, ReviewRowBadge> {
  if (badges.size === 0 || known.size === 0) return badges;
  let corrected: Map<string, ReviewRowBadge> | null = null;
  for (const [key, badge] of badges) {
    const answer = known.get(key);
    if (answer === undefined || answer.stale === badge.stale) continue;
    if (answer.reportUrl !== badge.report.url || !covers(answer, badge)) continue;
    corrected ??= new Map(badges);
    corrected.set(key, { ...badge, stale: answer.stale });
  }
  return corrected ?? badges;
}
