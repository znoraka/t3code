import { create } from "zustand";
import { fetchModels, type T3ChatModel } from "./lib/t3chatApi";

const THREADS_KEY = "t3code:t3chat-threads:v1";
const MAX_THREADS = 50;

export interface T3ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface T3ChatThread {
  id: string;
  title: string;
  messages: T3ChatMessage[];
  model: string;
  createdAt: string;
  updatedAt: string;
}

interface T3ChatState {
  threads: Record<string, T3ChatThread>;
  activeThreadId: string | null;
  selectedModel: string;
  availableModels: T3ChatModel[];
  isStreaming: boolean;
  streamingContent: string;
  hasBeenActivated: boolean;
}

interface T3ChatActions {
  activate: () => void;
  loadModels: () => Promise<void>;
  createThread: () => string;
  selectThread: (threadId: string) => void;
  deleteThread: (threadId: string) => void;
  setModel: (model: string) => void;
  addUserMessage: (content: string) => void;
  startStreaming: () => void;
  appendStreamDelta: (delta: string) => void;
  finishStreaming: () => void;
  abortStreaming: () => void;
}

function loadThreads(): Record<string, T3ChatThread> {
  try {
    const raw = window.localStorage.getItem(THREADS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return {};
}

function persistThreads(threads: Record<string, T3ChatThread>) {
  const entries = Object.entries(threads)
    .sort(([, a], [, b]) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_THREADS);
  window.localStorage.setItem(THREADS_KEY, JSON.stringify(Object.fromEntries(entries)));
}

export const useT3ChatStore = create<T3ChatState & T3ChatActions>()((set, get) => ({
  threads: loadThreads(),
  activeThreadId: null,
  selectedModel: "claude-4-sonnet",
  availableModels: [],
  isStreaming: false,
  streamingContent: "",
  hasBeenActivated: false,

  activate: () => {
    set({ hasBeenActivated: true });
    get().loadModels();
  },

  loadModels: async () => {
    const models = await fetchModels();
    set({ availableModels: models });
  },

  createThread: () => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const thread: T3ChatThread = {
      id,
      title: "New chat",
      messages: [],
      model: get().selectedModel,
      createdAt: now,
      updatedAt: now,
    };
    const threads = { ...get().threads, [id]: thread };
    persistThreads(threads);
    set({ threads, activeThreadId: id });
    return id;
  },

  selectThread: (threadId) => {
    const thread = get().threads[threadId];
    if (thread) {
      set({ activeThreadId: threadId, selectedModel: thread.model });
    }
  },

  deleteThread: (threadId) => {
    const threads = { ...get().threads };
    delete threads[threadId];
    persistThreads(threads);
    set({
      threads,
      activeThreadId: get().activeThreadId === threadId ? null : get().activeThreadId,
    });
  },

  setModel: (model) => {
    set({ selectedModel: model });
    const { activeThreadId, threads } = get();
    if (activeThreadId && threads[activeThreadId]) {
      const updated = {
        ...threads,
        [activeThreadId]: { ...threads[activeThreadId], model },
      };
      persistThreads(updated);
      set({ threads: updated });
    }
  },

  addUserMessage: (content) => {
    const { activeThreadId, threads } = get();
    if (!activeThreadId) return;
    const thread = threads[activeThreadId];
    if (!thread) return;

    const message: T3ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };

    const title =
      thread.messages.length === 0
        ? content.slice(0, 60) + (content.length > 60 ? "..." : "")
        : thread.title;

    const updated = {
      ...threads,
      [activeThreadId]: {
        ...thread,
        title,
        messages: [...thread.messages, message],
        updatedAt: new Date().toISOString(),
      },
    };
    persistThreads(updated);
    set({ threads: updated });
  },

  startStreaming: () => set({ isStreaming: true, streamingContent: "" }),

  appendStreamDelta: (delta) => set((s) => ({ streamingContent: s.streamingContent + delta })),

  finishStreaming: () => {
    const { activeThreadId, threads, streamingContent } = get();
    if (!activeThreadId || !threads[activeThreadId] || !streamingContent) return;

    const thread = threads[activeThreadId];
    const message: T3ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: streamingContent,
      createdAt: new Date().toISOString(),
    };

    const updated = {
      ...threads,
      [activeThreadId]: {
        ...thread,
        messages: [...thread.messages, message],
        updatedAt: new Date().toISOString(),
      },
    };
    persistThreads(updated);
    set({ threads: updated, isStreaming: false, streamingContent: "" });
  },

  abortStreaming: () => set({ isStreaming: false, streamingContent: "" }),
}));
