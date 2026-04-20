import { scopeThreadRef } from "@t3tools/client-runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_RUNTIME_MODE } from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitCommitIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { ensureEnvironmentApi } from "~/environmentApi";
import { newCommandId, newMessageId, newThreadId } from "~/lib/utils";
import {
  gitMutationKeys,
  gitStatusQueryOptions,
  invalidateGitQueries,
} from "~/lib/gitPRReactQuery";
import { useStore } from "~/store";
import { createThreadSelectorByRef } from "~/storeSelectors";
import { DEFAULT_INTERACTION_MODE } from "~/types";
import { CommitModal } from "./CommitModal";

interface CommitControlProps {
  environmentId: EnvironmentId | null;
  gitCwd: string | null;
  activeThreadId: ThreadId;
}

export default function CommitControl({
  environmentId,
  gitCwd,
  activeThreadId,
}: CommitControlProps) {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const threadRef = useMemo(
    () => (environmentId ? scopeThreadRef(environmentId, activeThreadId) : null),
    [environmentId, activeThreadId],
  );
  const activeThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));

  const { data: gitStatus = null } = useQuery(
    gitStatusQueryOptions({ environmentId, cwd: gitCwd }),
  );

  const isRepo = gitStatus?.isRepo ?? true;
  const hasChanges = !!gitStatus?.hasWorkingTreeChanges;

  const initMutation = useMutation({
    mutationKey: gitMutationKeys.init(environmentId, gitCwd),
    mutationFn: async () => {
      if (!gitCwd || !environmentId) throw new Error("Git init is unavailable.");
      return ensureEnvironmentApi(environmentId).git.init({ cwd: gitCwd });
    },
    onSuccess: () => invalidateGitQueries(queryClient, { environmentId, cwd: gitCwd }),
  });

  const handleSendToNewChat = useCallback(
    (message: string) => {
      if (!environmentId || !activeThread) {
        toastManager.add({
          type: "error",
          title: "Unable to start commit chat.",
          description: "No active project environment found.",
        });
        return;
      }
      const api = ensureEnvironmentApi(environmentId);
      const threadId = newThreadId();
      const commandId = newCommandId();
      const messageId = newMessageId();
      const createdAt = new Date().toISOString();
      const runtimeMode = activeThread.runtimeMode ?? DEFAULT_RUNTIME_MODE;
      const interactionMode = activeThread.interactionMode ?? DEFAULT_INTERACTION_MODE;

      void api.orchestration
        .dispatchCommand({
          type: "thread.turn.start",
          commandId,
          threadId,
          message: {
            messageId,
            role: "user",
            text: message,
            attachments: [],
          },
          runtimeMode,
          interactionMode,
          createdAt,
          bootstrap: {
            createThread: {
              projectId: activeThread.projectId,
              title: "Commit changes",
              modelSelection: activeThread.modelSelection,
              runtimeMode,
              interactionMode,
              branch: null,
              worktreePath: null,
              createdAt,
            },
          },
        })
        .catch((err: unknown) => {
          toastManager.add({
            type: "error",
            title: "Failed to start commit chat.",
            description: err instanceof Error ? err.message : "An error occurred.",
            data: { threadRef },
          });
        });
    },
    [environmentId, activeThread, threadRef],
  );

  if (!gitCwd) return null;

  if (!isRepo) {
    return (
      <Button
        variant="outline"
        size="xs"
        disabled={initMutation.isPending || !environmentId}
        onClick={() => initMutation.mutate()}
      >
        {initMutation.isPending ? "Initializing..." : "Initialize Git"}
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="xs"
        disabled={!hasChanges}
        onClick={() => setIsModalOpen(true)}
        title={hasChanges ? "Commit changes" : "No changes to commit"}
      >
        <GitCommitIcon className="size-3.5" />
        <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
          Commit
        </span>
      </Button>
      <CommitModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        environmentId={environmentId}
        gitCwd={gitCwd}
        onSendToChat={handleSendToNewChat}
      />
    </>
  );
}
