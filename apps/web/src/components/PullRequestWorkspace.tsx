import type { EnvironmentId, PullRequestSummary } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { BotIcon, ExternalLinkIcon, FileTextIcon, FilesIcon, MessageCircleIcon } from "lucide-react";
import { useMemo } from "react";

import { gitPullRequestReviewCommentsQueryOptions } from "~/lib/gitPRReactQuery";
import { cn } from "~/lib/utils";
import { PullRequestConversationPane } from "./PullRequestConversationPane";
import { PullRequestFilesPane } from "./PullRequestFilesPane";
import PullRequestOverviewPanel from "./PullRequestOverviewPanel";
import { PullRequestReviewSidebar } from "./PullRequestReviewSidebar";
import { PullRequestThreadsPane } from "./PullRequestThreadsPane";

export type PullRequestWorkspaceView = "overview" | "files" | "conversation" | "threads";

interface PullRequestWorkspaceProps {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  prNumber: number;
  prSummary: PullRequestSummary | null;
  view: PullRequestWorkspaceView;
  onViewChange: (view: PullRequestWorkspaceView) => void;
  openFilePath: string | null;
  onFilePathChange: (filePath: string | null) => void;
  onOpenExternal?: ((url: string) => void) | undefined;
  onReviewWithAgent?: (() => void) | undefined;
  isAgentReviewPending?: boolean | undefined;
  onCheckout?: ((mode: "local" | "worktree") => void) | undefined;
  isCheckoutPending?: "local" | "worktree" | null | undefined;
}

const TABS: { value: PullRequestWorkspaceView; label: string; Icon: typeof FileTextIcon }[] = [
  { value: "overview", label: "Overview", Icon: FileTextIcon },
  { value: "files", label: "Files", Icon: FilesIcon },
  { value: "conversation", label: "Conversation", Icon: MessageCircleIcon },
  { value: "threads", label: "Threads", Icon: BotIcon },
];

export function PullRequestWorkspace({
  environmentId,
  cwd,
  prNumber,
  prSummary,
  view,
  onViewChange,
  openFilePath,
  onFilePathChange,
  onOpenExternal,
  onReviewWithAgent,
  isAgentReviewPending,
  onCheckout,
  isCheckoutPending,
}: PullRequestWorkspaceProps) {
  const reviewCommentsQuery = useQuery(
    gitPullRequestReviewCommentsQueryOptions({ environmentId, cwd, prNumber }),
  );

  const reviewComments = reviewCommentsQuery.data?.comments;

  const handleJumpToFile = useMemo(
    () => (filePath: string, line?: number) => {
      onFilePathChange(filePath);
      onViewChange("files");
    },
    [onFilePathChange, onViewChange],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {/* Top bar: PR info + mode tabs */}
      <header className="flex items-center gap-3 border-b border-border/70 px-4 py-2">
        <div className="mr-2 min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground">
            {prSummary?.title ?? `Pull request #${prNumber}`}
          </h2>
          <p className="truncate text-[11px] text-muted-foreground">
            #{prNumber}
            {prSummary?.headRefName ? ` · ${prSummary.headRefName}` : ""}
            {prSummary?.author ? ` · ${prSummary.author}` : ""}
          </p>
        </div>

        {/* Mode tabs */}
        <nav className="flex items-center gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => onViewChange(tab.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                view === tab.value
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <tab.Icon className="size-3.5" aria-hidden="true" />
              {tab.label}
            </button>
          ))}
        </nav>

        {prSummary?.url && onOpenExternal ? (
          <button
            type="button"
            onClick={() => onOpenExternal(prSummary.url)}
            className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            title="Open on GitHub"
          >
            <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </header>

      {/* Main area: content + sidecar */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* Content area */}
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">
          {view === "overview" && (
            <PullRequestOverviewPanel
              environmentId={environmentId}
              cwd={cwd}
              prNumber={prNumber}
              prUrl={prSummary?.url ?? null}
              onSwitchToFiles={() => onViewChange("files")}
              onSwitchToConversation={() => onViewChange("conversation")}
            />
          )}
          {view === "files" && (
            <PullRequestFilesPane
              environmentId={environmentId}
              cwd={cwd}
              prNumber={prNumber}
              openFilePath={openFilePath}
              onFilePathChange={onFilePathChange}
              reviewComments={reviewComments ?? []}
            />
          )}
          {view === "conversation" && (
            <PullRequestConversationPane
              environmentId={environmentId}
              cwd={cwd}
              prNumber={prNumber}
              authorLogin={prSummary?.author ?? null}
              onJumpToFile={handleJumpToFile}
            />
          )}
          {view === "threads" && (
            <PullRequestThreadsPane
              environmentId={environmentId}
              prNumber={prNumber}
              onReviewWithAgent={onReviewWithAgent}
              isAgentReviewPending={isAgentReviewPending}
            />
          )}
        </main>

        {/* Right sidecar — only on overview, hidden below xl breakpoint (1280px) */}
        <div className={cn("hidden", view === "overview" && "xl:flex")}>
          <PullRequestReviewSidebar
            environmentId={environmentId}
            cwd={cwd}
            prNumber={prNumber}
            onReviewWithAgent={onReviewWithAgent}
            isAgentReviewPending={isAgentReviewPending}
            onCheckout={onCheckout}
            isCheckoutPending={isCheckoutPending}
          />
        </div>
      </div>
    </div>
  );
}
