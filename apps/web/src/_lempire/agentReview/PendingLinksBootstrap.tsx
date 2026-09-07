// [FORK] lempire: writes pending PR links onto review threads once they exist.
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useEffect } from "react";

import { useThreadShells } from "../../state/entities";
import { forgetPendingLink, readPendingLinks } from "./pendingLinks";

export function PendingLinksBootstrap() {
  const threads = useThreadShells();
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });

  useEffect(() => {
    const pending = readPendingLinks();
    if (pending.size === 0) return;
    for (const thread of threads) {
      const link = pending.get(thread.id);
      if (link === undefined) continue;
      // Clear first so a slow or failing write is never retried on every
      // shell change; a lost link is one right-click away in the thread.
      forgetPendingLink(thread.id);
      if (thread.linkedPullRequest != null) continue;
      void updateThreadMetadata({
        environmentId: thread.environmentId,
        input: { threadId: thread.id, linkedPullRequest: link },
      });
    }
  }, [threads, updateThreadMetadata]);

  return null;
}
