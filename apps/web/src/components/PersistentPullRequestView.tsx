import { capModelSelectionEffortAtHigh } from "@t3tools/shared/model";
import { scopeProjectRef, scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ModelSelection, PullRequestSummary } from "@t3tools/contracts";
import { DEFAULT_MODEL, DEFAULT_RUNTIME_MODE } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useComposerDraftStore } from "../composerDraftStore";
import {
  buildPullRequestReviewPrompt,
  type PullRequestReviewPromptVariant,
} from "./PullRequestReviewView";
import { PullRequestWorkspace } from "./PullRequestWorkspace";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { SidebarInset, SidebarTrigger } from "./ui/sidebar";
import { toastManager } from "./ui/toast";
import { ensureEnvironmentApi } from "../environmentApi";
import { newCommandId, newMessageId, newThreadId } from "../lib/utils";
import { gitEnvironment } from "../state/git";
import { gitPrEnvironment, refreshPullRequests } from "../state/gitPr";
import { useAtomCommand } from "../state/use-atom-command";
import { useEnvironmentQuery } from "../state/query";
import { readLocalApi } from "../localApi";
import { readThreadRefs, readThreadShell, useProjects } from "../state/entities";
import { DEFAULT_INTERACTION_MODE } from "../types";
import { usePrViewStore } from "../prViewStore";

function resolveReviewModelSelection(project: EnvironmentProject): ModelSelection {
  let mostRecentSelection: ModelSelection | null = null;
  let mostRecentTimestamp = "";
  for (const ref of readThreadRefs()) {
    const shell = readThreadShell(ref);
    if (!shell || shell.environmentId !== project.environmentId || shell.projectId !== project.id) {
      continue;
    }
    if (shell.archivedAt !== null) continue;
    const timestamp = shell.updatedAt ?? shell.createdAt;
    if (timestamp > mostRecentTimestamp) {
      mostRecentTimestamp = timestamp;
      mostRecentSelection = shell.modelSelection;
    }
  }
  if (mostRecentSelection) {
    return capModelSelectionEffortAtHigh(mostRecentSelection) ?? mostRecentSelection;
  }

  const composerState = useComposerDraftStore.getState();
  const stickyProvider = composerState.stickyActiveProvider;
  if (stickyProvider) {
    const stickySelection = composerState.stickyModelSelectionByProvider[stickyProvider];
    if (stickySelection) {
      return capModelSelectionEffortAtHigh(stickySelection) ?? stickySelection;
    }
  }

  if (project.defaultModelSelection) {
    return (
      capModelSelectionEffortAtHigh(project.defaultModelSelection) ?? project.defaultModelSelection
    );
  }

  return {
    instanceId: "codex",
    model: DEFAULT_MODEL,
  } as ModelSelection;
}

export function PersistentPullRequestView({ visible }: { visible: boolean }) {
  const hasBeenActivated = usePrViewStore((s) => s.hasBeenActivated);

  if (!hasBeenActivated) return null;

  return (
    <div style={{ display: visible ? "contents" : "none" }}>
      <PersistentPullRequestViewInner />
    </div>
  );
}

function PersistentPullRequestViewInner() {
  const projects = useProjects();

  const {
    projectKey: storeProjectKey,
    prNumber: selectedPrNumber,
    filePath: selectedFilePath,
    view: selectedView,
    setView: handleViewChange,
    setFilePath,
    setProjectKey,
  } = usePrViewStore(
    useShallow((s) => ({
      projectKey: s.projectKey,
      prNumber: s.prNumber,
      filePath: s.filePath,
      view: s.view,
      setView: s.setView,
      setFilePath: s.setFilePath,
      setProjectKey: s.setProjectKey,
    })),
  );

  const activeProject = useMemo(() => {
    if (storeProjectKey) {
      const match = projects.find(
        (project) =>
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)) === storeProjectKey,
      );
      if (match) return match;
    }
    return projects[0] ?? null;
  }, [projects, storeProjectKey]);

  const activeProjectKey = activeProject
    ? scopedProjectKey(scopeProjectRef(activeProject.environmentId, activeProject.id))
    : null;

  const environmentId = activeProject?.environmentId ?? null;
  const cwd = activeProject?.workspaceRoot ?? null;

  const pullRequestsQuery = useEnvironmentQuery(
    environmentId !== null && cwd !== null
      ? gitPrEnvironment.pullRequests({ environmentId, input: { cwd } })
      : null,
  );

  const selectedPullRequest = useMemo<PullRequestSummary | null>(() => {
    if (selectedPrNumber === null || !pullRequestsQuery.data) return null;
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
        label: project.title,
      })),
    [projects],
  );

  const handleProjectChange = useCallback(
    (nextProjectKey: string | null) => {
      if (nextProjectKey === null) return;
      setProjectKey(nextProjectKey);
    },
    [setProjectKey],
  );

  const handleFilePathChange = useCallback(
    (filePath: string | null) => {
      setFilePath(filePath);
    },
    [setFilePath],
  );

  const handleOpenExternal = useCallback(async (url: string) => {
    try {
      const api = readLocalApi();
      if (api) {
        await api.shell.openExternal(url);
        return;
      }
    } catch {
      // fall through
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  // Agent review
  const [isReviewPending, setIsReviewPending] = useState(false);

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
            title: selectedPullRequest?.title
              ? `PR #${selectedPrNumber} · ${selectedPullRequest.title}`
              : `PR #${selectedPrNumber}`,
            modelSelection,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            createdAt,
          },
        },
      });
      toastManager.add({
        type: "success",
        title: "PR review started",
        description: selectedPullRequest?.title
          ? `Reviewing PR #${selectedPrNumber} · ${selectedPullRequest.title}`
          : `Reviewing PR #${selectedPrNumber}`,
      });
      handleViewChange("threads");
    } catch (err: unknown) {
      toastManager.add({
        type: "error",
        title: "Failed to start PR review.",
        description: err instanceof Error ? err.message : "An error occurred.",
      });
    } finally {
      setIsReviewPending(false);
    }
  }, [activeProject, selectedPrNumber, selectedPullRequest, handleViewChange]);

  const handleCopyReviewPrompt = useCallback(
    async (variant: PullRequestReviewPromptVariant) => {
      if (selectedPrNumber === null) return;
      const prompt = buildPullRequestReviewPrompt({
        prNumber: selectedPrNumber,
        title: selectedPullRequest?.title ?? null,
        headRefName: selectedPullRequest?.headRefName ?? null,
        authorLogin: selectedPullRequest?.author ?? null,
        url: selectedPullRequest?.url ?? null,
        variant,
      });
      try {
        await navigator.clipboard.writeText(prompt);
        toastManager.add({
          type: "success",
          title: "Prompt copied",
          description:
            variant === "review-with-tests"
              ? `Review + /lem-test-pr prompt for PR #${selectedPrNumber} copied to clipboard`
              : `Review prompt for PR #${selectedPrNumber} copied to clipboard`,
        });
      } catch (err: unknown) {
        toastManager.add({
          type: "error",
          title: "Failed to copy prompt",
          description: err instanceof Error ? err.message : "An error occurred.",
        });
      }
    },
    [selectedPrNumber, selectedPullRequest],
  );

  // Checkout / worktree
  const preparePullRequestThread = useAtomCommand(gitEnvironment.preparePullRequestThread, {
    reportFailure: false,
  });
  const [checkoutPending, setCheckoutPending] = useState<"local" | "worktree" | null>(null);

  const handleCheckout = useCallback(
    async (mode: "local" | "worktree") => {
      if (selectedPrNumber === null || !cwd || !environmentId) return;
      setCheckoutPending(mode);
      const result = await preparePullRequestThread({
        environmentId,
        input: { cwd, reference: String(selectedPrNumber), mode },
      });
      setCheckoutPending(null);
      if (result._tag === "Success") {
        refreshPullRequests({ environmentId, cwd });
        toastManager.add({
          type: "success",
          title: mode === "local" ? "Branch checked out" : "Worktree created",
          description:
            mode === "local"
              ? `Switched to branch ${result.value.branch}`
              : `Worktree created at ${result.value.worktreePath ?? result.value.branch}`,
        });
        return;
      }
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: mode === "local" ? "Checkout failed" : "Worktree creation failed",
          description: failure instanceof Error ? failure.message : "An error occurred.",
        });
      }
    },
    [cwd, environmentId, preparePullRequestThread, selectedPrNumber],
  );

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
                          <span className="text-xs">{project.title}</span>
                          <span className="truncate text-[10px] text-muted-foreground">
                            {project.workspaceRoot}
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
          <div className="min-w-0 flex-1">
            {selectedPrNumber === null ? (
              <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
                Select a pull request from the sidebar to start reviewing.
              </div>
            ) : (
              <PullRequestWorkspace
                environmentId={environmentId}
                cwd={cwd}
                prNumber={selectedPrNumber}
                prSummary={selectedPullRequest}
                view={selectedView}
                onViewChange={handleViewChange}
                openFilePath={selectedFilePath}
                onFilePathChange={handleFilePathChange}
                onOpenExternal={handleOpenExternal}
                {...(activeProject
                  ? {
                      onReviewWithAgent: handleReview,
                      onCopyReviewPrompt: handleCopyReviewPrompt,
                      isAgentReviewPending: isReviewPending,
                      onCheckout: handleCheckout,
                      isCheckoutPending: checkoutPending,
                    }
                  : {})}
              />
            )}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}
