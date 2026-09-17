// [FORK] lempire: the pull-request triage list, a column of the /pull-requests page.
//
// It lives in the page rather than in the sidebar so the thread list stays on screen while you
// pick a pull request. Anatomy is the old fork's — rich three-line cards bucketed by what they
// need from the reader, and a collapsed tail of what has settled. Data comes from upstream's
// per-environment listing, one read per bucket, so the buckets are the host's own answers rather
// than a re-partitioned feed.

import {
  authorHue,
  buildPullRequestSections,
  pullRequestRowKey,
  relativeTime,
  sliceSettled,
} from "@t3tools/client-runtime/_lempire/pull-request-sections";
import { scopeProjectRef, scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { PullRequestListInput } from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  AlertCircleIcon,
  AsteriskIcon,
  CheckIcon,
  CircleDashedIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";

import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import type { EnvironmentPullRequestEntry } from "~/components/pullRequest/pullRequestList.logic";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { SidebarContent, SidebarGroup } from "~/components/ui/sidebar";
import { Spinner } from "~/components/ui/spinner";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { useProjects } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { usePullRequestList } from "~/state/pullRequests";

import { usePrViewStore } from "./prViewStore";

/** Rows per open bucket; this is a triage list, not an archive. */
const OPEN_LIMIT = 40;
/** Merged rows behind the settled tail, enough for a week of landings. */
const MERGED_LIMIT = 15;

function ChecksInline({ state }: { state: EnvironmentPullRequestEntry["checksState"] }) {
  if (state === undefined) return null;
  if (state === "failing") {
    return (
      <span className="inline-flex items-center text-destructive" aria-label="Checks failing">
        <XIcon className="size-3" aria-hidden="true" />
      </span>
    );
  }
  if (state === "pending") {
    return (
      <span
        className="inline-flex items-center text-amber-600 dark:text-amber-300"
        aria-label="Checks pending"
      >
        <CircleDashedIcon className="size-3" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center text-emerald-600 dark:text-emerald-300"
      aria-label="All checks passing"
    >
      <CheckIcon className="size-3" aria-hidden="true" />
    </span>
  );
}

const PullRequestRow = memo(function PullRequestRow({
  pr,
  needsMe,
  isSelected,
  onSelect,
}: {
  pr: EnvironmentPullRequestEntry;
  needsMe: boolean;
  isSelected: boolean;
  onSelect: (pr: EnvironmentPullRequestEntry) => void;
}) {
  const login = pr.author?.login ?? "";
  const hue = authorHue(login);
  return (
    <button
      type="button"
      onClick={() => onSelect(pr)}
      className={cn(
        "block w-full cursor-pointer rounded-xl px-3 py-2 text-left transition-colors",
        isSelected ? "bg-accent" : "hover:bg-muted/60",
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        {pr.author?.avatarUrl ? (
          <img
            src={pr.author.avatarUrl}
            alt=""
            loading="lazy"
            className="size-4 shrink-0 rounded-full"
          />
        ) : null}
        <span
          className="min-w-0 truncate"
          // color-mix toward the live foreground keeps one palette readable in both themes,
          // the same technique as the sidebar's project accents.
          style={{ color: `color-mix(in oklab, hsl(${hue} 65% 55%) 72%, var(--foreground))` }}
        >
          {login}
        </span>
        <time className="ml-auto shrink-0 text-[11px] font-normal text-muted-foreground/70">
          {relativeTime(pr.updatedAt)}
        </time>
      </div>
      {/* The number sits outside the truncation so it survives long titles, which is the whole
          point of showing it: it is how a pull request is named out loud. */}
      <div className="mt-0.5 flex items-baseline gap-1.5 text-[13px] font-medium">
        <span className="shrink-0 text-muted-foreground/70 tabular-nums">#{pr.number}</span>
        <span className="min-w-0 truncate text-foreground">{pr.title}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground/80">
        <span className="min-w-0 truncate">{pr.headBranch}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {pr.isDraft ? <span className="text-muted-foreground">Draft</span> : null}
          <ChecksInline state={pr.checksState} />
          {needsMe ? (
            <AsteriskIcon className="size-3 text-[#d98a70]" aria-label="Needs your review" />
          ) : pr.reviewDecision === "approved" ? (
            <CheckIcon className="size-3 text-blue-500 dark:text-blue-400" aria-label="Approved" />
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
  pr: EnvironmentPullRequestEntry;
  isSelected: boolean;
  onSelect: (pr: EnvironmentPullRequestEntry) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(pr)}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors",
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
      )}
    >
      <PullRequestGlyph.merged className="size-3.5 shrink-0 text-purple-500 dark:text-purple-400" />
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

/** The bucketed list for one project: four host reads, one per bucket. */
function PullRequestListPanel({
  project,
  selectedKey,
  onSelect,
}: {
  project: {
    readonly environmentId: EnvironmentPullRequestEntry["environmentId"];
    readonly id: EnvironmentPullRequestEntry["projectId"];
  };
  selectedKey: string | null;
  onSelect: (pr: EnvironmentPullRequestEntry) => void;
}) {
  const target = useCallback(
    (input: PullRequestListInput) => [{ environmentId: project.environmentId, input }],
    [project.environmentId],
  );
  const reviewing = usePullRequestList(
    useMemo(
      () =>
        target({
          state: "open",
          involvement: "reviewing",
          projectId: project.id,
          limit: OPEN_LIMIT,
        }),
      [project.id, target],
    ),
  );
  const involved = usePullRequestList(
    useMemo(
      () =>
        target({
          state: "open",
          involvement: "involved",
          projectId: project.id,
          limit: OPEN_LIMIT,
        }),
      [project.id, target],
    ),
  );
  const mine = usePullRequestList(
    useMemo(
      () =>
        target({
          state: "open",
          involvement: "authored",
          projectId: project.id,
          limit: OPEN_LIMIT,
        }),
      [project.id, target],
    ),
  );
  const merged = usePullRequestList(
    useMemo(
      () => target({ state: "merged", projectId: project.id, limit: MERGED_LIMIT }),
      [project.id, target],
    ),
  );
  const [showAllSettled, setShowAllSettled] = useState(false);

  const queries = [reviewing, involved, mine, merged];
  const anyData = queries.some((query) => query.data !== null);
  const isPending = queries.some((query) => query.isPending);
  const error = queries.find((query) => query.error !== null)?.error ?? null;
  const refresh = () => {
    for (const query of queries) query.refresh();
  };

  const sections = useMemo(
    () =>
      buildPullRequestSections({
        reviewRequested: reviewing.data?.entries ?? [],
        involved: involved.data?.entries ?? [],
        mine: mine.data?.entries ?? [],
        merged: merged.data?.entries ?? [],
      }),
    [involved.data?.entries, merged.data?.entries, mine.data?.entries, reviewing.data?.entries],
  );

  if (!anyData && isPending) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
        <Spinner className="size-4" />
        Loading pull requests...
      </div>
    );
  }

  // Only surface an error screen when there is no data to fall back on. A failed background
  // refresh (a transient rate limit, say) keeps the last good rows rather than blanking the panel.
  if (!anyData) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-destructive">
        <AlertCircleIcon className="size-4" aria-hidden="true" />
        <span>{error ?? "Failed to load pull requests."}</span>
        <Button variant="outline" size="sm" onClick={refresh}>
          Retry
        </Button>
      </div>
    );
  }

  const { visible: visibleSettled, hiddenCount: hiddenSettledCount } = sliceSettled(
    sections.settled,
    showAllSettled,
  );
  const isEmpty =
    sections.needsMe.length === 0 &&
    sections.waiting.length === 0 &&
    sections.mine.length === 0 &&
    sections.settled.length === 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <h2 className="text-sm font-medium text-foreground">Pull Requests</h2>
        <Button variant="outline" size="sm" onClick={refresh} disabled={isPending}>
          {isPending ? <Spinner className="size-3" /> : "Refresh"}
        </Button>
      </div>
      {error !== null ? (
        <div className="flex items-center gap-1.5 border-b border-border/70 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          <AlertCircleIcon className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">Couldn’t refresh: {error}. Showing last results.</span>
        </div>
      ) : null}
      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {isEmpty ? (
          <p className="px-3 py-4 text-xs text-muted-foreground/70">No pull requests.</p>
        ) : null}
        {/* Needs you — headerless at the top, like active threads. */}
        <div className="space-y-0.5">
          {sections.needsMe.map((pr) => (
            <PullRequestRow
              key={pullRequestRowKey(pr)}
              pr={pr}
              needsMe
              isSelected={selectedKey === pullRequestRowKey(pr)}
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
                  key={pullRequestRowKey(pr)}
                  pr={pr}
                  needsMe={false}
                  isSelected={selectedKey === pullRequestRowKey(pr)}
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
                  key={pullRequestRowKey(pr)}
                  pr={pr}
                  needsMe={false}
                  isSelected={selectedKey === pullRequestRowKey(pr)}
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
                  key={pullRequestRowKey(pr)}
                  pr={pr}
                  isSelected={selectedKey === pullRequestRowKey(pr)}
                  onSelect={onSelect}
                />
              ))}
            </div>
            {hiddenSettledCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowAllSettled(true)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-muted-foreground"
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

/** The projects whose server can list pull requests, which is what the picker offers. */
function usePullRequestProjects() {
  const projects = useProjects();
  const { environments } = useEnvironments();
  return useMemo(() => {
    const capable = new Set(
      environments.flatMap((environment) =>
        environment.serverConfig?.environment.capabilities.pullRequests === true
          ? [environment.environmentId]
          : [],
      ),
    );
    return projects.filter((project) => capable.has(project.environmentId));
  }, [environments, projects]);
}

/** Project picker plus the bucketed list, scrolling as one. */
const PullRequestsList = memo(function PullRequestsList() {
  const projects = usePullRequestProjects();
  const navigate = useNavigate();
  const storeProjectKey = usePrViewStore((state) => state.projectKey);
  const search = useSearch({ strict: false });

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

  // The open detail, as the route's search names it. Compared by host, repository and number so
  // the highlighted row survives a project switch that still shows the same pull request.
  const selectedKey =
    "repository" in search && typeof search.repository === "string" && search.number
      ? pullRequestRowKey({
          host: typeof search.selectedHost === "string" ? search.selectedHost : undefined,
          repository: search.repository,
          number: Number(search.number),
        })
      : null;

  const projectSelectItems = useMemo(
    () =>
      projects.map((project) => ({
        value: scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
        label: project.title,
      })),
    [projects],
  );

  const handleProjectChange = useCallback((nextProjectKey: string | null) => {
    if (nextProjectKey === null) return;
    usePrViewStore.getState().setProjectKey(nextProjectKey);
  }, []);

  const handleSelect = useCallback(
    (pr: EnvironmentPullRequestEntry) => {
      void navigate({
        to: "/pull-requests",
        search: {
          involvement: "all",
          state: "open",
          repository: pr.repository,
          number: pr.number,
          selectedHost: pr.host,
          selectedProjectId: pr.projectId,
          selectedEnvironmentId: pr.environmentId,
        },
      });
    },
    [navigate],
  );

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
          {activeProject ? (
            <PullRequestListPanel
              project={activeProject}
              selectedKey={selectedKey}
              onSelect={handleSelect}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
              Add a project to view pull requests.
            </div>
          )}
        </div>
      </SidebarGroup>
    </SidebarContent>
  );
});

/**
 * The list as the page's left column. Full width until a pull request is selected on a narrow
 * window, where list and detail take turns rather than splitting 320px off an already small stage.
 */
export function PullRequestsListColumn({ collapsed }: { collapsed: boolean }) {
  return (
    <aside
      className={cn(
        "flex min-h-0 w-full shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar text-sidebar-foreground lg:w-80",
        collapsed && "max-lg:hidden",
      )}
      aria-label="Pull requests"
    >
      {/* Titlebar clearance, shown only when this column is the left-most surface: with the
          sidebar collapsed (or overlaying on a narrow window) the window controls sit above it,
          and rows must not land under them. Otherwise the list starts at the top edge, level
          with the detail panel's own header. */}
      <div
        className={cn(
          "hidden h-[var(--workspace-topbar-height)] shrink-0 max-md:block [[data-sidebar-state=collapsed]_&]:block",
          isElectron && "drag-region",
        )}
        aria-hidden="true"
      />
      <PullRequestsList />
    </aside>
  );
}
