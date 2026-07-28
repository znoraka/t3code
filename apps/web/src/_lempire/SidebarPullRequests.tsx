// [FORK] lempire: the sidebar's pull-request mode.
//
// The PR workspace is fork-only, and the sidebar *is* its navigation: the
// `/pull-requests` route component renders nothing but a store sync layer, so
// without a PR list in the sidebar there is no way to pick a PR. That means
// every sidebar has to carry both halves — a way in (the mode control) and the
// list itself.
//
// Both sidebars (v1 and the v2 beta) need them, so they live here rather than
// inside either component: v2 would otherwise have to import from the 3.8k-line
// v1 `Sidebar.tsx` just to reuse a list. The mode control differs per sidebar —
// v1 has room for a two-tab Chat/PRs switcher above the project tree, v2 packs
// its header into one row of icon buttons — so each gets its own control over
// one shared navigation hook.

import { scopeProjectRef, scopedProjectKey } from "@t3tools/client-runtime/environment";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { GitPullRequestIcon, MessageSquareTextIcon } from "lucide-react";
import { memo, useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { readLocalApi } from "../localApi";
import { usePrViewStore } from "../prViewStore";
import { PullRequestListPanel } from "../components/PullRequestListPanel";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { SidebarContent, SidebarGroup, SidebarMenuButton } from "../components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useProjects } from "../state/entities";

/**
 * Navigating between the chat and pull-request modes.
 *
 * Entering PR mode records the chat path being left so leaving returns to the
 * same thread rather than the root, and replays the store's selection into the
 * search params so a reload — or a link — lands on the PR you were reading.
 */
function useSidebarModeNavigation(isOnPullRequests: boolean) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (loc) => loc.pathname });

  const goToChat = useCallback(() => {
    const lastChatPath = usePrViewStore.getState().lastChatPath;
    void navigate({ to: lastChatPath ?? "/" });
  }, [navigate]);

  const goToPullRequests = useCallback(() => {
    if (!isOnPullRequests) {
      usePrViewStore.getState().setLastChatPath(pathname);
    }
    const state = usePrViewStore.getState();
    const search: Record<string, unknown> = {};
    if (state.projectKey) search.projectId = state.projectKey;
    if (state.prNumber !== null) search.prNumber = state.prNumber;
    if (state.filePath !== null) search.filePath = state.filePath;
    if (state.view !== "overview") search.view = state.view;
    void navigate({ to: "/pull-requests" as string, search } as any);
  }, [isOnPullRequests, navigate, pathname]);

  return { goToChat, goToPullRequests };
}

/** Sidebar v1: a two-tab segmented control above the project tree. */
export const SidebarModeTabSwitcher = memo(function SidebarModeTabSwitcher({
  isOnPullRequests,
}: {
  isOnPullRequests: boolean;
}) {
  const { goToChat, goToPullRequests } = useSidebarModeNavigation(isOnPullRequests);

  return (
    <div className="mx-3 my-1.5 flex rounded-md border border-border/60 bg-muted/30 p-0.5">
      <button
        type="button"
        onClick={goToChat}
        className={`flex flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2 py-1 text-xs font-medium transition-colors ${
          !isOnPullRequests
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <MessageSquareTextIcon className="size-3" />
        Chat
      </button>
      <button
        type="button"
        onClick={goToPullRequests}
        className={`flex flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2 py-1 text-xs font-medium transition-colors ${
          isOnPullRequests
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <GitPullRequestIcon className="size-3" />
        PRs
      </button>
    </div>
  );
});

/**
 * Sidebar v2: one icon button that toggles the mode.
 *
 * V2's header is a single row — search, then icon buttons — with no room for a
 * segmented control, so the two v1 tabs collapse into one toggle that reads as
 * a destination going in and as "back to chat" coming out.
 */
export const SidebarV2ModeToggle = memo(function SidebarV2ModeToggle({
  isOnPullRequests,
}: {
  isOnPullRequests: boolean;
}) {
  const { goToChat, goToPullRequests } = useSidebarModeNavigation(isOnPullRequests);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuButton
            size="sm"
            type="button"
            className={`relative size-8 justify-center rounded-md border-0 p-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar ${
              isOnPullRequests
                ? "bg-sidebar-row-active text-sidebar-foreground"
                : "bg-transparent text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
            }`}
            onClick={isOnPullRequests ? goToChat : goToPullRequests}
            aria-pressed={isOnPullRequests}
            aria-label={isOnPullRequests ? "Back to chat" : "Pull requests"}
          />
        }
      >
        {isOnPullRequests ? (
          <MessageSquareTextIcon className="size-4 shrink-0" />
        ) : (
          <GitPullRequestIcon className="size-4 shrink-0 text-sidebar-muted-foreground/80" />
        )}
        <span
          className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
          aria-hidden="true"
        />
      </TooltipTrigger>
      <TooltipPopup side="right">
        {isOnPullRequests ? "Back to chat" : "Pull requests"}
      </TooltipPopup>
    </Tooltip>
  );
});

/** The PR list that replaces the thread list while in pull-request mode. */
export const SidebarPullRequestsContent = memo(function SidebarPullRequestsContent() {
  const projects = useProjects();
  const navigate = useNavigate();

  const { projectKey: storeProjectKey, prNumber: selectedPrNumber } = usePrViewStore(
    useShallow((s) => ({ projectKey: s.projectKey, prNumber: s.prNumber })),
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
      usePrViewStore.getState().setProjectKey(nextProjectKey);
      void navigate({
        to: "/pull-requests" as string,
        search: { projectId: nextProjectKey },
      } as any);
    },
    [navigate],
  );

  const handleSelect = useCallback(
    (pr: { number: number }) => {
      const key = activeProjectKey;
      if (!key) return;
      usePrViewStore.getState().selectPr(pr.number);
      void navigate({
        to: "/pull-requests" as string,
        search: { projectId: key, prNumber: pr.number, view: "overview" },
      } as any);
    },
    [activeProjectKey, navigate],
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

  return (
    <SidebarContent>
      <SidebarGroup className="p-0">
        {projects.length > 1 && activeProjectKey ? (
          <div className="border-b border-border/50 px-3 py-2">
            <Select
              value={activeProjectKey}
              onValueChange={handleProjectChange}
              items={projectSelectItems}
            >
              <SelectTrigger variant="ghost" size="xs" className="w-full font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {projects.map((project) => {
                  const key = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
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
          </div>
        ) : null}
        <div className="flex-1 overflow-hidden">
          <PullRequestListPanel
            environmentId={environmentId}
            cwd={cwd}
            selectedPrNumber={selectedPrNumber}
            onSelect={handleSelect}
            onOpenExternal={handleOpenExternal}
          />
        </div>
      </SidebarGroup>
    </SidebarContent>
  );
});

/**
 * Sidebar v2 in pull-request mode: header row plus the shared list.
 *
 * Rendered instead of the thread list so v2 does not have to wrap ~350 lines of
 * upstream JSX in a conditional — see the early return in `SidebarV2`.
 */
export function SidebarV2PullRequestsPane() {
  return (
    <>
      <SidebarGroup className="px-2 pb-2 pt-3">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1 truncate px-2 text-sm font-medium text-sidebar-foreground">
            Pull requests
          </div>
          <div className="shrink-0">
            <SidebarV2ModeToggle isOnPullRequests />
          </div>
        </div>
      </SidebarGroup>
      <SidebarPullRequestsContent />
    </>
  );
}
