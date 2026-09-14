import { create } from "zustand";

const PR_LAST_PROJECT_KEY = "t3code:pr-last-project-id";

interface PrViewState {
  /** The project whose pull requests the sidebar lists, as a scoped project key. */
  projectKey: string | null;
  /** The chat route left to enter pull-request mode, so leaving returns to the same thread. */
  lastChatPath: string | null;
}

interface PrViewActions {
  setProjectKey: (projectKey: string) => void;
  setLastChatPath: (path: string) => void;
}

function readLastProjectKey(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(PR_LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

export const usePrViewStore = create<PrViewState & PrViewActions>((set) => ({
  projectKey: readLastProjectKey(),
  lastChatPath: null,
  setProjectKey: (projectKey) => {
    try {
      window.localStorage.setItem(PR_LAST_PROJECT_KEY, projectKey);
    } catch {
      // Storage can be full or denied; the in-memory choice still holds for this visit.
    }
    set({ projectKey });
  },
  setLastChatPath: (lastChatPath) => set({ lastChatPath }),
}));
