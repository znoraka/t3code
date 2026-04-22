import { Schema } from "effect";
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

const TrimmedNonEmptyStringSchema = TrimmedNonEmptyString;

// ── Pull Request list & review ───────────────────────────────────────

const PullRequestCheckStatus = Schema.Literals(["pass", "fail", "pending"]);

export const PullRequestCheck = Schema.Struct({
  name: TrimmedNonEmptyStringSchema,
  status: PullRequestCheckStatus,
});
export type PullRequestCheck = typeof PullRequestCheck.Type;

export const PullRequestSummary = Schema.Struct({
  number: PositiveInt,
  title: Schema.String,
  url: Schema.String,
  state: TrimmedNonEmptyStringSchema,
  isDraft: Schema.Boolean,
  updatedAt: Schema.String,
  headRefName: TrimmedNonEmptyStringSchema,
  author: Schema.String,
  authorAvatar: Schema.String,
  hasMyApproval: Schema.Boolean,
  hasMyComment: Schema.Boolean,
  checksTotal: NonNegativeInt,
  checksPassing: NonNegativeInt,
  checksFailing: NonNegativeInt,
  checksPending: NonNegativeInt,
  checks: Schema.Array(PullRequestCheck),
});
export type PullRequestSummary = typeof PullRequestSummary.Type;

export const GitListPullRequestsInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitListPullRequestsInput = typeof GitListPullRequestsInput.Type;

export const GitListPullRequestsResult = Schema.Struct({
  reviewRequested: Schema.Array(PullRequestSummary),
  myPrs: Schema.Array(PullRequestSummary),
  ghAvailable: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
});
export type GitListPullRequestsResult = typeof GitListPullRequestsResult.Type;

const PullRequestFileStatus = Schema.Literals(["A", "M", "D", "R"]);

export const PullRequestFileEntry = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
  status: PullRequestFileStatus,
});
export type PullRequestFileEntry = typeof PullRequestFileEntry.Type;

export const GitPullRequestDiffInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  prNumber: PositiveInt,
});
export type GitPullRequestDiffInput = typeof GitPullRequestDiffInput.Type;

export const GitPullRequestDiffResult = Schema.Struct({
  files: Schema.Array(PullRequestFileEntry),
  fullDiff: Schema.String,
});
export type GitPullRequestDiffResult = typeof GitPullRequestDiffResult.Type;

export const GitPullRequestFileDiffInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  prNumber: PositiveInt,
  filePath: TrimmedNonEmptyStringSchema,
});
export type GitPullRequestFileDiffInput = typeof GitPullRequestFileDiffInput.Type;

export const GitPullRequestFileDiffResult = Schema.Struct({
  diff: Schema.String,
});
export type GitPullRequestFileDiffResult = typeof GitPullRequestFileDiffResult.Type;

export const PullRequestReviewComment = Schema.Struct({
  id: Schema.Number,
  path: Schema.String,
  line: NonNegativeInt,
  body: Schema.String,
  bodyHtml: Schema.String,
  user: Schema.String,
  createdAt: Schema.String,
});
export type PullRequestReviewComment = typeof PullRequestReviewComment.Type;

export const PullRequestIssueComment = Schema.Struct({
  id: Schema.Number,
  body: Schema.String,
  bodyHtml: Schema.String,
  user: Schema.String,
  createdAt: Schema.String,
});
export type PullRequestIssueComment = typeof PullRequestIssueComment.Type;

export const GitPullRequestCommentsInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  prNumber: PositiveInt,
});
export type GitPullRequestCommentsInput = typeof GitPullRequestCommentsInput.Type;

export const GitPullRequestReviewCommentsResult = Schema.Struct({
  comments: Schema.Array(PullRequestReviewComment),
});
export type GitPullRequestReviewCommentsResult = typeof GitPullRequestReviewCommentsResult.Type;

export const GitPullRequestIssueCommentsResult = Schema.Struct({
  comments: Schema.Array(PullRequestIssueComment),
});
export type GitPullRequestIssueCommentsResult = typeof GitPullRequestIssueCommentsResult.Type;

export const GitPullRequestBodyInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  prNumber: PositiveInt,
});
export type GitPullRequestBodyInput = typeof GitPullRequestBodyInput.Type;

export const GitPullRequestBodyResult = Schema.Struct({
  body: Schema.String,
  bodyHtml: Schema.String,
});
export type GitPullRequestBodyResult = typeof GitPullRequestBodyResult.Type;

export const GitPostPullRequestReviewCommentInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  prNumber: PositiveInt,
  body: TrimmedNonEmptyStringSchema,
  path: TrimmedNonEmptyStringSchema,
  line: PositiveInt,
});
export type GitPostPullRequestReviewCommentInput =
  typeof GitPostPullRequestReviewCommentInput.Type;

export const GitPostPullRequestIssueCommentInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  prNumber: PositiveInt,
  body: TrimmedNonEmptyStringSchema,
});
export type GitPostPullRequestIssueCommentInput = typeof GitPostPullRequestIssueCommentInput.Type;

export const GitPullRequestViewedFilesInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  prNumber: PositiveInt,
});
export type GitPullRequestViewedFilesInput = typeof GitPullRequestViewedFilesInput.Type;

export const GitPullRequestViewedFilesResult = Schema.Struct({
  viewedPaths: Schema.Array(Schema.String),
});
export type GitPullRequestViewedFilesResult = typeof GitPullRequestViewedFilesResult.Type;

export const GitSetPullRequestFileViewedInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  prNumber: PositiveInt,
  path: TrimmedNonEmptyStringSchema,
  viewed: Schema.Boolean,
});
export type GitSetPullRequestFileViewedInput = typeof GitSetPullRequestFileViewedInput.Type;
