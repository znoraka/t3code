// [FORK] lempire: the /pull-requests page body. The sidebar lists what to pick (see
// SidebarPullRequests.tsx); this renders upstream's detail panel for the pick, full width.

import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { PullRequestDetailPanel } from "~/components/pullRequest/PullRequestDetailPanel";
import { SidebarInset } from "~/components/ui/sidebar";
import { useProjects } from "~/state/entities";

const route = getRouteApi("/_chat/pull-requests");

export function PullRequestsPage() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: "/pull-requests" });
  const projects = useProjects();

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

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {selection ? (
          <PullRequestDetailPanel
            key={`${selection.environmentId}:${selection.reference.host ?? ""}:${selection.reference.repository}#${selection.reference.number}`}
            environmentId={selection.environmentId}
            reference={selection.reference}
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
            Select a pull request from the sidebar to start reviewing.
          </div>
        )}
      </div>
    </SidebarInset>
  );
}
