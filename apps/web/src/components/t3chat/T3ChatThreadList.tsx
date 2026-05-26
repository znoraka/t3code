import { useCallback, useMemo } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useT3ChatStore, type T3ChatThread } from "../../t3chatStore";
import { Button } from "../ui/button";

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function ThreadItem({
  thread,
  isActive,
  onSelect,
  onDelete,
}: {
  thread: T3ChatThread;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{thread.title}</span>
      <span className="shrink-0 text-[10px] text-muted-foreground">
        {formatRelativeTime(thread.updatedAt)}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="hidden shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block"
      >
        <Trash2Icon className="size-3" />
      </button>
    </button>
  );
}

export function T3ChatThreadList() {
  const threads = useT3ChatStore((s) => s.threads);
  const activeThreadId = useT3ChatStore((s) => s.activeThreadId);
  const selectThread = useT3ChatStore((s) => s.selectThread);
  const createThread = useT3ChatStore((s) => s.createThread);
  const deleteThread = useT3ChatStore((s) => s.deleteThread);

  const sortedThreads = useMemo(
    () => Object.values(threads).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [threads],
  );

  const handleNew = useCallback(() => {
    createThread();
  }, [createThread]);

  return (
    <div className="flex h-full w-52 flex-col border-r border-border">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">Threads</span>
        <Button variant="ghost" size="icon-xs" onClick={handleNew}>
          <PlusIcon className="size-3" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {sortedThreads.length === 0 ? (
          <div className="p-2 text-center text-[10px] text-muted-foreground">No threads yet</div>
        ) : (
          sortedThreads.map((thread) => (
            <ThreadItem
              key={thread.id}
              thread={thread}
              isActive={thread.id === activeThreadId}
              onSelect={() => selectThread(thread.id)}
              onDelete={() => deleteThread(thread.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
