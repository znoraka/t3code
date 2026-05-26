import { create } from "zustand";

const STORAGE_KEY = "t3code:t3chat-auth:v1";

interface T3ChatAuthState {
  wosSession: string | null;
  convexSessionId: string | null;
}

interface T3ChatAuthActions {
  setCredentials: (wosSession: string, convexSessionId: string) => void;
  updateWosSession: (wosSession: string) => void;
  clearCredentials: () => void;
}

function loadFromStorage(): T3ChatAuthState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return {
          wosSession: typeof parsed.wosSession === "string" ? parsed.wosSession : null,
          convexSessionId:
            typeof parsed.convexSessionId === "string" ? parsed.convexSessionId : null,
        };
      }
    }
  } catch {
    // ignore
  }
  return { wosSession: null, convexSessionId: null };
}

function persistToStorage(state: T3ChatAuthState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const useT3ChatAuthStore = create<T3ChatAuthState & T3ChatAuthActions>()((set) => ({
  ...loadFromStorage(),

  setCredentials: (wosSession, convexSessionId) => {
    const next = { wosSession, convexSessionId };
    persistToStorage(next);
    set(next);
  },

  updateWosSession: (wosSession) => {
    set((prev) => {
      const next = { ...prev, wosSession };
      persistToStorage(next);
      return next;
    });
  },

  clearCredentials: () => {
    const next = { wosSession: null, convexSessionId: null };
    persistToStorage(next);
    set(next);
  },
}));
