import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import { BotIcon, ExternalLinkIcon, PlusIcon } from "lucide-react";
import { memo, useCallback, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";

import { selectEnvironmentState, selectProjectsAcrossEnvironments, useStore } from "../store";
import { buildThreadRouteParams } from "../threadRoutes";
import type { SidebarThreadSummary } from "../types";
import { cn } from "../lib/utils";
import { usePrViewStore } from "../prViewStore";
import { Button } from "./ui/button";

function relativeTime(value: string | null | undefined): string {
  if (!value) return "";
  const then = Date.parse(value);
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function sessionStatusLabel(thread: SidebarThreadSummary): { label: string; className: string } {
  if (thread.session?.status === "running") {
    return { label: "Running", className: "text-blue-500" };
  }
  if (thread.session?.status === "error") {
    return { label: "Error", className: "text-destructive" };
  }
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) {
    return { label: "Waiting", className: "text-amber-500" };
  }
  return { label: "Idle", className: "text-muted-foreground" };
}

const ThreadRow = memo(function ThreadRow({
  thread,
  onNavigate,
}: {
  thread: SidebarThreadSummary;
  onNavigate: (ref: ScopedThreadRef) => void;
}) {
  const status = sessionStatusLabel(thread);
  const ref = useMemo(
    () => scopeThreadRef(thread.environmentId, thread.id),
    [thread.environmentId, thread.id],
  );

  return (
    <button
      type="button"
      onClick={() => onNavigate(ref)}
      className="group flex w-full flex-col gap-1 rounded-lg border border-border/70 bg-background px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {thread.title}
          </span>
        </div>
        <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <span className={cn("font-medium", status.className)}>{status.label}</span>
        <span className="text-muted-foreground/60">·</span>
        <span className="text-muted-foreground">
          {relativeTime(thread.updatedAt ?? thread.createdAt)}
        </span>
      </div>
    </button>
  );
});

interface PullRequestThreadsPaneProps {
  environmentId: EnvironmentId | null;
  prNumber: number;
  onReviewWithAgent?: (() => void) | undefined;
  isAgentReviewPending?: boolean | undefined;
}

export function PullRequestThreadsPane({
  environmentId,
  prNumber,
  onReviewWithAgent,
  isAgentReviewPending,
}: PullRequestThreadsPaneProps) {
  const navigate = useNavigate();

  const prViewStore = usePrViewStore(useShallow((s) => ({ projectKey: s.projectKey })));

  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));

  const activeProject = useMemo(() => {
    if (prViewStore.projectKey) {
      const match = projects.find(
        (p) => scopedProjectKey(scopeProjectRef(p.environmentId, p.id)) === prViewStore.projectKey,
      );
      if (match) return match;
    }
    return projects[0] ?? null;
  }, [projects, prViewStore.projectKey]);

  const threads = useStore(
    useShallow((state) => {
      if (!environmentId || !activeProject) return [];
      const envState = selectEnvironmentState(state, environmentId);
      const projectThreadIds = envState.threadIdsByProjectId[activeProject.id] ?? [];
      const pattern = `PR #${prNumber}`;
      const result: SidebarThreadSummary[] = [];
      for (const threadId of projectThreadIds) {
        const thread = envState.sidebarThreadSummaryById[threadId];
        if (!thread || thread.archivedAt !== null) continue;
        if (thread.title.includes(pattern)) {
          result.push(thread);
        }
      }
      result.sort((a, b) => {
        const aTime = a.updatedAt ?? a.createdAt;
        const bTime = b.updatedAt ?? b.createdAt;
        return bTime.localeCompare(aTime);
      });
      return result;
    }),
  );

  const handleNavigate = useCallback(
    (ref: ScopedThreadRef) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(ref),
      });
    },
    [navigate],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">Agent threads</h3>
          <p className="text-[11px] text-muted-foreground">
            Conversations started by reviewing PR #{prNumber}
          </p>
        </div>
        {onReviewWithAgent ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onReviewWithAgent}
            disabled={isAgentReviewPending}
          >
            <PlusIcon className="mr-1.5 size-3" />
            {isAgentReviewPending ? "Starting..." : "New review"}
          </Button>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <BotIcon className="size-8 text-muted-foreground/40" />
            <div>
              <p className="text-sm text-muted-foreground">No review threads yet</p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                Start a review to create a conversation thread for this PR.
              </p>
            </div>
            {onReviewWithAgent ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onReviewWithAgent}
                disabled={isAgentReviewPending}
              >
                {isAgentReviewPending ? "Starting..." : "Review with agent"}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            {threads.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} onNavigate={handleNavigate} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
