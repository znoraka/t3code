import type { EnvironmentId } from "@t3tools/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { toastManager } from "~/components/ui/toast";
import { gitStatusQueryOptions, invalidateGitQueries } from "~/lib/gitPRReactQuery";
import { openInPreferredEditor } from "~/editorPreferences";
import { readLocalApi } from "~/localApi";
import { resolvePathLinkTarget } from "~/terminal-links";

interface CommitModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentId: EnvironmentId | null;
  gitCwd: string;
  /** Called with the composed message when the user clicks "Send to Chat". */
  onSendToChat: (message: string) => void;
}

export function CommitModal({
  open,
  onOpenChange,
  environmentId,
  gitCwd,
  onSendToChat,
}: CommitModalProps) {
  const queryClient = useQueryClient();

  const { data: gitStatus = null, isLoading: statusLoading } = useQuery({
    ...gitStatusQueryOptions({ environmentId, cwd: gitCwd }),
    enabled: open && !!gitCwd && !!environmentId,
  });

  const allFiles = useMemo(() => gitStatus?.workingTree.files ?? [], [gitStatus]);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const [newBranch, setNewBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  useEffect(() => {
    if (open) {
      setExcluded(new Set());
      setNewBranch(false);
      setNewBranchName("");
      void invalidateGitQueries(queryClient, { environmentId, cwd: gitCwd });
    }
  }, [open, queryClient, environmentId, gitCwd]);

  const branch = gitStatus?.branch ?? null;
  const isDefaultBranch = gitStatus?.isDefaultBranch ?? false;

  const selectedFiles = useMemo(
    () => allFiles.filter((f) => !excluded.has(f.path)),
    [allFiles, excluded],
  );
  const allSelected = excluded.size === 0;
  const noneSelected = selectedFiles.length === 0;
  const noFiles = !statusLoading && allFiles.length === 0;

  const toggleAll = () => {
    setExcluded(allSelected ? new Set(allFiles.map((f) => f.path)) : new Set());
  };

  const toggleFile = (path: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const openFile = (filePath: string) => {
    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Editor opening is unavailable.",
      });
      return;
    }
    const target = resolvePathLinkTarget(filePath, gitCwd);
    void openInPreferredEditor(api, target).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to open file",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  };

  const handleSendToChat = () => {
    if (noneSelected) return;
    const message = buildCommitChatMessage({
      files: selectedFiles.map((f) => f.path),
      branch,
      isDefaultBranch,
      newBranch,
      newBranchName: newBranchName.trim(),
    });
    onOpenChange(false);
    onSendToChat(message);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Commit changes</DialogTitle>
          <DialogDescription>
            Select files and send the agent an instruction to commit them.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="space-y-3 rounded-lg border border-input bg-muted/40 p-3 text-xs">
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
              <span className="text-muted-foreground">Branch</span>
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{branch ?? "(detached HEAD)"}</span>
                {isDefaultBranch && (
                  <span className="text-right text-warning text-xs">Warning: default branch</span>
                )}
              </span>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {allFiles.length > 0 && (
                    <Checkbox
                      checked={allSelected}
                      indeterminate={!allSelected && !noneSelected}
                      onCheckedChange={toggleAll}
                    />
                  )}
                  <span className="text-muted-foreground">Files</span>
                  {!allSelected && (
                    <span className="text-muted-foreground">
                      ({selectedFiles.length} of {allFiles.length})
                    </span>
                  )}
                </div>
              </div>
              {statusLoading ? (
                <p className="text-muted-foreground">Loading...</p>
              ) : noFiles ? (
                <p className="font-medium">No changes</p>
              ) : (
                <div className="space-y-2">
                  <ScrollArea className="h-48 rounded-md border border-input bg-background">
                    <div className="space-y-1 p-1">
                      {allFiles.map((file) => {
                        const isExcluded = excluded.has(file.path);
                        return (
                          <div
                            key={file.path}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1 font-mono text-xs transition-colors hover:bg-accent/50"
                          >
                            <Checkbox
                              checked={!isExcluded}
                              onCheckedChange={() => toggleFile(file.path)}
                            />
                            <button
                              type="button"
                              className="flex flex-1 items-center justify-between gap-3 truncate text-left"
                              onClick={() => openFile(file.path)}
                            >
                              <span
                                className={`truncate${isExcluded ? " text-muted-foreground" : ""}`}
                              >
                                {file.path}
                              </span>
                              <span className="shrink-0">
                                {isExcluded ? (
                                  <span className="text-muted-foreground">Excluded</span>
                                ) : (
                                  <>
                                    <span className="text-success">+{file.insertions}</span>
                                    <span className="text-muted-foreground"> / </span>
                                    <span className="text-destructive">-{file.deletions}</span>
                                  </>
                                )}
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                  <div className="flex justify-end font-mono">
                    <span className="text-success">
                      +{selectedFiles.reduce((sum, f) => sum + f.insertions, 0)}
                    </span>
                    <span className="text-muted-foreground"> / </span>
                    <span className="text-destructive">
                      -{selectedFiles.reduce((sum, f) => sum + f.deletions, 0)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {!noFiles && (
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <Checkbox checked={newBranch} onCheckedChange={(v) => setNewBranch(v === true)} />
                <span className="text-muted-foreground">Commit on a new branch</span>
              </label>
              {newBranch && (
                <Input
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value.replace(/\s+/g, "-"))}
                  placeholder="branch-name (optional — agent can suggest)"
                  className="font-mono text-xs"
                />
              )}
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={noneSelected} onClick={handleSendToChat}>
            Send to Chat
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

interface BuildCommitChatMessageInput {
  files: string[];
  branch: string | null;
  isDefaultBranch: boolean;
  newBranch: boolean;
  newBranchName: string;
}

export function buildCommitChatMessage(input: BuildCommitChatMessageInput): string {
  const lines: string[] = [];
  lines.push("Please commit the following files:");
  for (const file of input.files) {
    lines.push(`- ${file}`);
  }
  lines.push("");

  if (input.newBranch) {
    if (input.newBranchName.length > 0) {
      lines.push(`Create a new branch named \`${input.newBranchName}\` and commit on it.`);
    } else {
      lines.push(
        "Create a new feature branch (suggest a concise, kebab-case name) and commit on it.",
      );
    }
  } else if (input.branch) {
    if (input.isDefaultBranch) {
      lines.push(
        `Current branch is \`${input.branch}\` (default branch). Ask before committing directly — suggest creating a feature branch instead.`,
      );
    } else {
      lines.push(`Commit on the current branch \`${input.branch}\`.`);
    }
  }

  lines.push("");
  lines.push("Instructions:");
  lines.push("1. Read the diffs of the selected files to understand the changes.");
  lines.push("2. Generate a concise commit message (imperative mood, <=72 char subject).");
  lines.push("3. Show the proposed message and ask me to confirm before committing.");
  lines.push("4. After confirmation, stage only the selected files and commit.");
  lines.push("5. Do NOT push unless I ask.");

  return lines.join("\n");
}

export default CommitModal;
