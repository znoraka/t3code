// [FORK] lempire: the /pull-requests page. Upstream's list-plus-panel body is replaced by the
// fork's triage list (see PullRequestsListColumn.tsx) beside upstream's detail panel, so the
// thread sidebar stays where it is and picking a pull request no longer hides your conversations.

import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { PullRequestDetailPanel } from "~/components/pullRequest/PullRequestDetailPanel";
import type { ShortcutMatchContext } from "~/keybindings";
import { SidebarInset } from "~/components/ui/sidebar";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { cn } from "~/lib/utils";
import { useProjects } from "~/state/entities";

import { PullRequestsListColumn } from "./PullRequestsListColumn";

const route = getRouteApi("/_chat/pull-requests");

// The panel is the whole page here: no terminal, no preview, nothing else competing for keys.
const NO_SURFACES_OPEN = {
  terminalFocus: false,
  terminalOpen: false,
  previewFocus: false,
  previewOpen: false,
} satisfies ShortcutMatchContext;
const getShortcutContext = () => NO_SURFACES_OPEN;

export function PullRequestsPage() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: "/pull-requests" });
  const projects = useProjects();
  // Matches the column's own `max-lg:hidden`: where the list makes way for the detail, the
  // detail owes the reader a way back to it.
  const listHidesForDetail = useMediaQuery("max-lg");

  // The project the selection names, on its own server where the link says which one.
  const selectedProject = useMemo(() => {
    if (!search.selectedProjectId) return null;
    return (
      projects.find(
        (project) =>
          project.id === search.selectedProjectId &&
          (search.selectedEnvironmentId === undefined ||
            project.environmentId === search.selectedEnvironmentId),
      ) ?? null
    );
  }, [projects, search.selectedEnvironmentId, search.selectedProjectId]);

  const selection =
    search.repository && search.number && selectedProject
      ? {
          environmentId: selectedProject.environmentId,
          reference: {
            projectId: selectedProject.id,
            repository: search.repository,
            number: search.number,
            ...(search.selectedHost ? { host: search.selectedHost } : {}),
          },
        }
      : null;

  const clearSelection = () => {
    void navigate({
      search: ({
        repository: _repository,
        number: _number,
        selectedHost: _selectedHost,
        selectedProjectId: _selectedProjectId,
        selectedEnvironmentId: _selectedEnvironmentId,
        ...rest
      }) => rest,
    });
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <PullRequestsListColumn collapsed={selection !== null} />
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden",
            // Narrow windows show one or the other: without a selection the list owns the stage.
            selection === null && "max-lg:hidden",
          )}
        >
          {selection ? (
            <PullRequestDetailPanel
              key={`${selection.environmentId}:${selection.reference.host ?? ""}:${selection.reference.repository}#${selection.reference.number}`}
              environmentId={selection.environmentId}
              reference={selection.reference}
              // The detail header is the titlebar strip on the right of the window, so it keeps
              // clear of the window controls that overlay it there.
              reserveNativeControls
              shortcutsEnabled
              getShortcutContext={getShortcutContext}
              {...(listHidesForDetail ? { onBack: clearSelection } : {})}
              onSelectPullRequest={(reference) => {
                void navigate({
                  search: (previous) => {
                    const { selectedHost: _previousHost, ...rest } = previous;
                    return {
                      ...rest,
                      repository: reference.repository,
                      number: reference.number,
                      ...(reference.host ? { selectedHost: reference.host } : {}),
                      selectedProjectId: reference.projectId,
                      selectedEnvironmentId: selection.environmentId,
                    };
                  },
                });
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
              Select a pull request to start reviewing.
            </div>
          )}
        </div>
      </div>
    </SidebarInset>
  );
}
