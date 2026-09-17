// [FORK] lempire: agent-review card at the top of upstream's PR summary tab.
//
// The /test-and-review flow publishes its report to plandrop (plans.gawaak.ovh)
// and drops the URL in the review thread. This card finds the PR's review
// threads through their pull-request link, collects the plandrop URLs their
// messages mention, and renders the newest one that carries a companion
// `meta.json` as a verdict ribbon + crit/warn/good tiles, flagged stale when a
// commit landed after the review started. That `meta.json` is what makes a URL a
// review: plans and other artifacts publish to the same host and land in the
// same threads, so the URL shape alone proves nothing. Renders nothing for a PR
// with no review thread.
import type {
  EnvironmentId,
  PullRequestDetailView,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  BotIcon,
  ExternalLinkIcon,
  FileChartColumnIcon,
  HistoryIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { matchesLinkedPullRequestUrl } from "../../lib/openPullRequestLink";
import { useThreadMessages, useThreadShells } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

const PLANDROP_URL_RE = /https:\/\/plans\.gawaak\.ovh\/p\/[\w-]+\/[\w-]+\/?/g;

type VerdictState = "ok" | "warn" | "crit";

interface ReportSource {
  readonly name: string;
  readonly crit: number;
  readonly warn: number;
  readonly good: number;
}

interface ReportMeta {
  readonly title: string | null;
  readonly verdict: { readonly state: VerdictState; readonly label: string } | null;
  readonly sources: ReadonlyArray<ReportSource>;
}

/** `null` = no readable meta.json, so the page is not a review report. */
type MetaFetchResult = ReportMeta | null;

const metaCache = new Map<string, Promise<MetaFetchResult>>();

function parseMeta(raw: unknown): MetaFetchResult {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (value.schema !== 1) return null;
  const verdictRaw = value.verdict as Record<string, unknown> | undefined;
  const stateRaw = verdictRaw?.state;
  const state: VerdictState | null =
    stateRaw === "ok" || stateRaw === "warn" || stateRaw === "crit" ? stateRaw : null;
  const verdict =
    state !== null && typeof verdictRaw?.label === "string"
      ? { state, label: verdictRaw.label }
      : null;
  const sources = Array.isArray(value.sources)
    ? value.sources.flatMap((entry: unknown): ReportSource[] => {
        if (typeof entry !== "object" || entry === null) return [];
        const source = entry as Record<string, unknown>;
        if (typeof source.name !== "string") return [];
        return [
          {
            name: source.name,
            crit: typeof source.crit === "number" ? source.crit : 0,
            warn: typeof source.warn === "number" ? source.warn : 0,
            good: typeof source.good === "number" ? source.good : 0,
          },
        ];
      })
    : [];
  return {
    title: typeof value.title === "string" ? value.title : null,
    verdict,
    sources,
  };
}

function fetchMeta(reportUrl: string): Promise<MetaFetchResult> {
  const cached = metaCache.get(reportUrl);
  if (cached) return cached;
  const promise = fetch(`${reportUrl.replace(/\/$/, "")}/meta.json`)
    .then((response) => (response.ok ? response.json() : null))
    .then((json: unknown) => (json === null ? null : parseMeta(json)))
    .catch(() => null);
  metaCache.set(reportUrl, promise);
  return promise;
}

/** A full agent review never finishes faster than this. */
const MIN_REVIEW_DURATION_MS = 15 * 60_000;

/** One plandrop URL seen in a review thread, before `meta.json` vouches for it. */
interface Report {
  readonly url: string;
  /** When the report message landed in the thread — the age shown in the header. */
  readonly postedAt: string;
  /** Prompt that kicked off this run, when one precedes the report message. */
  readonly kickoffAt: string | null;
}

/** Candidate URLs kept per thread, newest first; `meta.json` decides between them. */
const MAX_REPORT_CANDIDATES = 5;

/**
 * Plandrop URLs in the PR's review-thread messages, newest first, plus the
 * timestamps around each. The message's own `createdAt` is the review's age (the
 * thread's `updatedAt` keeps moving with later chatter); the nearest preceding
 * user message is where that run started reading code. Several candidates come
 * back because a thread also publishes plans and briefings to plandrop, and only
 * fetching `meta.json` tells those apart from a report.
 */
export function extractReports(
  messages: ReadonlyArray<{
    readonly text: string;
    readonly role: string;
    readonly createdAt: string;
  }>,
): ReadonlyArray<Report> {
  const found: Report[] = [];
  for (let i = messages.length - 1; i >= 0 && found.length < MAX_REPORT_CANDIDATES; i -= 1) {
    const message = messages[i];
    if (!message) continue;
    const matches = message.text.match(PLANDROP_URL_RE);
    if (!matches) continue;
    let kickoffAt: string | null = null;
    for (let j = i - 1; j >= 0; j -= 1) {
      const earlier = messages[j];
      if (earlier?.role === "user") {
        kickoffAt = earlier.createdAt;
        break;
      }
    }
    // Within one message the trailing URL is the conclusion, so it goes first.
    for (const match of matches.toReversed()) {
      found.push({ url: match.replace(/\/$/, ""), postedAt: message.createdAt, kickoffAt });
      if (found.length === MAX_REPORT_CANDIDATES) break;
    }
  }
  return found;
}

/**
 * Newest candidate that turns out to have a `meta.json`. Resolved here rather
 * than in the card so the stale check and the tiles describe the same report.
 */
function useResolvedReport(
  candidates: ReadonlyArray<Report>,
): { readonly report: Report; readonly meta: ReportMeta } | null {
  const [resolved, setResolved] = useState<{ report: Report; meta: ReportMeta } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const candidate of candidates) {
        const meta = await fetchMeta(candidate.url);
        if (cancelled) return;
        if (meta !== null) {
          setResolved({ report: candidate, meta });
          return;
        }
      }
      // Keep no stale winner around: every candidate lost its meta or went away.
      if (!cancelled) setResolved(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [candidates]);
  return resolved;
}

/**
 * Epoch ms of the moment the review started looking at the code — the cutoff a
 * push has to beat to be covered. A review takes at least
 * `MIN_REVIEW_DURATION_MS`, so the report's own timestamp is far too late to
 * compare against: a push mid-review would look reviewed. Prefer the kickoff
 * prompt, and never assume a run shorter than the floor (a "kickoff" only a
 * couple of minutes before the report is some follow-up message, not the start).
 * `NaN` when neither timestamp parses.
 */
export function reviewStartedAt(postedAt: string, kickoffAt: string | null): number {
  const posted = Date.parse(postedAt);
  if (Number.isNaN(posted)) return Number.NaN;
  const latestPlausibleStart = posted - MIN_REVIEW_DURATION_MS;
  const kickoff = kickoffAt === null ? Number.NaN : Date.parse(kickoffAt);
  return Number.isNaN(kickoff) ? latestPlausibleStart : Math.min(kickoff, latestPlausibleStart);
}

/**
 * True when the branch's newest commit landed after the review started reading,
 * i.e. the report describes code that has since moved. The two timestamps come
 * from different clocks (the review from this server, the commit from whoever
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

// `warn` is "mergeable with reserves" — amber, not a red alarm. Only `crit`
// (not mergeable) gets the red band and the ✗.
const RIBBON_STYLES: Record<VerdictState, string> = {
  ok: "bg-emerald-600 text-white",
  warn: "bg-amber-500 text-amber-950",
  crit: "bg-red-700 text-white",
};

const RIBBON_MARKS: Record<VerdictState, string> = { ok: "✓", warn: "⚠", crit: "✗" };

const TILE_STYLES = {
  crit: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  warn: "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  good: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
} as const;

// A count of zero carries no severity, so it drops to plain muted chrome: the
// colored tiles are exactly the ones holding a number, readable at a glance
// without parsing the digits.
const EMPTY_TILE_STYLE = "border-border/60 bg-muted/20 text-muted-foreground/60";

function ReportTiles({ sources }: { sources: ReadonlyArray<ReportSource> }) {
  return (
    <div className="grid grid-cols-3 gap-2 p-3">
      {sources.flatMap((source) =>
        (
          [
            ["crit", source.crit],
            ["warn", source.warn],
            ["good", source.good],
          ] as const
        ).map(([kind, count]) => (
          <div
            key={`${source.name}-${kind}`}
            className={cn(
              "rounded-lg border px-2 py-1.5 text-center",
              count > 0 ? TILE_STYLES[kind] : EMPTY_TILE_STYLE,
            )}
          >
            <div className="text-lg font-bold tabular-nums">{count}</div>
            <div className="text-[9px] font-semibold uppercase tracking-wider opacity-70">
              {source.name} · {kind === "good" ? "Good" : kind === "warn" ? "Warn" : "Crit"}
            </div>
          </div>
        )),
      )}
    </div>
  );
}

const ReportCardBody = memo(function ReportCardBody({
  reportUrl,
  meta,
  updatedAt,
  stalePushedAt,
  onOpenExternal,
}: {
  reportUrl: string;
  meta: ReportMeta;
  updatedAt: string | null;
  /** Relative time of the push that outdated this review, or null when fresh. */
  stalePushedAt: string | null;
  onOpenExternal?: ((url: string) => void) | undefined;
}) {
  const open = () => {
    if (onOpenExternal) onOpenExternal(reportUrl);
    else window.open(reportUrl, "_blank", "noopener,noreferrer");
  };

  const isStale = stalePushedAt !== null;

  const header = (
    <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-muted-foreground">
      <FileChartColumnIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="font-medium">Your review of this PR</span>
      {updatedAt ? <span>· {updatedAt}</span> : null}
      {isStale ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-300">
          <HistoryIcon className="size-2.5" aria-hidden="true" />
          Stale
        </span>
      ) : null}
      <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground/70">
        plans.gawaak.ovh
        <ExternalLinkIcon className="size-3" aria-hidden="true" />
      </span>
    </div>
  );

  // Say it in words too — the badge alone doesn't explain why the numbers below
  // can't be trusted.
  const staleNotice = isStale ? (
    <div className="flex items-start gap-1.5 border-t border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
      <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
      <span>
        New code was pushed {stalePushedAt}, after this review started — it may not cover the
        current state of the branch. Re-run it to be sure.
      </span>
    </div>
  ) : null;

  const frame = cn(
    "block w-full max-w-2xl overflow-hidden rounded-xl border text-left transition-colors",
    isStale
      ? "border-amber-500/40 hover:border-amber-500/60"
      : "border-border/70 hover:border-border",
  );

  return (
    <button type="button" onClick={open} className={frame}>
      {header}
      {staleNotice}
      {meta.verdict ? (
        <div
          className={cn(
            "px-3 py-1.5 text-xs font-bold uppercase tracking-wider",
            RIBBON_STYLES[meta.verdict.state],
            // A stale verdict shouldn't shout as loudly as a current one.
            isStale && "opacity-60",
          )}
        >
          {RIBBON_MARKS[meta.verdict.state]} {meta.verdict.label}
        </div>
      ) : null}
      {meta.sources.length > 0 ? (
        <div className={cn(isStale && "opacity-60")}>
          <ReportTiles sources={meta.sources} />
        </div>
      ) : null}
    </button>
  );
});

function threadStatus(thread: EnvironmentThreadShell): { label: string; className: string } {
  if (thread.session?.status === "running") return { label: "Running", className: "text-blue-500" };
  if (thread.session?.status === "error") return { label: "Error", className: "text-destructive" };
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) {
    return { label: "Waiting", className: "text-amber-500" };
  }
  return { label: "Idle", className: "text-muted-foreground" };
}

function latestCommitAt(detail: PullRequestDetailView): string | null {
  let latest: string | null = null;
  for (const commit of detail.commits) {
    if (latest === null || commit.committedDate > latest) latest = commit.committedDate;
  }
  return latest;
}

/** Linked threads whose messages are scanned for a report; fix threads on the PR branch match too. */
const REPORT_PROBE_LIMIT = 5;

/**
 * Subscribes to one thread's messages and hands its report candidates up. A
 * component rather than a loop because each thread needs its own atom hook.
 */
function ThreadReportProbe({
  threadRef,
  onReports,
}: {
  threadRef: ScopedThreadRef;
  onReports: (threadId: ThreadId, reports: ReadonlyArray<Report>) => void;
}) {
  const messages = useThreadMessages(threadRef);
  const reports = useMemo(() => extractReports(messages), [messages]);
  useEffect(() => {
    onReports(threadRef.threadId, reports);
  }, [onReports, reports, threadRef.threadId]);
  return null;
}

export function AgentReviewCard({
  environmentId,
  detail,
  activityPending,
  onOpenExternal,
}: {
  environmentId: EnvironmentId;
  detail: PullRequestDetailView;
  /** Commits ride on the activity half of the detail; no stale verdict until it has loaded. */
  activityPending: boolean;
  onOpenExternal?: ((url: string) => void) | undefined;
}) {
  const allThreads = useThreadShells();
  const navigate = useNavigate();

  // Review threads are the ones linked to this PR (explicitly, or through the
  // branch they run on), newest first.
  const reviewThreads = useMemo(() => {
    const candidates = allThreads.filter((thread) => {
      if (thread.environmentId !== environmentId || thread.archivedAt !== null) return false;
      const linked = thread.linkedPullRequest ?? thread.branchPullRequest;
      return linked != null && matchesLinkedPullRequestUrl(linked, detail.url);
    });
    return candidates.sort((a, b) =>
      (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt),
    );
  }, [allThreads, environmentId, detail.url]);

  const probedRefs = useMemo(
    () =>
      reviewThreads
        .slice(0, REPORT_PROBE_LIMIT)
        .map((thread) => scopeThreadRef(thread.environmentId, thread.id)),
    [reviewThreads],
  );

  const [reports, setReports] = useState<ReadonlyMap<ThreadId, ReadonlyArray<Report>>>(new Map());
  const onReports = useCallback((threadId: ThreadId, found: ReadonlyArray<Report>) => {
    setReports((current) => {
      const existing = current.get(threadId);
      if (found.length === 0 ? existing === undefined : existing === found) return current;
      const next = new Map(current);
      if (found.length === 0) next.delete(threadId);
      else next.set(threadId, found);
      return next;
    });
  }, []);

  // Candidates from every probed thread, newest first — not just the newest
  // thread's: a fix thread on the PR branch is usually younger than the review
  // that found it.
  const candidates = useMemo(() => {
    const ordered = [...reports.values()]
      .flat()
      .sort((a, b) => b.postedAt.localeCompare(a.postedAt));
    const seen = new Set<string>();
    const unique: Report[] = [];
    for (const candidate of ordered) {
      if (seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      unique.push(candidate);
      if (unique.length === MAX_REPORT_CANDIDATES) break;
    }
    return unique;
  }, [reports]);

  const resolved = useResolvedReport(candidates);
  const report = resolved?.report ?? null;

  const lastCommitAt = activityPending ? null : latestCommitAt(detail);
  const stalePushedAt = useMemo(() => {
    if (!report) return null;
    const startedAt = reviewStartedAt(report.postedAt, report.kickoffAt);
    return isReviewStale(lastCommitAt, startedAt) ? relativeTime(lastCommitAt) : null;
  }, [report, lastCommitAt]);

  if (reviewThreads.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 border-b border-border/70 px-4 py-3">
      {probedRefs.map((threadRef) => (
        <ThreadReportProbe key={threadRef.threadId} threadRef={threadRef} onReports={onReports} />
      ))}
      {resolved !== null ? (
        <ReportCardBody
          reportUrl={resolved.report.url}
          meta={resolved.meta}
          updatedAt={relativeTime(resolved.report.postedAt)}
          stalePushedAt={stalePushedAt}
          onOpenExternal={onOpenExternal}
        />
      ) : null}
      <ul className="flex flex-col gap-1">
        {reviewThreads.map((thread) => {
          const status = threadStatus(thread);
          return (
            <li key={thread.id}>
              <button
                type="button"
                onClick={() =>
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
                  })
                }
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-muted/50"
              >
                <BotIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {thread.title}
                </span>
                <span className={cn("shrink-0 text-[11px] font-medium", status.className)}>
                  {status.label}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {relativeTime(thread.updatedAt ?? thread.createdAt)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function relativeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const then = Date.parse(value);
  if (Number.isNaN(then)) return null;
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
