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
import { ExternalLinkIcon, FileChartColumnIcon } from "lucide-react";
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

/** Newest plandrop report URL across the PR's review-thread messages. */
function extractReportUrl(messages: ReadonlyArray<{ readonly text: string }>): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message) continue;
    const matches = message.text.match(PLANDROP_URL_RE);
    const last = matches?.at(-1);
    if (last) return last.replace(/\/$/, "");
  }
  return null;
}

const RIBBON_STYLES: Record<VerdictState, string> = {
  ok: "bg-emerald-600 text-white",
  warn: "bg-gradient-to-r from-red-700 to-orange-600 text-white",
  crit: "bg-red-700 text-white",
};

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
  onOpenExternal,
}: {
  reportUrl: string;
  updatedAt: string | null;
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

  const header = (
    <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-muted-foreground">
      <FileChartColumnIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="font-medium">Your review of this PR</span>
      {updatedAt ? <span>· {updatedAt}</span> : null}
      <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground/70">
        plans.gawaak.ovh
        <ExternalLinkIcon className="size-3" aria-hidden="true" />
      </span>
    </div>
  );

  if (meta === null) {
    return (
      <button
        type="button"
        onClick={open}
        className="block w-full max-w-2xl rounded-xl border border-border/70 text-left transition-colors hover:border-border"
      >
        {header}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      className="block w-full max-w-2xl overflow-hidden rounded-xl border border-border/70 text-left transition-colors hover:border-border"
    >
      {header}
      {meta.verdict ? (
        <div
          className={cn(
            "px-3 py-1.5 text-xs font-bold uppercase tracking-wider",
            RIBBON_STYLES[meta.verdict.state],
          )}
        >
          {meta.verdict.state === "ok" ? "✓" : "✗"} {meta.verdict.label}
        </div>
      ) : null}
      {meta.sources.length > 0 ? <ReportTiles sources={meta.sources} /> : null}
    </button>
  );
});

export function PullRequestReportCard({
  environmentId,
  prNumber,
  onOpenExternal,
}: {
  environmentId: EnvironmentId | null;
  prNumber: number;
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
  const reportUrl = useMemo(() => extractReportUrl(messages), [messages]);

  if (reportUrl === null) return null;

  return (
    <ReportCardBody
      reportUrl={reportUrl}
      updatedAt={latestReviewThread ? relativeTime(latestReviewThread.updatedAt) : null}
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
