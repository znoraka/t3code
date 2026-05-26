import { useCallback, useRef, type KeyboardEvent } from "react";
import { SendIcon, SquareIcon } from "lucide-react";
import { Button } from "../ui/button";
import { useT3ChatStore } from "../../t3chatStore";

export function T3ChatComposer({
  onSend,
  onAbort,
}: {
  onSend: (content: string) => void;
  onAbort: () => void;
}) {
  const isStreaming = useT3ChatStore((s) => s.isStreaming);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const value = textareaRef.current?.value.trim();
    if (!value || isStreaming) return;
    onSend(value);
    if (textareaRef.current) textareaRef.current.value = "";
  }, [onSend, isStreaming]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          ref={textareaRef}
          onKeyDown={handleKeyDown}
          placeholder="Type your message..."
          rows={1}
          className="min-h-[40px] max-h-[200px] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
          }}
        />
        {isStreaming ? (
          <Button variant="destructive-outline" size="icon" onClick={onAbort}>
            <SquareIcon className="size-4" />
          </Button>
        ) : (
          <Button size="icon" onClick={handleSubmit}>
            <SendIcon className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
