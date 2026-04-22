/**
 * GitHubCli - Effect service contract for `gh` process interactions.
 *
 * Provides thin command execution helpers used by Git workflow orchestration.
 *
 * @module GitHubCli
 */
import { Context } from "effect";
import type { Effect } from "effect";

import type { ProcessRunResult } from "../../processRunner.ts";
import type { GitHubCliError } from "@t3tools/contracts";

export interface GitHubPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state?: "open" | "closed" | "merged";
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

export interface GitHubRepositoryCloneUrls {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
}

export interface GitHubPullRequestListEntry {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly isDraft: boolean;
  readonly updatedAt: string;
  readonly headRefName: string;
  readonly author: string;
  readonly reviews: ReadonlyArray<{ readonly author: string; readonly state: string }>;
  readonly statusCheckRollup: ReadonlyArray<{
    readonly name: string;
    readonly status: "pass" | "fail" | "pending";
  }>;
}

export interface GitHubPullRequestListResult {
  readonly reviewRequested: ReadonlyArray<GitHubPullRequestListEntry>;
  readonly myPrs: ReadonlyArray<GitHubPullRequestListEntry>;
  readonly ghAvailable: boolean;
  readonly error: string | null;
}

export interface GitHubPullRequestFileEntry {
  readonly path: string;
  readonly status: "A" | "M" | "D" | "R";
}

export interface GitHubPullRequestDiff {
  readonly files: ReadonlyArray<GitHubPullRequestFileEntry>;
  readonly fullDiff: string;
}

export interface GitHubPullRequestReviewComment {
  readonly id: number;
  readonly path: string;
  readonly line: number;
  readonly body: string;
  readonly bodyHtml: string;
  readonly user: string;
  readonly createdAt: string;
}

export interface GitHubPullRequestIssueComment {
  readonly id: number;
  readonly body: string;
  readonly bodyHtml: string;
  readonly user: string;
  readonly createdAt: string;
}

/**
 * GitHubCliShape - Service API for executing GitHub CLI commands.
 */
export interface GitHubCliShape {
  /**
   * Execute a GitHub CLI command and return full process output.
   */
  readonly execute: (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly timeoutMs?: number;
  }) => Effect.Effect<ProcessRunResult, GitHubCliError>;

  /**
   * List open pull requests for a head branch.
   */
  readonly listOpenPullRequests: (input: {
    readonly cwd: string;
    readonly headSelector: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError>;

  /**
   * Resolve a pull request by URL, number, or branch-ish identifier.
   */
  readonly getPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<GitHubPullRequestSummary, GitHubCliError>;

  /**
   * Resolve clone URLs for a GitHub repository.
   */
  readonly getRepositoryCloneUrls: (input: {
    readonly cwd: string;
    readonly repository: string;
  }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

  /**
   * Create a pull request from branch context and body file.
   */
  readonly createPullRequest: (input: {
    readonly cwd: string;
    readonly baseBranch: string;
    readonly headSelector: string;
    readonly title: string;
    readonly bodyFile: string;
  }) => Effect.Effect<void, GitHubCliError>;

  /**
   * Resolve repository default branch through GitHub metadata.
   */
  readonly getDefaultBranch: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string | null, GitHubCliError>;

  /**
   * Checkout a pull request into the current repository worktree.
   */
  readonly checkoutPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly force?: boolean;
  }) => Effect.Effect<void, GitHubCliError>;

  readonly listWorkspacePullRequests: (input: {
    readonly cwd: string;
    readonly limitPerBucket?: number;
  }) => Effect.Effect<GitHubPullRequestListResult, GitHubCliError>;

  readonly getPullRequestDiff: (input: {
    readonly cwd: string;
    readonly prNumber: number;
  }) => Effect.Effect<GitHubPullRequestDiff, GitHubCliError>;

  readonly getPullRequestBodyHtml: (input: {
    readonly cwd: string;
    readonly prNumber: number;
  }) => Effect.Effect<{ body: string; bodyHtml: string }, GitHubCliError>;

  readonly getPullRequestReviewComments: (input: {
    readonly cwd: string;
    readonly prNumber: number;
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestReviewComment>, GitHubCliError>;

  readonly getPullRequestIssueComments: (input: {
    readonly cwd: string;
    readonly prNumber: number;
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestIssueComment>, GitHubCliError>;

  readonly postPullRequestReviewComment: (input: {
    readonly cwd: string;
    readonly prNumber: number;
    readonly body: string;
    readonly path: string;
    readonly line: number;
  }) => Effect.Effect<void, GitHubCliError>;

  readonly postPullRequestIssueComment: (input: {
    readonly cwd: string;
    readonly prNumber: number;
    readonly body: string;
  }) => Effect.Effect<void, GitHubCliError>;

  /**
   * Fetch the set of file paths the current viewer has marked as "Viewed" on GitHub for this PR.
   * Returns an empty array if the information is unavailable (not a GitHub remote, API error, etc).
   */
  readonly getPullRequestViewedFiles: (input: {
    readonly cwd: string;
    readonly prNumber: number;
  }) => Effect.Effect<ReadonlyArray<string>, GitHubCliError>;

  /**
   * Mark or unmark a single PR file as viewed on GitHub via the GraphQL mutations
   * `markFileAsViewed` / `unmarkFileAsViewed`. Errors are propagated so the caller
   * can decide whether to show a notification.
   */
  readonly setPullRequestFileViewed: (input: {
    readonly cwd: string;
    readonly prNumber: number;
    readonly path: string;
    readonly viewed: boolean;
  }) => Effect.Effect<void, GitHubCliError>;
}

/**
 * GitHubCli - Service tag for GitHub CLI process execution.
 */
export class GitHubCli extends Context.Service<GitHubCli, GitHubCliShape>()(
  "t3/git/Services/GitHubCli",
) {}
