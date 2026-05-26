import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import type { PullRequestWorkspaceView } from "../components/PullRequestWorkspace";
import { usePrViewStore } from "../prViewStore";

export interface PullRequestsSearch {
  readonly projectId?: string | undefined;
  readonly prNumber?: number | undefined;
  readonly filePath?: string | undefined;
  readonly view?: PullRequestWorkspaceView | undefined;
}

const VALID_VIEWS = new Set<PullRequestWorkspaceView>([
  "overview",
  "files",
  "conversation",
  "threads",
]);

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

  const rawFilePath = search.filePath;
  const filePath =
    typeof rawFilePath === "string" && rawFilePath.trim().length > 0
      ? rawFilePath.trim()
      : undefined;

  const rawView = search.view;
  const view =
    typeof rawView === "string" && VALID_VIEWS.has(rawView as PullRequestWorkspaceView)
      ? (rawView as PullRequestWorkspaceView)
      : undefined;

  return {
    ...(projectId !== undefined ? { projectId } : {}),
    ...(prNumber !== undefined ? { prNumber } : {}),
    ...(filePath !== undefined ? { filePath } : {}),
    ...(view !== undefined ? { view } : {}),
  };
}

function PullRequestsSyncLayer() {
  const search = Route.useSearch();

  useEffect(() => {
    usePrViewStore.getState().hydrateFromRoute(search);
  }, [search]);

  return null;
}

export const Route = createFileRoute("/_chat/pull-requests")({
  component: PullRequestsSyncLayer,
  validateSearch: parsePullRequestsSearch,
});
