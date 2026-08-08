// [FORK] lempire: agent-review report card in the PR overview.
//
// The /lem-test-pr review flow publishes its report to plandrop
// (plans.gawaak.ovh) and drops the URL in the review thread. This card finds
// the newest such URL among the PR's agent threads, fetches the companion
// `meta.json` (the report's source of truth — see the plandrop meta.json
// plan), and renders a native verdict ribbon + crit/warn/good tiles. Reports
// published before meta.json existed fall back to a plain link card.
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import {
  scopedProjectKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  AlertTriangleIcon,
  ExternalLinkIcon,
  FileChartColumnIcon,
  HistoryIcon,
} from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useProjects, useThreadMessages, useThreadShells } from "../state/entities";
import { usePrViewStore } from "../prViewStore";
import { cn } from "../lib/utils";

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

/** `null` = no meta.json (pre-meta report) — render the plain link card. */
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

interface Report {
  readonly url: string;
  /** When the report message landed in the thread — the age shown in the header. */
  readonly postedAt: string;
  /** Prompt that kicked off this run, when one precedes the report message. */
  readonly kickoffAt: string | null;
}

/**
 * Newest plandrop report URL across the PR's review-thread messages, plus the
 * timestamps around it. The message's own `createdAt` is the review's age (the
 * thread's `updatedAt` keeps moving with later chatter); the nearest preceding
 * user message is where that run started reading code.
 */
function extractReport(
  messages: ReadonlyArray<{
    readonly text: string;
    readonly role: string;
    readonly createdAt: string;
  }>,
): Report | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message) continue;
    const matches = message.text.match(PLANDROP_URL_RE);
    const last = matches?.at(-1);
    if (!last) continue;
    let kickoffAt: string | null = null;
    for (let j = i - 1; j >= 0; j -= 1) {
      const earlier = messages[j];
      if (earlier?.role === "user") {
        kickoffAt = earlier.createdAt;
        break;
      }
    }
    return { url: last.replace(/\/$/, ""), postedAt: message.createdAt, kickoffAt };
  }
  return null;
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
            className={cn("rounded-lg border px-2 py-1.5 text-center", TILE_STYLES[kind])}
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
  updatedAt,
  stalePushedAt,
  onOpenExternal,
}: {
  reportUrl: string;
  updatedAt: string | null;
  /** Relative time of the push that outdated this review, or null when fresh. */
  stalePushedAt: string | null;
  onOpenExternal?: ((url: string) => void) | undefined;
}) {
  const [meta, setMeta] = useState<MetaFetchResult | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    setMeta("loading");
    void fetchMeta(reportUrl).then((result) => {
      if (!cancelled) setMeta(result);
    });
    return () => {
      cancelled = true;
    };
  }, [reportUrl]);

  if (meta === "loading") return null;

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

  if (meta === null) {
    return (
      <button type="button" onClick={open} className={frame}>
        {header}
        {staleNotice}
      </button>
    );
  }

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

export function PullRequestReportCard({
  environmentId,
  prNumber,
  lastCommitAt,
  onOpenExternal,
}: {
  environmentId: EnvironmentId | null;
  prNumber: number;
  /** ISO date of the branch's newest commit — drives the stale-review notice. */
  lastCommitAt?: string | null | undefined;
  onOpenExternal?: ((url: string) => void) | undefined;
}) {
  const prViewStore = usePrViewStore(useShallow((s) => ({ projectKey: s.projectKey })));
  const projects = useProjects();

  const activeProject = useMemo(() => {
    if (prViewStore.projectKey) {
      const match = projects.find(
        (p) => scopedProjectKey(scopeProjectRef(p.environmentId, p.id)) === prViewStore.projectKey,
      );
      if (match) return match;
    }
    return projects[0] ?? null;
  }, [projects, prViewStore.projectKey]);

  const allThreads = useThreadShells();

  // Same association rule as the Threads pane: review threads carry
  // "PR #<number>" in their title. Newest thread wins.
  const latestReviewThread = useMemo(() => {
    if (!environmentId || !activeProject) return null;
    const pattern = `PR #${prNumber}`;
    const candidates = allThreads.filter(
      (thread) =>
        thread.environmentId === environmentId &&
        thread.projectId === activeProject.id &&
        thread.archivedAt === null &&
        thread.title.includes(pattern),
    );
    return (
      [...candidates].sort((a, b) =>
        (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt),
      )[0] ?? null
    );
  }, [allThreads, environmentId, activeProject, prNumber]);

  const threadRef = useMemo<ScopedThreadRef | null>(
    () =>
      latestReviewThread
        ? scopeThreadRef(latestReviewThread.environmentId, latestReviewThread.id)
        : null,
    [latestReviewThread],
  );

  const messages = useThreadMessages(threadRef);
  const report = useMemo(() => extractReport(messages), [messages]);

  const stalePushedAt = useMemo(() => {
    if (!report) return null;
    const startedAt = reviewStartedAt(report.postedAt, report.kickoffAt);
    return isReviewStale(lastCommitAt, startedAt) ? relativeTime(lastCommitAt) : null;
  }, [report, lastCommitAt]);

  if (report === null) return null;

  return (
    <ReportCardBody
      reportUrl={report.url}
      updatedAt={relativeTime(report.postedAt)}
      stalePushedAt={stalePushedAt}
      onOpenExternal={onOpenExternal}
    />
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
