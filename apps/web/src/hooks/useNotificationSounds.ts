import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectSidebarThreadsAcrossEnvironments, useStore } from "../store";
import { playDoneSound, playQuestionSound } from "../notificationSound";
import type { SidebarThreadSummary } from "../types";

interface TrackedThreadState {
  sessionRunning: boolean;
  needsAttention: boolean;
}

/**
 * Plays a sound when any thread finishes working (done chime) or starts
 * waiting for user input / approval (attention chime).
 */
export function useNotificationSounds() {
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const prevStateRef = useRef<Map<string, TrackedThreadState>>(new Map());
  // Skip sound playback on the very first render so we don't flood sounds on app load.
  const initializedRef = useRef(false);

  useEffect(() => {
    const prevState = prevStateRef.current;

    let playDone = false;
    let playQuestion = false;

    for (const thread of threads as SidebarThreadSummary[]) {
      const sessionRunning = thread.session?.status === "running";
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
