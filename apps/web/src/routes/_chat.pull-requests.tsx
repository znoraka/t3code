import { scopeProjectRef, scopedProjectKey } from "@t3tools/client-runtime";
import type { ModelSelection, PullRequestSummary } from "@t3tools/contracts";
import { DEFAULT_MODEL_BY_PROVIDER, DEFAULT_RUNTIME_MODE } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useComposerDraftStore } from "../composerDraftStore";
import { PullRequestListPanel } from "../components/PullRequestListPanel";
import {
  buildPullRequestReviewPrompt,
  PullRequestReviewView,
} from "../components/PullRequestReviewView";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { SidebarInset, SidebarTrigger } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import { ensureEnvironmentApi } from "../environmentApi";
import { newCommandId, newMessageId, newThreadId } from "../lib/utils";
import { gitPullRequestsQueryOptions } from "../lib/gitPRReactQuery";
import { readLocalApi } from "../localApi";
import {
  selectEnvironmentState,
  selectProjectsAcrossEnvironments,
  useStore,
} from "../store";
import type { Project } from "../types";
import { DEFAULT_INTERACTION_MODE } from "../types";

/**
 * Pick the model/provider for a new agent chat spawned from the PR review view.
 *
 * Priority:
 *   1. Most recently updated non-archived thread for this project
 *      (mirrors "the last model the user was actually working with").
 *   2. Globally sticky model/provider from the composer draft store
 *      (covers the case where the project has no threads yet but the user
 *       has been working in other projects with a non-default model).
 *   3. The project's configured default model selection.
 *   4. Hardcoded Codex default (legacy fallback).
 */
function resolveReviewModelSelection(project: Project): ModelSelection {
  const envState = selectEnvironmentState(useStore.getState(), project.environmentId);
  const projectThreadIds = envState.threadIdsByProjectId[project.id] ?? [];

  let mostRecentSelection: ModelSelection | null = null;
  let mostRecentTimestamp = "";
  for (const threadId of projectThreadIds) {
    const shell = envState.threadShellById[threadId];
    if (!shell || shell.archivedAt !== null) continue;
    const timestamp = shell.updatedAt ?? shell.createdAt;
    if (timestamp > mostRecentTimestamp) {
      mostRecentTimestamp = timestamp;
      mostRecentSelection = shell.modelSelection;
    }
  }
  if (mostRecentSelection) {
    return mostRecentSelection;
  }

  const composerState = useComposerDraftStore.getState();
  const stickyProvider = composerState.stickyActiveProvider;
  if (stickyProvider) {
    const stickySelection = composerState.stickyModelSelectionByProvider[stickyProvider];
    if (stickySelection) {
      return stickySelection;
    }
  }

  if (project.defaultModelSelection) {
    return project.defaultModelSelection;
  }

  return {
    provider: "codex" as const,
    model: DEFAULT_MODEL_BY_PROVIDER.codex,
  };
}

const PR_LAST_PROJECT_KEY = "t3code:pr-last-project-id";

export interface PullRequestsSearch {
  readonly projectId?: string | undefined;
  readonly prNumber?: number | undefined;
}

function parsePullRequestsSearch(search: Record<string, unknown>): PullRequestsSearch {
  const rawProjectId = search.projectId;
  const projectId =
    typeof rawProjectId === "string" && rawProjectId.trim().length > 0
      ? rawProjectId.trim()
      : undefined;

  const rawPrNumber = search.prNumber;
  let prNumber: number | undefined;
  if (typeof rawPrNumber === "number" && Number.isInteger(rawPrNumber) && rawPrNumber > 0) {
    prNumber = rawPrNumber;
  } else if (typeof rawPrNumber === "string") {
    const parsed = Number.parseInt(rawPrNumber, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      prNumber = parsed;
    }
  }

  return {
    ...(projectId !== undefined ? { projectId } : {}),
    ...(prNumber !== undefined ? { prNumber } : {}),
  };
}

function PullRequestsRouteView() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const projects = useStore(useShallow((store) => selectProjectsAcrossEnvironments(store)));

  const activeProject = useMemo(() => {
    const key =
      search.projectId ??
      (typeof window !== "undefined" ? window.localStorage.getItem(PR_LAST_PROJECT_KEY) : null);
    if (key) {
      const match = projects.find(
        (project) => scopedProjectKey(scopeProjectRef(project.environmentId, project.id)) === key,
      );
      if (match) return match;
    }
    return projects[0] ?? null;
  }, [projects, search.projectId]);

  const activeProjectKey = activeProject
    ? scopedProjectKey(scopeProjectRef(activeProject.environmentId, activeProject.id))
    : null;

  useEffect(() => {
    if (activeProjectKey) {
      window.localStorage.setItem(PR_LAST_PROJECT_KEY, activeProjectKey);
    }
  }, [activeProjectKey]);

  const environmentId = activeProject?.environmentId ?? null;
  const cwd = activeProject?.cwd ?? null;
  const selectedPrNumber = search.prNumber ?? null;

  const pullRequestsQuery = useQuery(gitPullRequestsQueryOptions({ environmentId, cwd }));

  const selectedPullRequest = useMemo<PullRequestSummary | null>(() => {
    if (selectedPrNumber === null || !pullRequestsQuery.data) {
      return null;
    }
    const matchesNumber = (pr: PullRequestSummary) => pr.number === selectedPrNumber;
    return (
      pullRequestsQuery.data.reviewRequested.find(matchesNumber) ??
      pullRequestsQuery.data.myPrs.find(matchesNumber) ??
      null
    );
  }, [pullRequestsQuery.data, selectedPrNumber]);

  const projectSelectItems = useMemo(
    () =>
      projects.map((project) => ({
        value: scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
        label: project.name,
      })),
    [projects],
  );

  const handleSelect = useCallback(
    (pr: PullRequestSummary) => {
      if (!activeProjectKey) return;
      void navigate({
        to: "/pull-requests",
        search: { projectId: activeProjectKey, prNumber: pr.number },
      });
    },
    [activeProjectKey, navigate],
  );

  const handleClose = useCallback(() => {
    if (!activeProjectKey) return;
    void navigate({
      to: "/pull-requests",
      search: { projectId: activeProjectKey },
    });
  }, [activeProjectKey, navigate]);

  const handleOpenExternal = useCallback(async (url: string) => {
    try {
      const api = readLocalApi();
      if (api) {
        await api.shell.openExternal(url);
        return;
      }
    } catch {
      // fall through to window.open
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const handleProjectChange = useCallback(
    (nextProjectKey: string | null) => {
      if (nextProjectKey === null) return;
      void navigate({
        to: "/pull-requests",
        search: { projectId: nextProjectKey },
      });
    },
    [navigate],
  );

  const [isReviewPending, setIsReviewPending] = useState(false);
  const [hasFileOpen, setHasFileOpen] = useState(false);

  const handleReview = useCallback(async () => {
    if (!activeProject || selectedPrNumber === null) return;
    setIsReviewPending(true);
    try {
      const prompt = buildPullRequestReviewPrompt({
        prNumber: selectedPrNumber,
        title: selectedPullRequest?.title ?? null,
        headRefName: selectedPullRequest?.headRefName ?? null,
        authorLogin: selectedPullRequest?.author ?? null,
        url: selectedPullRequest?.url ?? null,
      });
      const api = ensureEnvironmentApi(activeProject.environmentId);
      const threadId = newThreadId();
      const commandId = newCommandId();
      const messageId = newMessageId();
      const createdAt = new Date().toISOString();
      const modelSelection = resolveReviewModelSelection(activeProject);
      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId,
        threadId,
        message: {
          messageId,
          role: "user",
          text: prompt,
          attachments: [],
        },
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        createdAt,
        bootstrap: {
          createThread: {
            projectId: activeProject.id,
            title: selectedPullRequest?.title ?? `PR #${selectedPrNumber}`,
            modelSelection,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            createdAt,
          },
        },
      });
    } catch (err: unknown) {
      toastManager.add({
        type: "error",
        title: "Failed to start PR review.",
        description: err instanceof Error ? err.message : "An error occurred.",
      });
    } finally {
      setIsReviewPending(false);
    }
  }, [activeProject, selectedPrNumber, selectedPullRequest]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <SidebarTrigger className="size-7 shrink-0" />
          <span className="text-sm font-medium text-foreground">Pull requests</span>
          {projects.length > 0 && activeProject && activeProjectKey ? (
            <>
              <span className="text-xs text-muted-foreground">·</span>
              <Select
                value={activeProjectKey}
                onValueChange={handleProjectChange}
                items={projectSelectItems}
              >
                <SelectTrigger variant="ghost" size="xs" className="font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {projects.map((project) => {
                    const key = scopedProjectKey(
                      scopeProjectRef(project.environmentId, project.id),
                    );
                    return (
                      <SelectItem key={key} value={key}>
                        <span className="flex flex-col">
                          <span className="text-xs">{project.name}</span>
                          <span className="truncate text-[10px] text-muted-foreground">
                            {project.cwd}
                          </span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectPopup>
              </Select>
            </>
          ) : null}
        </header>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {(!hasFileOpen || selectedPrNumber === null) && (
            <div className="w-80 shrink-0 border-r border-border/70">
              <PullRequestListPanel
                environmentId={environmentId}
                cwd={cwd}
                selectedPrNumber={selectedPrNumber}
                onSelect={handleSelect}
                onOpenExternal={handleOpenExternal}
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            {selectedPrNumber === null ? (
              <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
                Select a pull request from the list to start reviewing.
              </div>
            ) : (
              <PullRequestReviewView
                environmentId={environmentId}
                cwd={cwd}
                prNumber={selectedPrNumber}
                title={selectedPullRequest?.title ?? null}
                headRefName={selectedPullRequest?.headRefName ?? null}
                authorLogin={selectedPullRequest?.author ?? null}
                url={selectedPullRequest?.url ?? null}
                onClose={handleClose}
                onOpenExternal={handleOpenExternal}
                onHasFileOpen={setHasFileOpen}
                {...(activeProject ? { onReview: handleReview, isReviewPending } : {})}
              />
            )}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/pull-requests")({
  component: PullRequestsRouteView,
  validateSearch: parsePullRequestsSearch,
});
