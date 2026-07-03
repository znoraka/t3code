import type { EnvironmentId, PullRequestMergeMethod } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { GitMergeIcon } from "lucide-react";
import { useState } from "react";

import { gitPrEnvironment, refreshPullRequestDetail, refreshPullRequests } from "~/state/gitPr";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Spinner } from "./ui/spinner";
import { toastManager } from "./ui/toast";

interface PullRequestMergeButtonProps {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  prNumber: number | null;
  disabled?: boolean;
  disabledReason?: string;
}

const METHODS: ReadonlyArray<{ value: PullRequestMergeMethod; label: string; hint: string }> = [
  { value: "squash", label: "Squash and merge", hint: "Combine all commits into one" },
  { value: "merge", label: "Create merge commit", hint: "Preserve history with a merge commit" },
  { value: "rebase", label: "Rebase and merge", hint: "Replay commits onto the base branch" },
];

export function PullRequestMergeButton({
  environmentId,
  cwd,
  prNumber,
  disabled,
  disabledReason,
}: PullRequestMergeButtonProps) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<PullRequestMergeMethod>("squash");
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [isMerging, setIsMerging] = useState(false);

  const mergePullRequest = useAtomCommand(gitPrEnvironment.mergePullRequest, {
    reportFailure: false,
  });

  const handleMerge = async () => {
    if (!cwd || prNumber === null || !environmentId) return;
    setIsMerging(true);
    const result = await mergePullRequest({
      environmentId,
      input: { cwd, prNumber, method, deleteBranch },
    });
    setIsMerging(false);
    if (result._tag === "Success") {
      refreshPullRequestDetail({ environmentId, cwd, prNumber });
      refreshPullRequests({ environmentId, cwd });
      toastManager.add({
        type: "success",
        title: "Pull request merged",
        description: `Merged with method "${method}"`,
      });
      setOpen(false);
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Failed to merge",
        description: failure instanceof Error ? failure.message : "An error occurred.",
      });
    }
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? (disabledReason ?? "Cannot merge") : "Merge this pull request"}
      >
        <GitMergeIcon className="size-3.5" aria-hidden="true" />
        Merge
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!isMerging) setOpen(next);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Merge pull request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 px-1">
            <fieldset className="space-y-1.5">
              <legend className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Method
              </legend>
              {METHODS.map((entry) => (
                <label
                  key={entry.value}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-border/70 px-3 py-2 text-sm hover:bg-muted/40"
                >
                  <input
                    type="radio"
                    name="merge-method"
                    value={entry.value}
                    checked={method === entry.value}
                    onChange={() => setMethod(entry.value)}
                    disabled={isMerging}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <p className="font-medium">{entry.label}</p>
                    <p className="text-[11px] text-muted-foreground">{entry.hint}</p>
                  </div>
                </label>
              ))}
            </fieldset>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={deleteBranch}
                onChange={(event) => setDeleteBranch(event.target.checked)}
                disabled={isMerging}
              />
              Delete branch after merge
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={isMerging}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void handleMerge()} disabled={isMerging}>
              {isMerging ? <Spinner className="size-3.5" /> : null}
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
