import { memo, useEffect, useRef } from "react";
import type { T3ChatMessage } from "../../t3chatStore";
import { useT3ChatStore } from "../../t3chatStore";
import ChatMarkdown from "../ChatMarkdown";

function UserMessage({ message }: { message: T3ChatMessage }) {
  return (
    <div className="flex justify-end px-4 py-2">
      <div className="max-w-[80%] rounded-xl bg-primary/10 px-4 py-2.5 text-sm text-foreground">
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  );
}

const AssistantMessage = memo(function AssistantMessage({ message }: { message: T3ChatMessage }) {
  return (
    <div className="px-4 py-2">
      <div className="max-w-[80%] text-sm">
        <ChatMarkdown text={message.content} cwd={undefined} />
      </div>
    </div>
  );
});

function StreamingMessage() {
  const content = useT3ChatStore((s) => s.streamingContent);
  if (!content) return null;

  return (
    <div className="px-4 py-2">
      <div className="max-w-[80%] text-sm">
        <ChatMarkdown text={content} cwd={undefined} isStreaming />
      </div>
    </div>
  );
}

export function T3ChatMessages({ messages }: { messages: T3ChatMessage[] }) {
  const isStreaming = useT3ChatStore((s) => s.isStreaming);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isStreaming]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
        Start a conversation with T3 Chat.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl py-4">
        {messages.map((msg) =>
          msg.role === "user" ? (
            <UserMessage key={msg.id} message={msg} />
          ) : (
            <AssistantMessage key={msg.id} message={msg} />
          ),
        )}
        {isStreaming && <StreamingMessage />}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
