import { Effect, Schema, SchemaIssue } from "effect";
import { GitHubCliError } from "@t3tools/contracts";
import { PositiveInt } from "@t3tools/contracts";

import type {
  GitHubCliShape,
  GitHubPullRequestDiff,
  GitHubPullRequestFileEntry,
  GitHubPullRequestIssueComment,
  GitHubPullRequestListEntry,
  GitHubPullRequestListResult,
  GitHubPullRequestReviewComment,
} from "../Services/GitHubCli.ts";

type Execute = GitHubCliShape["execute"];

function decodeGitHubJsonPR<S extends Schema.Top>(
  raw: string,
  schema: S,
  operation:
    | "listWorkspacePullRequests"
    | "getPullRequestReviewComments"
    | "getPullRequestIssueComments",
  invalidDetail: string,
): Effect.Effect<S["Type"], GitHubCliError, S["DecodingServices"]> {
  return Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
    Effect.mapError(
      (error) =>
        new GitHubCliError({
          operation,
          detail: `${invalidDetail}: ${SchemaIssue.makeFormatterDefault()(error.issue)}`,
          cause: error,
        }),
    ),
  );
}

const RawGitHubPrListEntrySchema = Schema.Struct({
  number: PositiveInt,
  title: Schema.String,
  url: Schema.String,
  state: Schema.optional(Schema.NullOr(Schema.String)),
  isDraft: Schema.optional(Schema.NullOr(Schema.Boolean)),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
  headRefName: Schema.String,
  author: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        login: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  reviews: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          author: Schema.optional(
            Schema.NullOr(
              Schema.Struct({
                login: Schema.optional(Schema.NullOr(Schema.String)),
              }),
            ),
          ),
          state: Schema.optional(Schema.NullOr(Schema.String)),
        }),
      ),
    ),
  ),
  statusCheckRollup: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          name: Schema.optional(Schema.NullOr(Schema.String)),
          context: Schema.optional(Schema.NullOr(Schema.String)),
          status: Schema.optional(Schema.NullOr(Schema.String)),
          conclusion: Schema.optional(Schema.NullOr(Schema.String)),
          state: Schema.optional(Schema.NullOr(Schema.String)),
        }),
      ),
    ),
  ),
});

const RawGitHubPrListSchema = Schema.Array(RawGitHubPrListEntrySchema);
type RawPrListEntry = Schema.Schema.Type<typeof RawGitHubPrListEntrySchema>;

function classifyCheckStatus(entry: {
  status?: string | null | undefined;
  conclusion?: string | null | undefined;
  state?: string | null | undefined;
}): "pass" | "fail" | "pending" {
  const conclusion = entry.conclusion?.toUpperCase() ?? "";
  const state = entry.state?.toUpperCase() ?? "";
  const status = entry.status?.toUpperCase() ?? "";
  if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(conclusion)) return "pass";
  if (["FAILURE", "TIMED_OUT", "CANCELLED", "ERROR"].includes(conclusion)) return "fail";
  if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(state)) return "pass";
  if (["FAILURE", "TIMED_OUT", "CANCELLED", "ERROR"].includes(state)) return "fail";
  if (status === "COMPLETED") return "pass";
  return "pending";
}

function normalizePrListEntry(raw: RawPrListEntry): GitHubPullRequestListEntry {
  const reviews = (raw.reviews ?? []).map((review) => ({
    author: review.author?.login ?? "",
    state: review.state ?? "",
  }));
  const checks = (raw.statusCheckRollup ?? []).map((check) => ({
    name: check.name ?? check.context ?? "unknown",
    status: classifyCheckStatus({
      status: check.status ?? null,
      conclusion: check.conclusion ?? null,
      state: check.state ?? null,
    }),
  }));
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    state: raw.state ?? "OPEN",
    isDraft: raw.isDraft ?? false,
    updatedAt: raw.updatedAt ?? "",
    headRefName: raw.headRefName,
    author: raw.author?.login ?? "",
    reviews,
    statusCheckRollup: checks,
  };
}

const RawGitHubPrReviewCommentSchema = Schema.Struct({
  id: Schema.Number,
  path: Schema.optional(Schema.NullOr(Schema.String)),
  line: Schema.optional(Schema.NullOr(Schema.Number)),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  body_html: Schema.optional(Schema.NullOr(Schema.String)),
  user: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        login: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  created_at: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawGitHubPrIssueCommentSchema = Schema.Struct({
  id: Schema.Number,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  body_html: Schema.optional(Schema.NullOr(Schema.String)),
  user: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        login: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  created_at: Schema.optional(Schema.NullOr(Schema.String)),
});

function normalizeReviewComment(
  raw: Schema.Schema.Type<typeof RawGitHubPrReviewCommentSchema>,
): GitHubPullRequestReviewComment {
  const body = raw.body ?? "";
  const bodyHtml = raw.body_html ?? body;
  const line = typeof raw.line === "number" && raw.line >= 0 ? raw.line : 0;
  return {
    id: raw.id,
    path: raw.path ?? "",
    line,
    body,
    bodyHtml,
    user: raw.user?.login ?? "",
    createdAt: raw.created_at ?? "",
  };
}

function normalizeIssueComment(
  raw: Schema.Schema.Type<typeof RawGitHubPrIssueCommentSchema>,
): GitHubPullRequestIssueComment {
  const body = raw.body ?? "";
  const bodyHtml = raw.body_html ?? body;
  return {
    id: raw.id,
    body,
    bodyHtml,
    user: raw.user?.login ?? "",
    createdAt: raw.created_at ?? "",
  };
}

function parseDiffFileList(fullDiff: string): ReadonlyArray<GitHubPullRequestFileEntry> {
  const entries: GitHubPullRequestFileEntry[] = [];
  let currentPath: string | null = null;
  let currentStatus: "A" | "M" | "D" | "R" = "M";
  const flush = () => {
    if (currentPath !== null) {
      entries.push({ path: currentPath, status: currentStatus });
    }
  };
  for (const line of fullDiff.split("\n")) {
    if (line.startsWith("diff --git a/")) {
      flush();
      const match = /^diff --git a\/.+? b\/(.+)$/.exec(line);
      currentPath = match?.[1] ?? null;
      currentStatus = "M";
    } else if (line.startsWith("new file mode")) {
      currentStatus = "A";
    } else if (line.startsWith("deleted file mode")) {
      currentStatus = "D";
    } else if (line.startsWith("rename from")) {
      currentStatus = "R";
    }
  }
  flush();
  return entries;
}

export function makeGitHubCliPRMethods(execute: Execute) {
  const listWorkspacePullRequests: GitHubCliShape["listWorkspacePullRequests"] = (input) => {
    const limit = input.limitPerBucket ?? 30;
    const jsonFields =
      "number,title,url,state,isDraft,updatedAt,headRefName,author,reviews,statusCheckRollup";

    const checkAuth = execute({
      cwd: input.cwd,
      args: ["auth", "status"],
    }).pipe(
      Effect.map(() => ({ ghAvailable: true as const, error: null as string | null })),
      Effect.catchTag("GitHubCliError", (error) =>
        Effect.succeed({
          ghAvailable: false as const,
          error:
            error.detail ?? "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
        }),
      ),
    );

    const fetchBucket = (args: ReadonlyArray<string>) =>
      execute({ cwd: input.cwd, args }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed(
                [] as ReadonlyArray<Schema.Schema.Type<typeof RawGitHubPrListEntrySchema>>,
              )
            : decodeGitHubJsonPR(
                raw,
                RawGitHubPrListSchema,
                "listWorkspacePullRequests",
                "GitHub CLI returned invalid PR list JSON.",
              ),
        ),
        Effect.map((entries) => entries.map(normalizePrListEntry)),
        Effect.catch(() => Effect.succeed([] as ReadonlyArray<GitHubPullRequestListEntry>)),
      );

    return checkAuth.pipe(
      Effect.flatMap((auth): Effect.Effect<GitHubPullRequestListResult> => {
        if (!auth.ghAvailable) {
          return Effect.succeed({
            reviewRequested: [] as ReadonlyArray<GitHubPullRequestListEntry>,
            myPrs: [] as ReadonlyArray<GitHubPullRequestListEntry>,
            ghAvailable: false,
            error: auth.error,
          });
        }
        const reviewRequested = fetchBucket([
          "pr",
          "list",
          "--search",
          "involves:@me -author:@me",
          "--state",
          "open",
          `--json=${jsonFields}`,
          `--limit=${limit}`,
        ]);
        const myPrs = fetchBucket([
          "pr",
          "list",
          "--author",
          "@me",
          "--state",
          "open",
          `--json=${jsonFields}`,
          `--limit=${limit}`,
        ]);
        return Effect.all([reviewRequested, myPrs], { concurrency: 2 }).pipe(
          Effect.map(
            ([reviewRequestedEntries, myPrsEntries]) =>
              ({
                reviewRequested: reviewRequestedEntries,
                myPrs: myPrsEntries,
                ghAvailable: true,
                error: null,
              }) satisfies GitHubPullRequestListResult,
          ),
        );
      }),
    );
  };

  const getPullRequestDiff: GitHubCliShape["getPullRequestDiff"] = (input) =>
    execute({
      cwd: input.cwd,
      args: ["pr", "diff", String(input.prNumber)],
    }).pipe(
      Effect.map((result) => {
        const fullDiff = result.stdout;
        const files = parseDiffFileList(fullDiff);
        return { files, fullDiff } satisfies GitHubPullRequestDiff;
      }),
    );

  const getPullRequestBodyHtml: GitHubCliShape["getPullRequestBodyHtml"] = (input) =>
    execute({
      cwd: input.cwd,
      args: ["pr", "view", String(input.prNumber), "--json", "body", "--jq", '.body // ""'],
    }).pipe(
      Effect.flatMap((result) => {
        const body = result.stdout.trim();
        const repoFetch = execute({
          cwd: input.cwd,
          args: ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
        }).pipe(Effect.map((repo) => repo.stdout.trim()));
        return repoFetch.pipe(
          Effect.flatMap((repo) => {
            if (repo.length === 0) {
              return Effect.succeed({ body, bodyHtml: body });
            }
            return execute({
              cwd: input.cwd,
              args: [
                "api",
                "-H",
                "Accept: application/vnd.github.full+json",
                `repos/${repo}/pulls/${input.prNumber}`,
                "--jq",
                '.body_html // .body // ""',
              ],
            }).pipe(
              Effect.map((apiResult) => ({ body, bodyHtml: apiResult.stdout.trim() })),
              Effect.catch(() => Effect.succeed({ body, bodyHtml: body })),
            );
          }),
        );
      }),
    );

  const getPullRequestReviewComments: GitHubCliShape["getPullRequestReviewComments"] = (input) =>
    execute({
      cwd: input.cwd,
      args: ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    }).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.flatMap((repo) => {
        if (repo.length === 0) {
          return Effect.fail(
            new GitHubCliError({
              operation: "getPullRequestReviewComments",
              detail: "Could not determine repository (not a GitHub remote?).",
            }),
          );
        }
        return execute({
          cwd: input.cwd,
          args: [
            "api",
            "-H",
            "Accept: application/vnd.github.full+json",
            `repos/${repo}/pulls/${input.prNumber}/comments`,
          ],
        }).pipe(
          Effect.map((result) => result.stdout.trim()),
          Effect.flatMap((raw) =>
            raw.length === 0
              ? Effect.succeed(
                  [] as ReadonlyArray<Schema.Schema.Type<typeof RawGitHubPrReviewCommentSchema>>,
                )
              : decodeGitHubJsonPR(
                  raw,
                  Schema.Array(RawGitHubPrReviewCommentSchema),
                  "getPullRequestReviewComments",
                  "GitHub CLI returned invalid review comments JSON.",
                ),
          ),
          Effect.map((entries) => entries.map(normalizeReviewComment)),
        );
      }),
    );

  const getPullRequestIssueComments: GitHubCliShape["getPullRequestIssueComments"] = (input) =>
    execute({
      cwd: input.cwd,
      args: ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    }).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.flatMap((repo) => {
        if (repo.length === 0) {
          return Effect.fail(
            new GitHubCliError({
              operation: "getPullRequestIssueComments",
              detail: "Could not determine repository (not a GitHub remote?).",
            }),
          );
        }
        return execute({
          cwd: input.cwd,
          args: [
            "api",
            "-H",
            "Accept: application/vnd.github.full+json",
            `repos/${repo}/issues/${input.prNumber}/comments`,
          ],
        }).pipe(
          Effect.map((result) => result.stdout.trim()),
          Effect.flatMap((raw) =>
            raw.length === 0
              ? Effect.succeed(
                  [] as ReadonlyArray<Schema.Schema.Type<typeof RawGitHubPrIssueCommentSchema>>,
                )
              : decodeGitHubJsonPR(
                  raw,
                  Schema.Array(RawGitHubPrIssueCommentSchema),
                  "getPullRequestIssueComments",
                  "GitHub CLI returned invalid issue comments JSON.",
                ),
          ),
          Effect.map((entries) => entries.map(normalizeIssueComment)),
        );
      }),
    );

  const postPullRequestReviewComment: GitHubCliShape["postPullRequestReviewComment"] = (input) => {
    const repoFetch = execute({
      cwd: input.cwd,
      args: ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    }).pipe(Effect.map((result) => result.stdout.trim()));
    const commitFetch = execute({
      cwd: input.cwd,
      args: ["pr", "view", String(input.prNumber), "--json", "headRefOid", "--jq", ".headRefOid"],
    }).pipe(Effect.map((result) => result.stdout.trim()));
    return Effect.all([repoFetch, commitFetch]).pipe(
      Effect.flatMap(([repo, commitId]) => {
        if (repo.length === 0) {
          return Effect.fail(
            new GitHubCliError({
              operation: "postPullRequestReviewComment",
              detail: "Could not determine repository for posting review comment.",
            }),
          );
        }
        if (commitId.length === 0) {
          return Effect.fail(
            new GitHubCliError({
              operation: "postPullRequestReviewComment",
              detail: "Could not determine PR head commit for posting review comment.",
            }),
          );
        }
        return execute({
          cwd: input.cwd,
          args: [
            "api",
            `repos/${repo}/pulls/${input.prNumber}/comments`,
            "--method",
            "POST",
            "-f",
            `body=${input.body}`,
            "-f",
            `path=${input.path}`,
            "-F",
            `line=${input.line}`,
            "-f",
            `commit_id=${commitId}`,
          ],
        }).pipe(Effect.asVoid);
      }),
    );
  };

  const postPullRequestIssueComment: GitHubCliShape["postPullRequestIssueComment"] = (input) =>
    execute({
      cwd: input.cwd,
      args: ["pr", "comment", String(input.prNumber), "--body", input.body],
    }).pipe(Effect.asVoid);

  const getPullRequestViewedFiles: GitHubCliShape["getPullRequestViewedFiles"] = (input) =>
    execute({
      cwd: input.cwd,
      args: ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    }).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.flatMap((nameWithOwner) => {
        const slashIdx = nameWithOwner.indexOf("/");
        if (slashIdx === -1) return Effect.succeed([] as ReadonlyArray<string>);
        const owner = nameWithOwner.slice(0, slashIdx);
        const repo = nameWithOwner.slice(slashIdx + 1);
        // Inline values directly — avoids any variable-passing quirks with `gh api graphql`.
        // Field is `viewerViewedState` (viewer-scoped), not the non-existent `viewedState`.
        const query = `query { repository(owner: "${owner}", name: "${repo}") { pullRequest(number: ${input.prNumber}) { files(first: 100) { nodes { path viewerViewedState } } } } }`;
        return execute({
          cwd: input.cwd,
          args: ["api", "graphql", "-f", `query=${query}`],
        }).pipe(
          Effect.map((result) => {
            try {
              const data = JSON.parse(result.stdout) as {
                data?: {
                  repository?: {
                    pullRequest?: {
                      files?: { nodes?: Array<{ path: string; viewerViewedState: string }> };
                    };
                  };
                };
              };
              const nodes = data?.data?.repository?.pullRequest?.files?.nodes ?? [];
              return nodes
                .filter((node) => node.viewerViewedState === "VIEWED")
                .map((node) => node.path);
            } catch {
              return [] as ReadonlyArray<string>;
            }
          }),
          Effect.catch(() => Effect.succeed([] as ReadonlyArray<string>)),
        );
      }),
      Effect.catch(() => Effect.succeed([] as ReadonlyArray<string>)),
    );

  const setPullRequestFileViewed: GitHubCliShape["setPullRequestFileViewed"] = (input) =>
    execute({
      cwd: input.cwd,
      args: ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    }).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.flatMap((nameWithOwner) => {
        const slashIdx = nameWithOwner.indexOf("/");
        if (slashIdx === -1)
          return Effect.fail(
            new GitHubCliError({
              operation: "getPullRequestReviewComments",
              detail: "Could not determine repository (not a GitHub remote?).",
            }),
          );
        const owner = nameWithOwner.slice(0, slashIdx);
        const repo = nameWithOwner.slice(slashIdx + 1);
        // Step 1: get the PR's GraphQL node ID
        const idQuery = `query { repository(owner: "${owner}", name: "${repo}") { pullRequest(number: ${input.prNumber}) { id } } }`;
        return execute({
          cwd: input.cwd,
          args: ["api", "graphql", "-f", `query=${idQuery}`],
        }).pipe(
          Effect.flatMap((idResult) => {
            let prId: string;
            try {
              const data = JSON.parse(idResult.stdout) as {
                data?: { repository?: { pullRequest?: { id?: string } } };
              };
              prId = data?.data?.repository?.pullRequest?.id ?? "";
            } catch {
              prId = "";
            }
            if (!prId) {
              return Effect.fail(
                new GitHubCliError({
                  operation: "getPullRequestReviewComments",
                  detail: "Could not resolve PR node ID for markFileAsViewed mutation.",
                }),
              );
            }
            // Step 2: run markFileAsViewed or unmarkFileAsViewed
            const mutationName = input.viewed ? "markFileAsViewed" : "unmarkFileAsViewed";
            const mutation = `mutation { ${mutationName}(input: { pullRequestId: "${prId}", path: "${input.path}" }) { clientMutationId } }`;
            return execute({
              cwd: input.cwd,
              args: ["api", "graphql", "-f", `query=${mutation}`],
            }).pipe(Effect.asVoid);
          }),
        );
      }),
    );

  return {
    listWorkspacePullRequests,
    getPullRequestDiff,
    getPullRequestBodyHtml,
    getPullRequestReviewComments,
    getPullRequestIssueComments,
    postPullRequestReviewComment,
    postPullRequestIssueComment,
    getPullRequestViewedFiles,
    setPullRequestFileViewed,
  };
}
