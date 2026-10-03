import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import type { ThreadId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";
import { useThreadShells } from "../state/entities";
import { playDoneSound, playQuestionSound } from "../notificationSound";

interface TrackedThreadState {
  sessionRunning: boolean;
  needsAttention: boolean;
}

/**
 * Plays a sound when any thread finishes working (done chime) or starts
 * waiting for user input / approval (attention chime).
 */
export function useNotificationSounds() {
  const threads = useThreadShells();
  const prevStateRef = useRef<Map<ThreadId, TrackedThreadState>>(new Map());
  // Skip sound playback on the very first render so we don't flood sounds on app load.
  const initializedRef = useRef(false);

  useEffect(() => {
    const prevState = prevStateRef.current;

    let playDone = false;
    let playQuestion = false;

    for (const thread of threads) {
      const sessionRunning = threadRuntimeIsActive(thread.runtime);
      const needsAttention = thread.hasPendingApprovals || thread.hasPendingUserInput;

      const prev = prevState.get(thread.id);

      if (initializedRef.current && prev) {
        // Running → not running: agent finished
        if (prev.sessionRunning && !sessionRunning) {
          playDone = true;
        }
        // Attention state went false → true: needs user action
        if (!prev.needsAttention && needsAttention) {
          playQuestion = true;
        }
      }

      prevState.set(thread.id, { sessionRunning, needsAttention });
    }

    // Remove threads that no longer exist
    const threadIds = new Set(threads.map((t) => t.id));
    for (const id of prevState.keys()) {
      if (!threadIds.has(id)) {
        prevState.delete(id);
      }
    }

    initializedRef.current = true;

    // Question sound takes priority over done sound when both fire at once
    if (playQuestion) {
      playQuestionSound();
    } else if (playDone) {
      playDoneSound();
    }
  }, [threads]);
}
