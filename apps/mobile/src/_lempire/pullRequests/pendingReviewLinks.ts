// [FORK] lempire: PR links waiting for their review thread to exist.
//
// "Review with agent" opens a draft in the project without checking anything
// out, so there is no thread to link yet — and unlike web, the phone does not
// know the thread id at that point either: it is minted when the draft is sent.
// So a link waits under its draft key, is claimed with the thread id at send
// (the one place both exist, see `NewTaskDraftScreen`), and is written onto the
// thread once its shell arrives.
//
// Held in memory rather than persisted: an app killed mid-draft loses the link,
// not the review — the verdict still arrives through plandrop's index, and the
// thread can be linked by hand. Persisting seconds of state would mean a schema
// in the mobile preferences store.
import { useAtomValue } from "@effect/atom-react";
import type { ThreadId, ThreadLinkedPullRequest } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useEffect } from "react";

import { appAtomRegistry } from "../../state/atom-registry";
import { useThreadShells } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

/** Reviews opened but never sent are dead weight; keep only the recent ones. */
const MAX_UNSENT_DRAFTS = 20;

interface PendingReviewLinks {
  /** Drafts opened by "Review with agent" that have not been sent yet. */
  readonly byDraftKey: ReadonlyMap<string, ThreadLinkedPullRequest>;
  /** Sent reviews whose thread has not appeared yet. */
  readonly byThreadId: ReadonlyMap<ThreadId, ThreadLinkedPullRequest>;
}

const EMPTY: PendingReviewLinks = { byDraftKey: new Map(), byThreadId: new Map() };

const pendingReviewLinksAtom = Atom.make<PendingReviewLinks>(EMPTY).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:_lempire:pending-review-links"),
);

/** Called when the review draft is opened. */
export function rememberPendingReviewLink(draftKey: string, link: ThreadLinkedPullRequest): void {
  appAtomRegistry.modify(pendingReviewLinksAtom, (current) => {
    const byDraftKey = new Map(current.byDraftKey);
    byDraftKey.delete(draftKey);
    byDraftKey.set(draftKey, link);
    while (byDraftKey.size > MAX_UNSENT_DRAFTS) {
      const oldest = byDraftKey.keys().next().value;
      if (oldest === undefined) break;
      byDraftKey.delete(oldest);
    }
    return [undefined, { ...current, byDraftKey }];
  });
}

/**
 * Called when a draft is sent and its thread id exists. A draft nobody opened
 * through "Review with agent" claims nothing.
 */
export function claimPendingReviewLink(draftKey: string, threadId: ThreadId): void {
  appAtomRegistry.modify(pendingReviewLinksAtom, (current) => {
    const link = current.byDraftKey.get(draftKey);
    if (link === undefined) return [undefined, current];
    const byDraftKey = new Map(current.byDraftKey);
    byDraftKey.delete(draftKey);
    const byThreadId = new Map(current.byThreadId);
    byThreadId.set(threadId, link);
    return [undefined, { byDraftKey, byThreadId }];
  });
}

function forgetClaimedLink(threadId: ThreadId): void {
  appAtomRegistry.modify(pendingReviewLinksAtom, (current) => {
    if (!current.byThreadId.has(threadId)) return [undefined, current];
    const byThreadId = new Map(current.byThreadId);
    byThreadId.delete(threadId);
    return [undefined, { ...current, byThreadId }];
  });
}

/**
 * Writes claimed links onto their threads once those exist. Mounted in the
 * app's null-rendering worker leaf, which already watches every thread shell.
 */
export function useApplyPendingReviewLinks(): void {
  const threads = useThreadShells();
  const pending = useAtomValue(pendingReviewLinksAtom);
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });

  useEffect(() => {
    if (pending.byThreadId.size === 0) return;
    for (const thread of threads) {
      const link = pending.byThreadId.get(thread.id);
      if (link === undefined) continue;
      // Clear first so a slow or failing write is never retried on every shell
      // change; a lost link is one menu item away in the thread.
      forgetClaimedLink(thread.id);
      if (thread.linkedPullRequest != null) continue;
      void updateThreadMetadata({
        environmentId: thread.environmentId,
        input: { threadId: thread.id, linkedPullRequest: link },
      });
    }
  }, [pending, threads, updateThreadMetadata]);
}
