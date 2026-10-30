import { create } from "zustand";

const PR_LAST_PROJECT_KEY = "t3code:pr-last-project-id";
const PR_LAYOUT_KEY = "t3code:pr-layout";

/** `triage` is the fork's bucketed list beside the detail; `upstream` is upstream's own page. */
export type PrLayout = "triage" | "upstream";

interface PrViewState {
  /** The project whose pull requests the sidebar lists, as a scoped project key. */
  projectKey: string | null;
  layout: PrLayout;
}

interface PrViewActions {
  setProjectKey: (projectKey: string) => void;
  setLayout: (layout: PrLayout) => void;
}

function readStored(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be full or denied; the in-memory choice still holds for this visit.
  }
}

export const usePrViewStore = create<PrViewState & PrViewActions>((set) => ({
  projectKey: readStored(PR_LAST_PROJECT_KEY),
  layout: readStored(PR_LAYOUT_KEY) === "upstream" ? "upstream" : "triage",
  setProjectKey: (projectKey) => {
    writeStored(PR_LAST_PROJECT_KEY, projectKey);
    set({ projectKey });
  },
  setLayout: (layout) => {
    writeStored(PR_LAYOUT_KEY, layout);
    set({ layout });
  },
}));
