import * as Rpc from "effect/unstable/rpc/Rpc";

import {
  GitListPullRequestsInput,
  GitListPullRequestsResult,
  GitPostPullRequestIssueCommentInput,
  GitPostPullRequestReviewCommentInput,
  GitPullRequestBodyInput,
  GitPullRequestBodyResult,
  GitPullRequestCommentsInput,
  GitPullRequestDiffInput,
  GitPullRequestDiffResult,
  GitPullRequestFileDiffInput,
  GitPullRequestFileDiffResult,
  GitPullRequestIssueCommentsResult,
  GitPullRequestReviewCommentsResult,
  GitPullRequestViewedFilesInput,
  GitPullRequestViewedFilesResult,
  GitSetPullRequestFileViewedInput,
} from "./git-pr.ts";
import { GitManagerServiceError } from "./git.ts";

export const WsGitListPullRequestsRpc = Rpc.make("git.listPullRequests", {
  payload: GitListPullRequestsInput,
  success: GitListPullRequestsResult,
  error: GitManagerServiceError,
});

export const WsGitGetPullRequestDiffRpc = Rpc.make("git.getPullRequestDiff", {
  payload: GitPullRequestDiffInput,
  success: GitPullRequestDiffResult,
  error: GitManagerServiceError,
});

export const WsGitGetPullRequestFileDiffRpc = Rpc.make("git.getPullRequestFileDiff", {
  payload: GitPullRequestFileDiffInput,
  success: GitPullRequestFileDiffResult,
  error: GitManagerServiceError,
});

export const WsGitGetPullRequestReviewCommentsRpc = Rpc.make("git.getPullRequestReviewComments", {
  payload: GitPullRequestCommentsInput,
  success: GitPullRequestReviewCommentsResult,
  error: GitManagerServiceError,
});

export const WsGitGetPullRequestIssueCommentsRpc = Rpc.make("git.getPullRequestIssueComments", {
  payload: GitPullRequestCommentsInput,
  success: GitPullRequestIssueCommentsResult,
  error: GitManagerServiceError,
});

export const WsGitGetPullRequestBodyRpc = Rpc.make("git.getPullRequestBody", {
  payload: GitPullRequestBodyInput,
  success: GitPullRequestBodyResult,
  error: GitManagerServiceError,
});

export const WsGitPostPullRequestReviewCommentRpc = Rpc.make("git.postPullRequestReviewComment", {
  payload: GitPostPullRequestReviewCommentInput,
  error: GitManagerServiceError,
});

export const WsGitPostPullRequestIssueCommentRpc = Rpc.make("git.postPullRequestIssueComment", {
  payload: GitPostPullRequestIssueCommentInput,
  error: GitManagerServiceError,
});

export const WsGitGetPullRequestViewedFilesRpc = Rpc.make("git.getPullRequestViewedFiles", {
  payload: GitPullRequestViewedFilesInput,
  success: GitPullRequestViewedFilesResult,
  error: GitManagerServiceError,
});

export const WsGitSetPullRequestFileViewedRpc = Rpc.make("git.setPullRequestFileViewed", {
  payload: GitSetPullRequestFileViewedInput,
  error: GitManagerServiceError,
});
