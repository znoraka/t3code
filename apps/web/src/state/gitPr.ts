// [FORK] Pull-request data layer expressed as Effect atoms (the idiomatic
// post-#2978 architecture). Replaces the former React-Query module
// (`lib/gitPRReactQuery.ts`). Query families cache by (environmentId, input)
// and support staleness / polling; commands are invoked via `useAtomCommand`.
// After a command mutates server state, refresh the affected query atoms with
// the helpers below (the equivalent of React Query's `invalidateQueries`).
import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";

const PR_LIST_STALE_TIME_MS = 20_000;
const PR_LIST_REFRESH_INTERVAL_MS = 60_000;
const PR_DIFF_STALE_TIME_MS = 60_000;
const PR_COMMENTS_STALE_TIME_MS = 15_000;
const PR_COMMENTS_REFRESH_INTERVAL_MS = 60_000;
const PR_BODY_STALE_TIME_MS = 60_000;
const PR_VIEWED_FILES_STALE_TIME_MS = 30_000;
const PR_DETAIL_STALE_TIME_MS = 30_000;
const PR_DETAIL_REFRESH_INTERVAL_MS = 60_000;

export const gitPrEnvironment = {
  pullRequests: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "git:pr:list",
    tag: WS_METHODS.gitListPullRequests,
    staleTimeMs: PR_LIST_STALE_TIME_MS,
    refreshIntervalMs: PR_LIST_REFRESH_INTERVAL_MS,
  }),
  pullRequestDiff: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "git:pr:diff",
    tag: WS_METHODS.gitGetPullRequestDiff,
    staleTimeMs: PR_DIFF_STALE_TIME_MS,
  }),
  pullRequestFileDiff: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "git:pr:file-diff",
    tag: WS_METHODS.gitGetPullRequestFileDiff,
    staleTimeMs: PR_DIFF_STALE_TIME_MS,
  }),
  pullRequestReviewComments: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "git:pr:review-comments",
    tag: WS_METHODS.gitGetPullRequestReviewComments,
    staleTimeMs: PR_COMMENTS_STALE_TIME_MS,
    refreshIntervalMs: PR_COMMENTS_REFRESH_INTERVAL_MS,
  }),
  pullRequestIssueComments: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "git:pr:issue-comments",
    tag: WS_METHODS.gitGetPullRequestIssueComments,
    staleTimeMs: PR_COMMENTS_STALE_TIME_MS,
    refreshIntervalMs: PR_COMMENTS_REFRESH_INTERVAL_MS,
  }),
  pullRequestBody: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "git:pr:body",
    tag: WS_METHODS.gitGetPullRequestBody,
    staleTimeMs: PR_BODY_STALE_TIME_MS,
  }),
  pullRequestViewedFiles: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "git:pr:viewed-files",
    tag: WS_METHODS.gitGetPullRequestViewedFiles,
    staleTimeMs: PR_VIEWED_FILES_STALE_TIME_MS,
  }),
  pullRequestDetail: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "git:pr:detail",
    tag: WS_METHODS.gitGetPullRequestDetail,
    staleTimeMs: PR_DETAIL_STALE_TIME_MS,
    refreshIntervalMs: PR_DETAIL_REFRESH_INTERVAL_MS,
  }),

  setPullRequestFileViewed: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "git:pr:set-file-viewed",
    tag: WS_METHODS.gitSetPullRequestFileViewed,
  }),
  postPullRequestReviewComment: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "git:pr:post-review-comment",
    tag: WS_METHODS.gitPostPullRequestReviewComment,
  }),
  postPullRequestIssueComment: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "git:pr:post-issue-comment",
    tag: WS_METHODS.gitPostPullRequestIssueComment,
  }),
  submitPullRequestReview: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "git:pr:submit-review",
    tag: WS_METHODS.gitSubmitPullRequestReview,
  }),
  mergePullRequest: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "git:pr:merge",
    tag: WS_METHODS.gitMergePullRequest,
  }),
} as const;

// --- Refresh helpers (the atom equivalent of `queryClient.invalidateQueries`) ---

export function refreshPullRequests(target: { environmentId: EnvironmentId; cwd: string }): void {
  appAtomRegistry.refresh(
    gitPrEnvironment.pullRequests({
      environmentId: target.environmentId,
      input: { cwd: target.cwd },
    }),
  );
}

export function refreshPullRequestComments(target: {
  environmentId: EnvironmentId;
  cwd: string;
  prNumber: number;
}): void {
  const input = { cwd: target.cwd, prNumber: target.prNumber };
  appAtomRegistry.refresh(
    gitPrEnvironment.pullRequestReviewComments({ environmentId: target.environmentId, input }),
  );
  appAtomRegistry.refresh(
    gitPrEnvironment.pullRequestIssueComments({ environmentId: target.environmentId, input }),
  );
}

export function refreshPullRequestDetail(target: {
  environmentId: EnvironmentId;
  cwd: string;
  prNumber: number;
}): void {
  appAtomRegistry.refresh(
    gitPrEnvironment.pullRequestDetail({
      environmentId: target.environmentId,
      input: { cwd: target.cwd, prNumber: target.prNumber },
    }),
  );
}

/** Refresh comments + detail + the PR list (after review submit / merge). */
export function refreshAllPullRequestData(target: {
  environmentId: EnvironmentId;
  cwd: string;
  prNumber: number;
}): void {
  refreshPullRequestComments(target);
  refreshPullRequestDetail(target);
  refreshPullRequests({ environmentId: target.environmentId, cwd: target.cwd });
}
