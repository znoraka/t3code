import { useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { SidebarInset, SidebarTrigger } from "./ui/sidebar";
import { useT3ChatStore } from "../t3chatStore";
import { useT3ChatAuthStore } from "../t3chatAuthStore";
import { streamChat } from "../lib/t3chatApi";
import { T3ChatMessages } from "./t3chat/T3ChatMessages";
import { T3ChatComposer } from "./t3chat/T3ChatComposer";
import { T3ChatThreadList } from "./t3chat/T3ChatThreadList";
import { T3ChatModelSelector } from "./t3chat/T3ChatModelSelector";
import { T3ChatAuthDialog } from "./t3chat/T3ChatAuthDialog";

export function PersistentT3ChatView({ visible }: { visible: boolean }) {
  const hasBeenActivated = useT3ChatStore((s) => s.hasBeenActivated);

  if (!hasBeenActivated && visible) {
    useT3ChatStore.getState().activate();
  }

  if (!hasBeenActivated && !visible) return null;

  return (
    <div style={{ display: visible ? "contents" : "none" }}>
      <T3ChatViewInner />
    </div>
  );
}

function T3ChatViewInner() {
  const abortRef = useRef<AbortController | null>(null);

  const { activeThreadId, threads, selectedModel } = useT3ChatStore(
    useShallow((s) => ({
      activeThreadId: s.activeThreadId,
      threads: s.threads,
      selectedModel: s.selectedModel,
    })),
  );

  const isConfigured = useT3ChatAuthStore((s) => !!s.wosSession && !!s.convexSessionId);

  const activeThread = activeThreadId ? threads[activeThreadId] : null;
  const messages = activeThread?.messages ?? [];

  const handleSend = useCallback(
    async (content: string) => {
      if (!isConfigured) return;

      const store = useT3ChatStore.getState();
      let threadId = store.activeThreadId;
      if (!threadId) {
        threadId = store.createThread();
      }

      store.addUserMessage(content);

      const currentMessages = useT3ChatStore.getState().threads[threadId]?.messages ?? [];

      const abort = new AbortController();
      abortRef.current = abort;
      store.startStreaming();

      try {
        for await (const delta of streamChat({
          messages: currentMessages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
          })),
          threadId,
          model: selectedModel,
          signal: abort.signal,
        })) {
          useT3ChatStore.getState().appendStreamDelta(delta);
        }
        useT3ChatStore.getState().finishStreaming();
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          useT3ChatStore.getState().abortStreaming();
        }
      } finally {
        abortRef.current = null;
      }
    },
    [isConfigured, selectedModel],
  );

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
    useT3ChatStore.getState().abortStreaming();
  }, []);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <SidebarTrigger className="size-7 shrink-0" />
          <span className="text-sm font-medium text-foreground">T3 Chat</span>
          <span className="text-xs text-muted-foreground">·</span>
          <T3ChatModelSelector />
          <div className="flex-1" />
          <T3ChatAuthDialog />
        </header>
        <div className="flex min-h-0 flex-1">
          <T3ChatThreadList />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {!isConfigured ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  Connect your T3 Chat account to get started.
                </p>
                <p className="text-xs text-muted-foreground">
                  Click the settings icon in the header to add your credentials.
                </p>
              </div>
            ) : (
              <>
                <T3ChatMessages messages={messages} />
                <T3ChatComposer onSend={handleSend} onAbort={handleAbort} />
              </>
            )}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}
