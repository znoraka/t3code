import { Effect } from "effect";

import {
  type GitListPullRequestsResult,
  type PullRequestCheck,
  type PullRequestSummary,
} from "@t3tools/contracts";
import type {
  GitHubPullRequestListEntry,
} from "../Services/GitHubCli.ts";
import type { GitHubCliShape } from "../Services/GitHubCli.ts";
import type { GitManagerShape } from "../Services/GitManager.ts";

function extractFileDiff(fullDiff: string, filePath: string): string {
  const marker = `diff --git a/${filePath} b/${filePath}`;
  const lines = fullDiff.split("\n");
  let inSection = false;
  const collected: string[] = [];
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (inSection) break;
      if (line === marker) {
        inSection = true;
      }
    }
    if (inSection) {
      collected.push(line);
    }
  }
  return collected.length > 0 ? `${collected.join("\n")}\n` : "";
}

function toPullRequestSummary(
  entry: GitHubPullRequestListEntry,
  currentUser: string,
): PullRequestSummary {
  const normalizedUser = currentUser.toLowerCase();
  const hasMyApproval =
    normalizedUser.length > 0 &&
    entry.reviews.some(
      (review) => review.author.toLowerCase() === normalizedUser && review.state === "APPROVED",
    );
  const hasMyComment =
    normalizedUser.length > 0 &&
    entry.reviews.some(
      (review) =>
        review.author.toLowerCase() === normalizedUser &&
        (review.state === "COMMENTED" || review.state === "CHANGES_REQUESTED"),
    );
  const checks: ReadonlyArray<PullRequestCheck> = entry.statusCheckRollup.map((check) => ({
    name: check.name,
    status: check.status,
  }));
  const checksTotal = checks.length;
  const checksPassing = checks.filter((c) => c.status === "pass").length;
  const checksFailing = checks.filter((c) => c.status === "fail").length;
  const checksPending = checks.filter((c) => c.status === "pending").length;
  const state = entry.state.trim().length > 0 ? entry.state : "OPEN";
  const author = entry.author.trim();
  const authorAvatar = author.length > 0 ? `https://github.com/${author}.png?size=40` : "";
  return {
    number: entry.number,
    title: entry.title,
    url: entry.url,
    state,
    isDraft: entry.isDraft,
    updatedAt: entry.updatedAt,
    headRefName: entry.headRefName,
    author,
    authorAvatar,
    hasMyApproval,
    hasMyComment,
    checksTotal,
    checksPassing,
    checksFailing,
    checksPending,
    checks,
  };
}

export function makeGitManagerPRMethods(gitHubCli: GitHubCliShape) {
  const fetchCurrentUserLogin = (cwd: string) =>
    gitHubCli
      .execute({ cwd, args: ["api", "user", "--jq", ".login"] })
      .pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.catch(() => Effect.succeed("")),
      );

  const listPullRequests: GitManagerShape["listPullRequests"] = Effect.fnUntraced(
    function* (input) {
      const [rawResult, currentUser] = yield* Effect.all(
        [gitHubCli.listWorkspacePullRequests({ cwd: input.cwd }), fetchCurrentUserLogin(input.cwd)],
        { concurrency: 2 },
      );

      if (!rawResult.ghAvailable) {
        return {
          reviewRequested: [],
          myPrs: [],
          ghAvailable: false,
          error: rawResult.error,
        } satisfies GitListPullRequestsResult;
      }

      return {
        reviewRequested: rawResult.reviewRequested.map((entry) =>
          toPullRequestSummary(entry, currentUser),
        ),
        myPrs: rawResult.myPrs.map((entry) => toPullRequestSummary(entry, currentUser)),
        ghAvailable: true,
        error: rawResult.error,
      } satisfies GitListPullRequestsResult;
    },
  );

  const getPullRequestDiff: GitManagerShape["getPullRequestDiff"] = Effect.fnUntraced(
    function* (input) {
      const diff = yield* gitHubCli.getPullRequestDiff({
        cwd: input.cwd,
        prNumber: input.prNumber,
      });
      return { files: diff.files, fullDiff: diff.fullDiff };
    },
  );

  const getPullRequestFileDiff: GitManagerShape["getPullRequestFileDiff"] = Effect.fnUntraced(
    function* (input) {
      const diff = yield* gitHubCli.getPullRequestDiff({
        cwd: input.cwd,
        prNumber: input.prNumber,
      });
      return { diff: extractFileDiff(diff.fullDiff, input.filePath) };
    },
  );

  const getPullRequestReviewComments: GitManagerShape["getPullRequestReviewComments"] =
    Effect.fnUntraced(function* (input) {
      const comments = yield* gitHubCli.getPullRequestReviewComments({
        cwd: input.cwd,
        prNumber: input.prNumber,
      });
      return { comments };
    });

  const getPullRequestIssueComments: GitManagerShape["getPullRequestIssueComments"] =
    Effect.fnUntraced(function* (input) {
      const comments = yield* gitHubCli.getPullRequestIssueComments({
        cwd: input.cwd,
        prNumber: input.prNumber,
      });
      return { comments };
    });

  const getPullRequestBody: GitManagerShape["getPullRequestBody"] = Effect.fnUntraced(
    function* (input) {
      const result = yield* gitHubCli.getPullRequestBodyHtml({
        cwd: input.cwd,
        prNumber: input.prNumber,
      });
      return { body: result.body, bodyHtml: result.bodyHtml };
    },
  );

  const postPullRequestReviewComment: GitManagerShape["postPullRequestReviewComment"] =
    Effect.fnUntraced(function* (input) {
      yield* gitHubCli.postPullRequestReviewComment({
        cwd: input.cwd,
        prNumber: input.prNumber,
        body: input.body,
        path: input.path,
        line: input.line,
      });
    });

  const postPullRequestIssueComment: GitManagerShape["postPullRequestIssueComment"] =
    Effect.fnUntraced(function* (input) {
      yield* gitHubCli.postPullRequestIssueComment({
        cwd: input.cwd,
        prNumber: input.prNumber,
        body: input.body,
      });
    });

  const getPullRequestViewedFiles: GitManagerShape["getPullRequestViewedFiles"] =
    Effect.fnUntraced(function* (input) {
      const viewedPaths = yield* gitHubCli.getPullRequestViewedFiles({
        cwd: input.cwd,
        prNumber: input.prNumber,
      });
      return { viewedPaths };
    });

  const setPullRequestFileViewed: GitManagerShape["setPullRequestFileViewed"] =
    Effect.fnUntraced(function* (input) {
      yield* gitHubCli.setPullRequestFileViewed({
        cwd: input.cwd,
        prNumber: input.prNumber,
        path: input.path,
        viewed: input.viewed,
      });
    });

  return {
    listPullRequests,
    getPullRequestDiff,
    getPullRequestFileDiff,
    getPullRequestReviewComments,
    getPullRequestIssueComments,
    getPullRequestBody,
    postPullRequestReviewComment,
    postPullRequestIssueComment,
    getPullRequestViewedFiles,
    setPullRequestFileViewed,
  };
}
