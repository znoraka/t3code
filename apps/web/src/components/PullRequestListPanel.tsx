import type { EnvironmentId, PullRequestSummary } from "@t3tools/contracts";
import {
  AlertCircleIcon,
  AsteriskIcon,
  CheckIcon,
  CircleDashedIcon,
  GitMergeIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { memo, useMemo, useState } from "react";

import { gitPrEnvironment } from "~/state/gitPr";
import { useEnvironmentQuery } from "~/state/query";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

interface PullRequestListPanelProps {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  selectedPrNumber: number | null;
  onSelect: (pr: PullRequestSummary) => void;
  onOpenExternal?: (url: string) => void;
}

const SETTLED_INITIAL_COUNT = 5;

function relativeTime(value: string): string {
  if (!value) return "";
  const then = Date.parse(value);
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  return `${years}y`;
}

/** Deterministic per-author hue so the name line reads like the colored
    project line of the threads list. */
function authorHue(login: string): number {
  let hash = 0;
  for (let i = 0; i < login.length; i += 1) {
    hash = (hash * 31 + login.charCodeAt(i)) | 0;
  }
  return ((hash % 360) + 360) % 360;
}

/** A PR in the review-requested bucket needs me unless I already approved or
    commented and no re-review has been requested since. */
function needsMyReview(pr: PullRequestSummary): boolean {
  return pr.reReviewRequested || (!pr.hasMyApproval && !pr.hasMyComment);
}

function ChecksInline({ pr }: { pr: PullRequestSummary }) {
  if (pr.checksTotal === 0) return null;
  if (pr.checksFailing > 0) {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-destructive tabular-nums"
        title={`${pr.checksFailing} failing`}
      >
        <XIcon className="size-3" aria-hidden="true" />
        {pr.checksPassing}/{pr.checksTotal}
      </span>
    );
  }
  if (pr.checksPending > 0) {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-amber-600 tabular-nums dark:text-amber-300"
        title={`${pr.checksPending} pending`}
      >
        <CircleDashedIcon className="size-3" aria-hidden="true" />
        {pr.checksPassing}/{pr.checksTotal}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 text-emerald-600 tabular-nums dark:text-emerald-300"
      title="All checks passing"
    >
      <CheckIcon className="size-3" aria-hidden="true" />
      {pr.checksPassing}
    </span>
  );
}

const PullRequestRow = memo(function PullRequestRow({
  pr,
  needsMe,
  isSelected,
  onSelect,
}: {
  pr: PullRequestSummary;
  needsMe: boolean;
  isSelected: boolean;
  onSelect: (pr: PullRequestSummary) => void;
}) {
  const hue = authorHue(pr.author);
  return (
    <button
      type="button"
      onClick={() => onSelect(pr)}
      className={cn(
        "block w-full rounded-xl px-3 py-2 text-left transition-colors",
        isSelected ? "bg-accent" : "hover:bg-muted/60",
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        {pr.authorAvatar.length > 0 ? (
          <img
            src={pr.authorAvatar}
            alt=""
            loading="lazy"
            className="size-4 shrink-0 rounded-full"
          />
        ) : null}
        <span
          className="min-w-0 truncate"
          // color-mix toward the live foreground keeps one palette readable in
          // both themes, same technique as the sidebar's project accents.
          style={{ color: `color-mix(in oklab, hsl(${hue} 65% 55%) 72%, var(--foreground))` }}
        >
          {pr.author}
        </span>
        <time className="ml-auto shrink-0 text-[11px] font-normal text-muted-foreground/70">
          {relativeTime(pr.updatedAt)}
        </time>
      </div>
      <div className="mt-0.5 truncate text-[13px] font-medium text-foreground">{pr.title}</div>
      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground/80">
        <span className="min-w-0 truncate">{pr.headRefName}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {pr.isDraft ? <span className="text-muted-foreground">Draft</span> : null}
          <ChecksInline pr={pr} />
          {needsMe ? (
            <AsteriskIcon className="size-3 text-[#d98a70]" aria-label="Needs your review" />
          ) : pr.hasMyApproval ? (
            <CheckIcon
              className="size-3 text-blue-500 dark:text-blue-400"
              aria-label="Approved by you"
            />
          ) : null}
        </span>
      </div>
    </button>
  );
});

const SettledRow = memo(function SettledRow({
  pr,
  isSelected,
  onSelect,
}: {
  pr: PullRequestSummary;
  isSelected: boolean;
  onSelect: (pr: PullRequestSummary) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(pr)}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors",
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
      )}
    >
      <GitMergeIcon className="size-3.5 shrink-0 text-purple-500 dark:text-purple-400" />
      <span className="min-w-0 truncate">
        #{pr.number} · {pr.title}
      </span>
      <time className="ml-auto shrink-0 text-[11px] text-muted-foreground/70">
        {relativeTime(pr.updatedAt)}
      </time>
    </button>
  );
});

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 pb-1 pt-4 text-[11px] text-muted-foreground/80">
      <span className="shrink-0">{label}</span>
      <span className="h-px flex-1 bg-border/70" aria-hidden="true" />
    </div>
  );
}

export function PullRequestListPanel({
  environmentId,
  cwd,
  selectedPrNumber,
  onSelect,
  onOpenExternal: _onOpenExternal,
}: PullRequestListPanelProps) {
  const pullRequestsQuery = useEnvironmentQuery(
    environmentId !== null && cwd !== null
      ? gitPrEnvironment.pullRequests({ environmentId, input: { cwd } })
      : null,
  );
  const data = pullRequestsQuery.data;
  const [showAllSettled, setShowAllSettled] = useState(false);

  const sections = useMemo(() => {
    if (!data) return null;
    const review = data.reviewRequested.toSorted(byUpdatedAtDesc);
    return {
      needsMe: review.filter(needsMyReview),
      waiting: review.filter((pr) => !needsMyReview(pr)),
      mine: data.myPrs.toSorted(byUpdatedAtDesc),
      settled: data.merged.toSorted(byUpdatedAtDesc),
    };
  }, [data]);

  if (!cwd) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
        Select a project to view pull requests.
      </div>
    );
  }

  if (pullRequestsQuery.isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
        <Spinner className="size-4" />
        Loading pull requests...
      </div>
    );
  }

  // Only surface an error screen when there is no cached data to fall back on.
  // A failed background refresh (e.g. a transient rate limit) keeps the last
  // good data, so we keep showing it rather than blanking the panel.
  if (!data || !sections) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-destructive">
        <AlertCircleIcon className="size-4" aria-hidden="true" />
        <span>{pullRequestsQuery.error ?? "Failed to load pull requests."}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            pullRequestsQuery.refresh();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!data.ghAvailable) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
        <AlertCircleIcon className="size-4" aria-hidden="true" />
        <span>{data.error ?? "GitHub CLI unavailable."}</span>
      </div>
    );
  }

  const visibleSettled = showAllSettled
    ? sections.settled
    : sections.settled.slice(0, SETTLED_INITIAL_COUNT);
  const hiddenSettledCount = sections.settled.length - visibleSettled.length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <h2 className="text-sm font-medium text-foreground">Pull Requests</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            pullRequestsQuery.refresh();
          }}
          disabled={pullRequestsQuery.isPending}
        >
          {pullRequestsQuery.isPending ? <Spinner className="size-3" /> : "Refresh"}
        </Button>
      </div>
      {pullRequestsQuery.error !== null ? (
        <div className="flex items-center gap-1.5 border-b border-border/70 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          <AlertCircleIcon className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">
            Couldn’t refresh: {pullRequestsQuery.error}. Showing last results.
          </span>
        </div>
      ) : null}
      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {/* Needs you — headerless at the top, like active threads. */}
        {sections.needsMe.length === 0 &&
        sections.waiting.length === 0 &&
        sections.mine.length === 0 &&
        sections.settled.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground/70">No pull requests.</p>
        ) : null}
        <div className="space-y-0.5">
          {sections.needsMe.map((pr) => (
            <PullRequestRow
              key={pr.number}
              pr={pr}
              needsMe
              isSelected={selectedPrNumber === pr.number}
              onSelect={onSelect}
            />
          ))}
        </div>
        {sections.mine.length > 0 ? (
          <>
            <SectionDivider label="Your pull requests" />
            <div className="space-y-0.5">
              {sections.mine.map((pr) => (
                <PullRequestRow
                  key={pr.number}
                  pr={pr}
                  needsMe={false}
                  isSelected={selectedPrNumber === pr.number}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </>
        ) : null}
        {sections.waiting.length > 0 ? (
          <>
            <SectionDivider label="Waiting on others" />
            <div className="space-y-0.5">
              {sections.waiting.map((pr) => (
                <PullRequestRow
                  key={pr.number}
                  pr={pr}
                  needsMe={false}
                  isSelected={selectedPrNumber === pr.number}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </>
        ) : null}
        {sections.settled.length > 0 ? (
          <>
            <SectionDivider label="Settled" />
            <div className="space-y-0.5">
              {visibleSettled.map((pr) => (
                <SettledRow
                  key={pr.number}
                  pr={pr}
                  isSelected={selectedPrNumber === pr.number}
                  onSelect={onSelect}
                />
              ))}
            </div>
            {hiddenSettledCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowAllSettled(true)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-muted-foreground"
              >
                <PlusIcon className="size-3.5" aria-hidden="true" />
                Show {hiddenSettledCount} more
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function byUpdatedAtDesc(a: PullRequestSummary, b: PullRequestSummary): number {
  const left = a.updatedAt ? Date.parse(a.updatedAt) : 0;
  const right = b.updatedAt ? Date.parse(b.updatedAt) : 0;
  return right - left;
}
