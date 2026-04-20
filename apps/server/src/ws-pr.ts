import { Effect } from "effect";
import {
  type GitListPullRequestsInput,
  type GitListPullRequestsResult,
  type GitManagerServiceError,
  type GitPostPullRequestIssueCommentInput,
  type GitPostPullRequestReviewCommentInput,
  type GitPullRequestBodyInput,
  type GitPullRequestBodyResult,
  type GitPullRequestCommentsInput,
  type GitPullRequestDiffInput,
  type GitPullRequestDiffResult,
  type GitPullRequestFileDiffInput,
  type GitPullRequestFileDiffResult,
  type GitPullRequestIssueCommentsResult,
  type GitPullRequestReviewCommentsResult,
  WS_METHODS,
} from "@t3tools/contracts";

import type { GitManagerShape } from "./git/Services/GitManager.ts";
import { observeRpcEffect } from "./observability/RpcInstrumentation.ts";

export type PRHandlers = {
  readonly [WS_METHODS.gitListPullRequests]: (
    input: GitListPullRequestsInput,
  ) => Effect.Effect<GitListPullRequestsResult, GitManagerServiceError>;
  readonly [WS_METHODS.gitGetPullRequestDiff]: (
    input: GitPullRequestDiffInput,
  ) => Effect.Effect<GitPullRequestDiffResult, GitManagerServiceError>;
  readonly [WS_METHODS.gitGetPullRequestFileDiff]: (
    input: GitPullRequestFileDiffInput,
  ) => Effect.Effect<GitPullRequestFileDiffResult, GitManagerServiceError>;
  readonly [WS_METHODS.gitGetPullRequestReviewComments]: (
    input: GitPullRequestCommentsInput,
  ) => Effect.Effect<GitPullRequestReviewCommentsResult, GitManagerServiceError>;
  readonly [WS_METHODS.gitGetPullRequestIssueComments]: (
    input: GitPullRequestCommentsInput,
  ) => Effect.Effect<GitPullRequestIssueCommentsResult, GitManagerServiceError>;
  readonly [WS_METHODS.gitGetPullRequestBody]: (
    input: GitPullRequestBodyInput,
  ) => Effect.Effect<GitPullRequestBodyResult, GitManagerServiceError>;
  readonly [WS_METHODS.gitPostPullRequestReviewComment]: (
    input: GitPostPullRequestReviewCommentInput,
  ) => Effect.Effect<void, GitManagerServiceError>;
  readonly [WS_METHODS.gitPostPullRequestIssueComment]: (
    input: GitPostPullRequestIssueCommentInput,
  ) => Effect.Effect<void, GitManagerServiceError>;
};

export function makePRHandlers(gitManager: GitManagerShape): PRHandlers {
  return {
    [WS_METHODS.gitListPullRequests]: (input) =>
      observeRpcEffect(WS_METHODS.gitListPullRequests, gitManager.listPullRequests(input), {
        "rpc.aggregate": "git",
      }),
    [WS_METHODS.gitGetPullRequestDiff]: (input) =>
      observeRpcEffect(WS_METHODS.gitGetPullRequestDiff, gitManager.getPullRequestDiff(input), {
        "rpc.aggregate": "git",
      }),
    [WS_METHODS.gitGetPullRequestFileDiff]: (input) =>
      observeRpcEffect(
        WS_METHODS.gitGetPullRequestFileDiff,
        gitManager.getPullRequestFileDiff(input),
        { "rpc.aggregate": "git" },
      ),
    [WS_METHODS.gitGetPullRequestReviewComments]: (input) =>
      observeRpcEffect(
        WS_METHODS.gitGetPullRequestReviewComments,
        gitManager.getPullRequestReviewComments(input),
        { "rpc.aggregate": "git" },
      ),
    [WS_METHODS.gitGetPullRequestIssueComments]: (input) =>
      observeRpcEffect(
        WS_METHODS.gitGetPullRequestIssueComments,
        gitManager.getPullRequestIssueComments(input),
        { "rpc.aggregate": "git" },
      ),
    [WS_METHODS.gitGetPullRequestBody]: (input) =>
      observeRpcEffect(WS_METHODS.gitGetPullRequestBody, gitManager.getPullRequestBody(input), {
        "rpc.aggregate": "git",
      }),
    [WS_METHODS.gitPostPullRequestReviewComment]: (input) =>
      observeRpcEffect(
        WS_METHODS.gitPostPullRequestReviewComment,
        gitManager.postPullRequestReviewComment(input),
        { "rpc.aggregate": "git" },
      ),
    [WS_METHODS.gitPostPullRequestIssueComment]: (input) =>
      observeRpcEffect(
        WS_METHODS.gitPostPullRequestIssueComment,
        gitManager.postPullRequestIssueComment(input),
        { "rpc.aggregate": "git" },
      ),
  };
}
