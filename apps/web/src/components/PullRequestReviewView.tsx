import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata } from "@pierre/diffs/react";
import type {
  EnvironmentId,
  PullRequestFileEntry,
  PullRequestIssueComment,
  PullRequestReviewComment,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AlertCircleIcon,
  BotIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns2Icon,
  ExternalLinkIcon,
  FolderGit2Icon,
  GitBranchIcon,
  MessageCircleIcon,
  Rows3Icon,
  SendIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { useTheme } from "~/hooks/useTheme";
import { gitEnvironment } from "~/state/git";
import { gitPrEnvironment, refreshPullRequestComments, refreshPullRequests } from "~/state/gitPr";
import { useAtomCommand } from "~/state/use-atom-command";
import { useEnvironmentQuery } from "~/state/query";
import { buildPatchCacheKey, resolveDiffThemeName } from "~/lib/diffRendering";
import { usePullRequestViewedFiles } from "~/lib/pullRequestViewedFiles";
import { cn } from "~/lib/utils";
import { basenameOfPath } from "~/vscode-icons";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import ChatMarkdown from "./ChatMarkdown";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Spinner } from "./ui/spinner";
import { Toggle } from "./ui/toggle";
import { ToggleGroup } from "./ui/toggle-group";
import { toastManager } from "./ui/toast";

interface PullRequestReviewViewProps {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  prNumber: number | null;
  title?: string | null;
  headRefName?: string | null;
  authorLogin?: string | null;
  url?: string | null;
  onClose?: () => void;
  onOpenExternal?: (url: string) => void;
  onReview?: () => void;
  isReviewPending?: boolean;
  openFilePath?: string | null;
  onFilePathChange?: (filePath: string | null) => void;
}

type PatchRender =
  | { kind: "files"; files: FileDiffMetadata[] }
  | { kind: "raw"; text: string; reason: string };

function renderPatch(patch: string | null | undefined, cacheScope: string): PatchRender | null {
  const normalized = (patch ?? "").trim();
  if (normalized.length === 0) return null;
  try {
    const parsed = parsePatchFiles(normalized, buildPatchCacheKey(normalized, cacheScope));
    const files = parsed.flatMap((entry) => entry.files);
    if (files.length > 0) {
      return { kind: "files", files };
    }
  } catch {
    // fall through to raw
  }
  return { kind: "raw", text: normalized, reason: "Showing raw diff." };
}

function statusLabel(status: PullRequestFileEntry["status"]): string {
  switch (status) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    default:
      return "modified";
  }
}

function formatDateTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

interface CommentListItem {
  readonly id: string;
  readonly kind: "issue" | "review";
  readonly user: string;
  readonly createdAt: string;
  readonly body: string;
  readonly bodyHtml: string;
  readonly path?: string;
  readonly line?: number;
}

function toCommentItems(input: {
  issues: ReadonlyArray<PullRequestIssueComment>;
  reviews: ReadonlyArray<PullRequestReviewComment>;
}): CommentListItem[] {
  const issueItems: CommentListItem[] = input.issues.map((comment) => ({
    id: `issue:${comment.id}`,
    kind: "issue",
    user: comment.user,
    createdAt: comment.createdAt,
    body: comment.body,
    bodyHtml: comment.bodyHtml,
  }));
  const reviewItems: CommentListItem[] = input.reviews.map((comment) => ({
    id: `review:${comment.id}`,
    kind: "review",
    user: comment.user,
    createdAt: comment.createdAt,
    body: comment.body,
    bodyHtml: comment.bodyHtml,
    path: comment.path,
    line: comment.line,
  }));
  return [...issueItems, ...reviewItems].toSorted((a, b) => {
    const left = Date.parse(a.createdAt);
    const right = Date.parse(b.createdAt);
    return (Number.isNaN(left) ? 0 : left) - (Number.isNaN(right) ? 0 : right);
  });
}

const CommentEntry = memo(function CommentEntry({ item }: { item: CommentListItem }) {
  return (
    <article className="rounded-lg border border-border/70 bg-background p-3">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">{item.user || "unknown"}</span>
        <span className="tabular-nums">{formatDateTime(item.createdAt)}</span>
      </header>
      {item.kind === "review" && item.path ? (
        <p className="mb-2 truncate rounded border border-border/60 bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
          {item.path}
          {typeof item.line === "number" && item.line > 0 ? `:${item.line}` : ""}
        </p>
      ) : null}
      {item.body.length > 0 ? <ChatMarkdown text={item.body} cwd={undefined} /> : null}
    </article>
  );
});

export function PullRequestReviewView({
  environmentId,
  cwd,
  prNumber,
  title,
  headRefName,
  authorLogin,
  url,
  onClose,
  onOpenExternal,
  onReview,
  isReviewPending,
  openFilePath = null,
  onFilePathChange,
}: PullRequestReviewViewProps) {
  const { resolvedTheme } = useTheme();

  const queryTarget =
    environmentId !== null && cwd !== null && prNumber !== null
      ? { environmentId, input: { cwd, prNumber } }
      : null;
  const diffQuery = useEnvironmentQuery(
    queryTarget ? gitPrEnvironment.pullRequestDiff(queryTarget) : null,
  );
  const bodyQuery = useEnvironmentQuery(
    queryTarget ? gitPrEnvironment.pullRequestBody(queryTarget) : null,
  );
  const viewedFilesQuery = useEnvironmentQuery(
    queryTarget ? gitPrEnvironment.pullRequestViewedFiles(queryTarget) : null,
  );
  const reviewCommentsQuery = useEnvironmentQuery(
    queryTarget ? gitPrEnvironment.pullRequestReviewComments(queryTarget) : null,
  );
  const issueCommentsQuery = useEnvironmentQuery(
    queryTarget ? gitPrEnvironment.pullRequestIssueComments(queryTarget) : null,
  );

  const setFileViewed = useAtomCommand(gitPrEnvironment.setPullRequestFileViewed, {
    reportFailure: false,
  });
  const postIssueComment = useAtomCommand(gitPrEnvironment.postPullRequestIssueComment, {
    reportFailure: false,
  });
  const preparePullRequestThread = useAtomCommand(gitEnvironment.preparePullRequestThread, {
    reportFailure: false,
  });
  const [checkoutPending, setCheckoutPending] = useState<"local" | "worktree" | null>(null);

  const handleCheckout = useCallback(
    async (mode: "local" | "worktree") => {
      if (prNumber === null || !cwd || !environmentId) return;
      setCheckoutPending(mode);
      const result = await preparePullRequestThread({
        environmentId,
        input: { cwd, reference: String(prNumber), mode },
      });
      setCheckoutPending(null);
      if (result._tag === "Success") {
        refreshPullRequests({ environmentId, cwd });
        toastManager.add({
          type: "success",
          title: mode === "local" ? "Branch checked out" : "Worktree created",
          description:
            mode === "local"
              ? `Switched to branch ${result.value.branch}`
              : `Worktree created at ${result.value.worktreePath ?? result.value.branch}`,
        });
        return;
      }
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: mode === "local" ? "Checkout failed" : "Worktree creation failed",
          description: failure instanceof Error ? failure.message : "An error occurred.",
        });
      }
    },
    [cwd, environmentId, preparePullRequestThread, prNumber],
  );

  const [draftComment, setDraftComment] = useState("");
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [postCommentError, setPostCommentError] = useState<string | null>(null);

  const handleSubmitComment = useCallback(async () => {
    const body = draftComment.trim();
    if (!body || prNumber === null || environmentId === null || cwd === null) return;
    setIsPostingComment(true);
    setPostCommentError(null);
    const result = await postIssueComment({ environmentId, input: { cwd, prNumber, body } });
    setIsPostingComment(false);
    if (result._tag === "Success") {
      setDraftComment("");
      refreshPullRequestComments({ environmentId, cwd, prNumber });
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setPostCommentError(failure instanceof Error ? failure.message : "Failed to post comment");
    }
  }, [draftComment, postIssueComment, prNumber, environmentId, cwd]);

  const files = useMemo(() => diffQuery.data?.files ?? [], [diffQuery.data?.files]);
  const filePaths = useMemo(() => files.map((file) => file.path), [files]);
  const fullDiff = diffQuery.data?.fullDiff ?? "";

  const { isViewed, setViewed, toggleViewed, viewedCount, totalCount } = usePullRequestViewedFiles({
    cwd,
    prNumber,
    fullDiff,
    filePaths,
    githubViewedPaths: viewedFilesQuery.data?.viewedPaths,
    onSetViewed: useCallback(
      (filePath: string, viewed: boolean) => {
        if (environmentId === null || cwd === null || prNumber === null) return;
        void setFileViewed({
          environmentId,
          input: { cwd, prNumber, path: filePath, viewed },
        });
      },
      [setFileViewed, environmentId, cwd, prNumber],
    ),
  });

  const openFileIndex = useMemo(
    () => (openFilePath === null ? -1 : filePaths.indexOf(openFilePath)),
    [filePaths, openFilePath],
  );

  const goToFileAt = useCallback(
    (nextIndex: number) => {
      if (nextIndex < 0 || nextIndex >= filePaths.length) return;
      const nextPath = filePaths[nextIndex];
      if (nextPath !== undefined) onFilePathChange?.(nextPath);
    },
    [filePaths],
  );

  const handlePreviousFile = useCallback(() => {
    if (openFileIndex <= 0) return;
    goToFileAt(openFileIndex - 1);
  }, [goToFileAt, openFileIndex]);

  const handleNextFile = useCallback(() => {
    if (openFileIndex < 0 || openFileIndex >= filePaths.length - 1) return;
    goToFileAt(openFileIndex + 1);
  }, [filePaths.length, goToFileAt, openFileIndex]);

  const canGoPrevious = openFileIndex > 0;
  const canGoNext = openFileIndex >= 0 && openFileIndex < filePaths.length - 1;
  const positionLabel = openFileIndex >= 0 ? `${openFileIndex + 1} / ${filePaths.length}` : null;

  const comments = useMemo(
    () =>
      toCommentItems({
        issues: issueCommentsQuery.data?.comments ?? [],
        reviews: reviewCommentsQuery.data?.comments ?? [],
      }),
    [issueCommentsQuery.data?.comments, reviewCommentsQuery.data?.comments],
  );

  // Shared file list scroll area used in both normal and sidebar modes.
  const fileListScrollArea = (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {diffQuery.isPending ? (
        <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
          <Spinner className="mr-2 size-3.5" />
          Loading files...
        </div>
      ) : diffQuery.error !== null ? (
        <div className="flex flex-col items-center gap-1 px-3 py-6 text-center text-xs text-destructive">
          <AlertCircleIcon className="size-4" aria-hidden="true" />
          {diffQuery.error ?? "Failed to load diff."}
        </div>
      ) : files.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">No files changed.</p>
      ) : (
        <ul className="space-y-0.5">
          {files.map((file) => {
            const viewed = isViewed(file.path);
            return (
              <li key={file.path}>
                <div
                  className={cn(
                    "group flex items-center gap-2 rounded px-2 py-1.5 text-xs text-foreground hover:bg-muted",
                    viewed && "opacity-60",
                    openFilePath === file.path && "bg-muted",
                  )}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
                    onClick={() => onFilePathChange?.(file.path)}
                  >
                    <span className="relative shrink-0">
                      <VscodeEntryIcon
                        pathValue={file.path}
                        kind="file"
                        theme={resolvedTheme === "dark" ? "dark" : "light"}
                        className="size-4"
                      />
                      <span
                        className={cn(
                          "absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-1 ring-background",
                          file.status === "A" && "bg-emerald-500",
                          file.status === "D" && "bg-destructive",
                          file.status === "R" && "bg-amber-500",
                          file.status === "M" && "bg-muted-foreground/50",
                        )}
                        aria-hidden="true"
                      />
                    </span>
                    <span
                      className="min-w-0 flex-1 overflow-hidden"
                      title={`${statusLabel(file.status)} · ${file.path}`}
                    >
                      <span
                        className={cn("block truncate font-mono text-xs", viewed && "line-through")}
                      >
                        {basenameOfPath(file.path)}
                      </span>
                      {file.path.includes("/") && (
                        <span className="block truncate font-mono text-[10px] text-muted-foreground/70">
                          {file.path.slice(0, file.path.lastIndexOf("/"))}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                      {statusLabel(file.status)}
                    </span>
                  </button>
                  <label
                    className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-muted-foreground"
                    title={viewed ? "Marked as viewed" : "Mark as viewed"}
                  >
                    <Checkbox
                      checked={viewed}
                      onCheckedChange={(value) => setViewed(file.path, value === true)}
                    />
                    <span className="select-none">Viewed</span>
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  if (prNumber === null || !cwd) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
        Select a pull request to review.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground">
            {title ?? `Pull request #${prNumber}`}
          </h2>
          <p className="truncate text-[11px] text-muted-foreground">
            #{prNumber}
            {headRefName ? ` · ${headRefName}` : ""}
            {authorLogin ? ` · ${authorLogin}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {environmentId && cwd && prNumber !== null ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleCheckout("local")}
                disabled={checkoutPending !== null}
                title="Checkout this PR branch in your current workspace"
              >
                {checkoutPending === "local" ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <GitBranchIcon className="size-3.5" aria-hidden="true" />
                )}
                Checkout
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleCheckout("worktree")}
                disabled={checkoutPending !== null}
                title="Open this PR in a new git worktree"
              >
                {checkoutPending === "worktree" ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <FolderGit2Icon className="size-3.5" aria-hidden="true" />
                )}
                New worktree
              </Button>
            </>
          ) : null}
          {onReview ? (
            <Button
              type="button"
              size="sm"
              onClick={onReview}
              disabled={isReviewPending}
              title="Open this pull request in a new agent thread with a pre-filled review prompt"
            >
              {isReviewPending ? (
                <Spinner className="size-3.5" />
              ) : (
                <BotIcon className="size-3.5" aria-hidden="true" />
              )}
              Review with agent
            </Button>
          ) : null}
          {url && onOpenExternal ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenExternal(url)}>
              <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
              GitHub
            </Button>
          ) : null}
          {onClose ? (
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          ) : null}
        </div>
      </header>

      {openFilePath !== null ? (
        // File open mode: compact file list on the left, diff view on the right.
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex w-80 shrink-0 flex-col overflow-hidden border-r border-border/70">
            <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Files ({files.length})
              </h3>
              {totalCount > 0 ? (
                <span className="tabular-nums text-[11px] text-muted-foreground">
                  {viewedCount} / {totalCount} viewed
                </span>
              ) : null}
            </div>
            {fileListScrollArea}
          </div>

          <PullRequestFileDiffView
            environmentId={environmentId}
            cwd={cwd}
            prNumber={prNumber}
            filePath={openFilePath}
            onClose={() => onFilePathChange?.(null)}
            isViewed={isViewed(openFilePath)}
            onToggleViewed={() => toggleViewed(openFilePath)}
            onPrevious={handlePreviousFile}
            onNext={handleNextFile}
            canGoPrevious={canGoPrevious}
            canGoNext={canGoNext}
            positionLabel={positionLabel}
          />
        </div>
      ) : (
        // Normal mode: file list in the middle, discussion sidebar on the right.
        <div className="flex min-h-0 flex-1">
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Files ({files.length})
              </h3>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                {totalCount > 0 ? (
                  <span className="tabular-nums">
                    {viewedCount} / {totalCount} viewed
                  </span>
                ) : null}
                <span className="hidden sm:inline">Click a file to view its diff.</span>
              </div>
            </div>
            {fileListScrollArea}
          </main>

          <aside className="flex w-96 shrink-0 flex-col overflow-hidden border-l border-border/70">
            <div className="border-b border-border/70 px-3 py-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Discussion
              </h3>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="space-y-3">
                {bodyQuery.isPending ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Spinner className="size-3" />
                    Loading PR body...
                  </div>
                ) : bodyQuery.data?.body ? (
                  <article className="rounded-lg border border-border/70 bg-background p-3">
                    <header className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">{authorLogin ?? "author"}</span>
                      <span>description</span>
                    </header>
                    <ChatMarkdown text={bodyQuery.data.body} cwd={undefined} />
                  </article>
                ) : null}

                {reviewCommentsQuery.error !== null ? (
                  <p className="text-xs text-destructive">Failed to load review comments.</p>
                ) : null}
                {issueCommentsQuery.error !== null ? (
                  <p className="text-xs text-destructive">Failed to load issue comments.</p>
                ) : null}

                {comments.length === 0 &&
                !reviewCommentsQuery.isPending &&
                !issueCommentsQuery.isPending ? (
                  <p className="px-1 text-xs text-muted-foreground">No comments yet.</p>
                ) : null}
                {comments.map((item) => (
                  <CommentEntry key={item.id} item={item} />
                ))}
              </div>
            </div>

            <form
              className="space-y-2 border-t border-border/70 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSubmitComment();
              }}
            >
              <label className="block text-[11px] font-medium text-muted-foreground">
                Leave a comment
              </label>
              <textarea
                value={draftComment}
                onChange={(event) => setDraftComment(event.target.value)}
                rows={3}
                placeholder="Write a comment..."
                className="w-full resize-none rounded-md border border-border/70 bg-background p-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
                disabled={isPostingComment}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">{postCommentError ?? ""}</span>
                <Button
                  type="submit"
                  size="sm"
                  disabled={draftComment.trim().length === 0 || isPostingComment}
                >
                  {isPostingComment ? (
                    <Spinner className="size-3" />
                  ) : (
                    <SendIcon className="size-3.5" aria-hidden="true" />
                  )}
                  Post
                </Button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </div>
  );
}

interface PullRequestFileDiffViewProps {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  prNumber: number | null;
  filePath: string;
  onClose: () => void;
  isViewed: boolean;
  onToggleViewed: () => void;
  onPrevious: () => void;
  onNext: () => void;
  canGoPrevious: boolean;
  canGoNext: boolean;
  positionLabel: string | null;
}

function PullRequestFileDiffView({
  environmentId,
  cwd,
  prNumber,
  filePath,
  onClose,
  isViewed,
  onToggleViewed,
  onPrevious,
  onNext,
  canGoPrevious,
  canGoNext,
  positionLabel,
}: PullRequestFileDiffViewProps) {
  const { resolvedTheme } = useTheme();
  const [diffStyle, setDiffStyle] = useState<"unified" | "split">("unified");

  const fileDiffQuery = useEnvironmentQuery(
    environmentId !== null && cwd !== null && prNumber !== null
      ? gitPrEnvironment.pullRequestFileDiff({ environmentId, input: { cwd, prNumber, filePath } })
      : null,
  );

  const patchRender = useMemo(
    () => renderPatch(fileDiffQuery.data?.diff, `pr-${prNumber ?? "x"}-file-${filePath}`),
    [fileDiffQuery.data?.diff, prNumber, filePath],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      if (event.key === "ArrowLeft" && canGoPrevious) {
        event.preventDefault();
        onPrevious();
      } else if (event.key === "ArrowRight" && canGoNext) {
        event.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [canGoPrevious, canGoNext, onPrevious, onNext]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={!canGoPrevious}
              onClick={onPrevious}
              title="Previous file (←)"
              aria-label="Previous file"
            >
              <ChevronLeftIcon aria-hidden="true" />
            </Button>
            <label
              className="flex shrink-0 cursor-pointer items-center gap-1.5 px-1 text-xs text-muted-foreground"
              title={isViewed ? "Marked as viewed" : "Mark as viewed"}
            >
              <Checkbox
                checked={isViewed}
                onCheckedChange={(value) => {
                  if ((value === true) !== isViewed) onToggleViewed();
                }}
              />
              <span className="select-none">Viewed</span>
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={!canGoNext}
              onClick={onNext}
              title="Next file (→)"
              aria-label="Next file"
            >
              <ChevronRightIcon aria-hidden="true" />
            </Button>
          </div>
          {positionLabel ? (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {positionLabel}
            </span>
          ) : null}
          <span className="min-w-0 truncate font-mono text-sm">{filePath}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ToggleGroup
            variant="outline"
            size="xs"
            value={[diffStyle]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "unified" || next === "split") {
                setDiffStyle(next);
              }
            }}
          >
            <Toggle aria-label="Unified diff view" value="unified" title="Unified diff">
              <Rows3Icon className="size-3" />
            </Toggle>
            <Toggle aria-label="Split diff view" value="split" title="Split diff">
              <Columns2Icon className="size-3" />
            </Toggle>
          </ToggleGroup>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {fileDiffQuery.isPending ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            <Spinner className="mr-2 size-3.5" />
            Loading diff...
          </div>
        ) : fileDiffQuery.error !== null ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-3 text-center text-xs text-destructive">
            <AlertCircleIcon className="size-4" aria-hidden="true" />
            {fileDiffQuery.error ?? "Failed to load file diff."}
          </div>
        ) : patchRender?.kind === "files" ? (
          <div className="diff-render-surface">
            {patchRender.files.map((fileDiff) => (
              <div
                key={fileDiff.cacheKey ?? resolveFileDiffPath(fileDiff)}
                className="diff-render-file rounded-md"
              >
                <FileDiff
                  fileDiff={fileDiff}
                  options={{
                    diffStyle: diffStyle,
                    lineDiffType: "none",
                    overflow: "wrap",
                    theme: resolveDiffThemeName(resolvedTheme),
                    themeType: resolvedTheme,
                  }}
                />
              </div>
            ))}
          </div>
        ) : patchRender?.kind === "raw" ? (
          <div>
            <p className="mb-2 text-[11px] text-muted-foreground/75">{patchRender.reason}</p>
            <pre className="overflow-auto rounded-md border border-border/70 bg-background p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90">
              {patchRender.text}
            </pre>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No diff available.
          </div>
        )}
      </div>
    </div>
  );
}

function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? "";
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2);
  }
  return raw;
}

export const PULL_REQUEST_REVIEW_VIEW_MESSAGE_ICON = MessageCircleIcon;

export type PullRequestReviewPromptVariant = "review" | "review-with-tests";

interface BuildPullRequestReviewPromptInput {
  prNumber: number;
  variant?: PullRequestReviewPromptVariant;
}

/**
 * The agent review runs the personal `test-and-review` skill (user scope,
 * `~/.claude/skills`). A `$skill` mention is what the composer emits for
 * every provider; the Claude adapter turns it into the `/skill args`
 * invocation. The skill fetches the PR context itself, so only the number
 * and the tests opt-out travel in the prompt.
 */
export function buildPullRequestReviewPrompt(input: BuildPullRequestReviewPromptInput): string {
  const prompt = `$test-and-review ${input.prNumber}`;
  return input.variant === "review-with-tests" ? prompt : `${prompt} --review-only`;
}
