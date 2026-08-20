import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import type { PullRequestWorkspaceView } from "../components/PullRequestWorkspace";
import { usePrViewStore } from "../prViewStore";

export interface PullRequestsSearch {
  readonly projectId?: string | undefined;
  readonly prNumber?: number | undefined;
  readonly filePath?: string | undefined;
  readonly view?: PullRequestWorkspaceView | undefined;
  // [FORK] lempire: upstream's PR page (which this fork replaces with its own
  // workspace) links here with its own search schema. Accept those params so
  // upstream call sites keep type-checking; `number` and `selectedProjectId`
  // are mapped onto the fork's prNumber/projectId so deep links still resolve.
  readonly involvement?: string | undefined;
  readonly state?: string | undefined;
  readonly repository?: string | undefined;
  readonly number?: number | undefined;
  readonly selectedProjectId?: string | undefined;
  readonly selectedEnvironmentId?: string | undefined;
  // [FORK] end
}

const VALID_VIEWS = new Set<PullRequestWorkspaceView>([
  "overview",
  "files",
  "conversation",
  "threads",
]);

function parsePositiveInt(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function parseTrimmed(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}

function parsePullRequestsSearch(search: Record<string, unknown>): PullRequestsSearch {
  // [FORK] lempire: fall back to upstream's `selectedProjectId`/`number` so PR
  // links built by upstream call sites still select the right PR here.
  const projectId = parseTrimmed(search.projectId) ?? parseTrimmed(search.selectedProjectId);
  const prNumber = parsePositiveInt(search.prNumber) ?? parsePositiveInt(search.number);
  const involvement = parseTrimmed(search.involvement);
  const state = parseTrimmed(search.state);
  const repository = parseTrimmed(search.repository);
  const selectedEnvironmentId = parseTrimmed(search.selectedEnvironmentId);
  // [FORK] end

  const filePath = parseTrimmed(search.filePath);

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
    ...(involvement !== undefined ? { involvement } : {}),
    ...(state !== undefined ? { state } : {}),
    ...(repository !== undefined ? { repository } : {}),
    ...(selectedEnvironmentId !== undefined ? { selectedEnvironmentId } : {}),
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
