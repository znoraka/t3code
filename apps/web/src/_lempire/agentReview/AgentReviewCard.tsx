// [FORK] lempire: agent-review card at the top of upstream's PR summary tab.
//
// /test-and-review publishes its verdict to plandrop as a data-only `meta.json`
// artifact, and plandrop indexes those by pull request. The environment reads
// that index (see the server's `_lempire/PlandropReports`), so the card shows
// the review of record for this PR even when the run happened on another
// machine or in a thread nobody linked — which is the normal case. It renders a
// verdict ribbon + crit/warn/good tiles, flagged stale when the branch moved
// past the commit the review read, above the list of this PR's review threads.
import type { EnvironmentId, PlandropReport, PullRequestDetailView } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  BotIcon,
  ExternalLinkIcon,
  FileChartColumnIcon,
  HistoryIcon,
} from "lucide-react";
import { memo, useMemo } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";
import { matchesLinkedPullRequestUrl } from "../../lib/openPullRequestLink";
import { useThreadShells } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useReviewOfRecord } from "./usePlandropReport";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

// `warn` is "mergeable with reserves" — amber, not a red alarm. Only `crit`
// (not mergeable) gets the red band and the ✗.
const RIBBON_STYLES = {
  ok: "bg-emerald-600 text-white",
  warn: "bg-amber-500 text-amber-950",
  crit: "bg-red-700 text-white",
} as const;

const RIBBON_MARKS = { ok: "✓", warn: "⚠", crit: "✗" } as const;

const TILE_STYLES = {
  crit: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  warn: "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  good: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
} as const;

// A count of zero carries no severity, so it drops to plain muted chrome: the
// colored tiles are exactly the ones holding a number, readable at a glance
// without parsing the digits.
const EMPTY_TILE_STYLE = "border-border/60 bg-muted/20 text-muted-foreground/60";

function ReportTiles({ sources }: { sources: PlandropReport["sources"] }) {
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
  report,
  updatedAt,
  stalePushedAt,
  onOpenExternal,
}: {
  report: PlandropReport;
  updatedAt: string | null;
  /** Relative time of the push that outdated this review, or null when fresh. */
  stalePushedAt: string | null;
  onOpenExternal?: ((url: string) => void) | undefined;
}) {
  const open = () => {
    if (onOpenExternal) onOpenExternal(report.url);
    else window.open(report.url, "_blank", "noopener,noreferrer");
  };

  const isStale = stalePushedAt !== null;
  const verdict = report.verdict;

  return (
    <button
      type="button"
      onClick={open}
      className={cn(
        "block w-full max-w-2xl overflow-hidden rounded-xl border text-left transition-colors",
        isStale
          ? "border-amber-500/40 hover:border-amber-500/60"
          : "border-border/70 hover:border-border",
      )}
    >
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
      {/* Say it in words too — the badge alone doesn't explain why the numbers
          below can't be trusted. */}
      {isStale ? (
        <div className="flex items-start gap-1.5 border-t border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
          <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>
            New code was pushed {stalePushedAt}, after this review read the branch — it may not
            cover the current state. Re-run it to be sure.
          </span>
        </div>
      ) : null}
      {verdict && verdict.label.length > 0 ? (
        <div
          className={cn(
            "px-3 py-1.5 text-xs font-bold uppercase tracking-wider",
            RIBBON_STYLES[verdict.state],
            // A stale verdict shouldn't shout as loudly as a current one.
            isStale && "opacity-60",
          )}
        >
          {RIBBON_MARKS[verdict.state]} {verdict.label}
        </div>
      ) : null}
      {report.sources.length > 0 ? (
        <div className={cn(isStale && "opacity-60")}>
          <ReportTiles sources={report.sources} />
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
  const { lookup, retry } = useReviewOfRecord(environmentId, detail, activityPending);

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

  // A lookup that failed is worth a line: silence here reads as "nobody has
  // reviewed this", which is the one thing a failed lookup cannot tell you.
  const saysSomething = lookup.state === "reviewed" || lookup.state === "unavailable";
  if (!saysSomething && reviewThreads.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 border-b border-border/70 px-4 py-3">
      {lookup.state === "reviewed" ? (
        <ReportCardBody
          report={lookup.review.report}
          updatedAt={relativeTime(lookup.review.report.generatedAt)}
          stalePushedAt={relativeTime(lookup.review.stalePushedAt)}
          onOpenExternal={onOpenExternal}
        />
      ) : lookup.state === "unavailable" ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={retry}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50"
              >
                <AlertTriangleIcon
                  className="size-3.5 shrink-0 text-amber-500"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">
                  Could not check whether this pull request has been reviewed.
                </span>
                <span className="shrink-0 font-medium text-foreground">Retry</span>
              </button>
            }
          />
          <TooltipPopup side="bottom">{lookup.reason}</TooltipPopup>
        </Tooltip>
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
