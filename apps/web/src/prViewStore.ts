import { create } from "zustand";
import type { PullRequestWorkspaceView } from "./components/PullRequestWorkspace";

const PR_LAST_PROJECT_KEY = "t3code:pr-last-project-id";
const PR_LAST_STATE_KEY = "t3code:pr-last-state";

export interface PrViewState {
  projectKey: string | null;
  prNumber: number | null;
  view: PullRequestWorkspaceView;
  filePath: string | null;
  lastChatPath: string | null;
  hasBeenActivated: boolean;
}

export interface PrViewActions {
  selectPr: (prNumber: number) => void;
  closePr: () => void;
  setView: (view: PullRequestWorkspaceView) => void;
  setFilePath: (filePath: string | null) => void;
  setProjectKey: (projectKey: string) => void;
  setLastChatPath: (path: string) => void;
  activate: () => void;
  hydrateFromRoute: (search: {
    readonly projectId?: string | undefined;
    readonly prNumber?: number | undefined;
    readonly filePath?: string | undefined;
    readonly view?: PullRequestWorkspaceView | undefined;
  }) => void;
}

function persistToLocalStorage(state: PrViewState) {
  if (state.projectKey) {
    window.localStorage.setItem(PR_LAST_PROJECT_KEY, state.projectKey);
  }
  const obj: Record<string, unknown> = {};
  if (state.projectKey) obj.projectId = state.projectKey;
  if (state.prNumber !== null) obj.prNumber = state.prNumber;
  if (state.filePath !== null) obj.filePath = state.filePath;
  if (state.view !== "overview") obj.view = state.view;
  window.localStorage.setItem(PR_LAST_STATE_KEY, JSON.stringify(obj));
}

function loadInitialState(): PrViewState {
  let projectKey: string | null = null;
  let prNumber: number | null = null;
  let filePath: string | null = null;
  let view: PullRequestWorkspaceView = "overview";

  try {
    projectKey = window.localStorage.getItem(PR_LAST_PROJECT_KEY);
    const raw = window.localStorage.getItem(PR_LAST_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.projectId === "string") projectKey = parsed.projectId;
        if (typeof parsed.prNumber === "number" && parsed.prNumber > 0)
          prNumber = parsed.prNumber;
        if (typeof parsed.filePath === "string" && parsed.filePath.length > 0)
          filePath = parsed.filePath;
        if (
          typeof parsed.view === "string" &&
          (parsed.view === "overview" || parsed.view === "files" || parsed.view === "conversation" || parsed.view === "threads")
        )
          view = parsed.view;
      }
    }
  } catch {
    // ignore
  }

  return {
    projectKey,
    prNumber,
    view,
    filePath,
    lastChatPath: null,
    hasBeenActivated: false,
  };
}

export const usePrViewStore = create<PrViewState & PrViewActions>()((set, get) => ({
  ...loadInitialState(),

  selectPr: (prNumber) => {
    const next = { ...get(), prNumber, view: "overview" as const, filePath: null };
    persistToLocalStorage(next);
    set({ prNumber, view: "overview", filePath: null });
  },

  closePr: () => {
    const next = { ...get(), prNumber: null, filePath: null, view: "overview" as const };
    persistToLocalStorage(next);
    set({ prNumber: null, filePath: null, view: "overview" });
  },

  setView: (view) => {
    const state = get();
    const filePath = view === "files" ? state.filePath : null;
    const next = { ...state, view, filePath };
    persistToLocalStorage(next);
    set({ view, filePath });
  },

  setFilePath: (filePath) => {
    const next = { ...get(), filePath, view: "files" as const };
    persistToLocalStorage(next);
    set({ filePath, view: "files" });
  },

  setProjectKey: (projectKey) => {
    const next = {
      ...get(),
      projectKey,
      prNumber: null,
      filePath: null,
      view: "overview" as const,
    };
    persistToLocalStorage(next);
    set({ projectKey, prNumber: null, filePath: null, view: "overview" });
  },

  setLastChatPath: (path) => {
    set({ lastChatPath: path });
  },

  activate: () => {
    set({ hasBeenActivated: true });
  },

  hydrateFromRoute: (search) => {
    const state = get();
    const projectKey = search.projectId ?? state.projectKey;
    const prNumber =
      search.prNumber !== undefined ? search.prNumber : state.prNumber;
    const filePath = search.filePath ?? null;
    const view = search.view ?? "overview";
    const next = { ...state, projectKey, prNumber, filePath, view, hasBeenActivated: true };
    persistToLocalStorage(next);
    set({ projectKey, prNumber, filePath, view, hasBeenActivated: true });
  },
}));
