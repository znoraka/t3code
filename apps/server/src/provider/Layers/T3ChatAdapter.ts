import {
  EventId,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
  RuntimeItemId,
  type T3ChatSettings,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { T3ChatAdapterShape } from "../Services/T3ChatAdapter.ts";
import { T3ChatRuntime } from "../t3chatRuntime.ts";

const PROVIDER = ProviderDriverKind.make("t3chat");

interface T3ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
}

interface T3ChatTurnSnapshot {
  readonly turnId: TurnId;
  readonly userMessage: string;
  readonly assistantMessage: string;
}

interface T3ChatSessionContext {
  session: ProviderSession;
  messages: T3ChatMessage[];
  turns: T3ChatTurnSnapshot[];
  activeTurnId: TurnId | undefined;
  abortController: AbortController | undefined;
  model: string;
}

function extractDelta(value: Record<string, unknown>): string | null {
  if (typeof value.delta === "string") return value.delta;
  if (value.delta && typeof value.delta === "object") {
    const d = value.delta as Record<string, unknown>;
    if (typeof d.text === "string") return d.text;
  }
  if (typeof value.text === "string") return value.text;
  if (Array.isArray(value.content)) {
    return value.content
      .map((item: Record<string, unknown>) => (typeof item.text === "string" ? item.text : ""))
      .join("");
  }
  return null;
}

function tryParseJson(data: string): Record<string, unknown> | null {
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const makeT3ChatAdapter = Effect.fn("makeT3ChatAdapter")(function* (
  settings: T3ChatSettings & { readonly enabled: boolean },
  adapterOptions: {
    readonly instanceId: ProviderInstanceId;
    readonly environment?: NodeJS.ProcessEnv;
  },
) {
  const t3ChatRuntime = yield* T3ChatRuntime;
  const bridge = yield* t3ChatRuntime.connectToT3ChatBridge({
    binaryPath: settings.binaryPath,
    serverUrl: settings.serverUrl,
    wosSession: settings.wosSession,
    convexSessionId: settings.convexSessionId,
    ...(adapterOptions.environment !== undefined
      ? { environment: adapterOptions.environment }
      : {}),
  });

  const sessions = new Map<string, T3ChatSessionContext>();
  const eventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
  const bridgeExitReason = yield* Ref.make<Option.Option<string>>(Option.none());

  const makeEventStamp = Effect.gen(function* () {
    return {
      eventId: EventId.make(yield* Random.nextUUIDv4),
      createdAt: DateTime.formatIso(yield* DateTime.now),
    };
  });

  const emitEvent = (event: ProviderRuntimeEvent) =>
    Queue.offer(eventQueue, event).pipe(Effect.asVoid);

  const requireBridge = Effect.fn("requireBridge")(function* () {
    const exit = yield* Ref.get(bridgeExitReason);
    if (Option.isSome(exit)) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "bridge",
        detail: exit.value,
      });
    }

    return bridge.url;
  });

  const requireSession = (
    threadId: ThreadId,
  ): Effect.Effect<T3ChatSessionContext, ProviderAdapterSessionNotFoundError> => {
    const ctx = sessions.get(threadId);
    if (!ctx) {
      return Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
    }
    return Effect.succeed(ctx);
  };

  const emitBridgeExit = Effect.fn("emitBridgeExit")(function* (reason: string) {
    const alreadyExited = yield* Ref.get(bridgeExitReason);
    if (Option.isSome(alreadyExited)) {
      return;
    }
    yield* Ref.set(bridgeExitReason, Option.some(reason));

    const activeSessions = [...sessions.entries()];
    for (const [threadId, context] of activeSessions) {
      if (context.abortController) {
        context.abortController.abort();
        context.abortController = undefined;
      }
      context.activeTurnId = undefined;
      const stamp = yield* makeEventStamp;
      yield* emitEvent({
        eventId: stamp.eventId,
        provider: PROVIDER,
        providerInstanceId: adapterOptions.instanceId,
        threadId: threadId as ThreadId,
        createdAt: stamp.createdAt,
        type: "session.exited",
        payload: { exitKind: "error" },
      });
    }
    sessions.clear();
  });

  if (!bridge.external && bridge.exitCode !== null) {
    yield* bridge.exitCode.pipe(
      Effect.flatMap((code) => emitBridgeExit(`T3 Chat bridge exited unexpectedly (${code}).`)),
      Effect.forkScoped,
    );
  }

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      for (const ctx of sessions.values()) {
        if (ctx.abortController) {
          ctx.abortController.abort();
        }
      }
      sessions.clear();
      yield* Queue.shutdown(eventQueue);
    }),
  );

  const startSession: T3ChatAdapterShape["startSession"] = Effect.fn("startSession")(function* (
    input: ProviderSessionStartInput,
  ) {
    yield* requireBridge();

    const { eventId, createdAt } = yield* makeEventStamp;
    const model = input.modelSelection?.model ?? "claude-4-sonnet";

    const session: ProviderSession = {
      provider: PROVIDER,
      providerInstanceId: adapterOptions.instanceId,
      status: "ready",
      runtimeMode: input.runtimeMode,
      threadId: input.threadId,
      model,
      createdAt,
      updatedAt: createdAt,
    };

    sessions.set(input.threadId, {
      session,
      messages: [],
      turns: [],
      activeTurnId: undefined,
      abortController: undefined,
      model,
    });

    yield* emitEvent({
      eventId,
      provider: PROVIDER,
      providerInstanceId: adapterOptions.instanceId,
      threadId: input.threadId,
      createdAt,
      type: "session.started",
      payload: {},
    });
    const s2 = yield* makeEventStamp;
    yield* emitEvent({
      eventId: s2.eventId,
      provider: PROVIDER,
      providerInstanceId: adapterOptions.instanceId,
      threadId: input.threadId,
      createdAt: s2.createdAt,
      type: "session.state.changed",
      payload: { state: "ready" },
    });
    const s3 = yield* makeEventStamp;
    yield* emitEvent({
      eventId: s3.eventId,
      provider: PROVIDER,
      providerInstanceId: adapterOptions.instanceId,
      threadId: input.threadId,
      createdAt: s3.createdAt,
      type: "thread.started",
      payload: {},
    });

    return session;
  });

  const doStreaming = Effect.fn("doStreaming")(function* (input: {
    ctx: T3ChatSessionContext;
    threadId: ThreadId;
    turnId: TurnId;
    itemId: RuntimeItemId;
    model: string;
    abortSignal: AbortSignal;
  }) {
    const { ctx, threadId, turnId, itemId, model, abortSignal } = input;
    const bridgeURL = yield* requireBridge();

    const body = {
      messages: ctx.messages.map((m) => ({
        id: m.id,
        parts: [{ type: "text", text: m.content }],
        role: m.role,
        attachments: [],
      })),
      threadMetadata: { id: threadId },
      responseMessageId: crypto.randomUUID(),
      model,
      convexSessionId: settings.convexSessionId,
      modelParams: { reasoningEffort: "medium", includeSearch: false },
      preferences: { name: "", occupation: "", selectedTraits: [], additionalInfo: "" },
      userInfo: {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: "en-US",
      },
    };

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${bridgeURL}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: abortSignal,
        }),
      catch: (error) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "sendTurn.fetch",
          detail:
            error instanceof Error && error.name === "AbortError"
              ? "Request aborted"
              : String(error),
        }),
    });

    if (!response.ok) {
      const errorText = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "sendTurn.response",
            detail: "Failed to read error response",
          }),
      });
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "sendTurn",
        detail: `T3 Chat bridge error ${response.status}: ${errorText}`,
      });
    }

    if (!response.body) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "sendTurn",
        detail: "No response body from T3 Chat bridge",
      });
    }

    const accumulated = yield* readSSEStream(
      response.body,
      abortSignal,
      threadId,
      turnId,
      itemId,
      adapterOptions.instanceId,
      emitEvent,
      makeEventStamp,
    );

    ctx.messages.push({
      id: crypto.randomUUID(),
      role: "assistant",
      content: accumulated,
    });
    const userContent =
      ctx.messages.findLast((m: T3ChatMessage) => m.role === "user")?.content ?? "";
    ctx.turns.push({ turnId, userMessage: userContent, assistantMessage: accumulated });
  });

  const sendTurn: T3ChatAdapterShape["sendTurn"] = Effect.fn("sendTurn")(function* (
    input: ProviderSendTurnInput,
  ) {
    const ctx = yield* requireSession(input.threadId);

    if (!input.input?.trim()) {
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "sendTurn",
        issue: "Message text is required",
      });
    }

    if (!settings.wosSession || !settings.convexSessionId) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "sendTurn",
        detail:
          "T3 Chat credentials not configured. Set wosSession and convexSessionId in provider settings.",
      });
    }

    yield* requireBridge();

    const turnId = TurnId.make(yield* Random.nextUUIDv4);
    const itemId = RuntimeItemId.make(yield* Random.nextUUIDv4);
    const stamp = yield* makeEventStamp;

    ctx.messages.push({
      id: yield* Random.nextUUIDv4,
      role: "user",
      content: input.input,
    });

    const model = input.modelSelection?.model ?? ctx.model;
    ctx.model = model;
    ctx.activeTurnId = turnId;
    const abortController = new AbortController();
    ctx.abortController = abortController;
    ctx.session = {
      ...ctx.session,
      status: "running",
      updatedAt: stamp.createdAt,
      activeTurnId: turnId,
    };

    yield* emitEvent({
      eventId: stamp.eventId,
      provider: PROVIDER,
      providerInstanceId: adapterOptions.instanceId,
      threadId: input.threadId,
      createdAt: stamp.createdAt,
      turnId,
      type: "turn.started",
      payload: { model },
    });
    const s2 = yield* makeEventStamp;
    yield* emitEvent({
      eventId: s2.eventId,
      provider: PROVIDER,
      providerInstanceId: adapterOptions.instanceId,
      threadId: input.threadId,
      createdAt: s2.createdAt,
      turnId,
      itemId,
      type: "item.started",
      payload: { itemType: "assistant_message" },
    });

    yield* doStreaming({
      ctx,
      threadId: input.threadId,
      turnId,
      itemId,
      model,
      abortSignal: abortController.signal,
    }).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.gen(function* () {
            const ts = yield* makeEventStamp;
            ctx.activeTurnId = undefined;
            ctx.abortController = undefined;
            ctx.session = {
              ...ctx.session,
              status: "ready",
              updatedAt: ts.createdAt,
              activeTurnId: undefined,
            };
            yield* emitEvent({
              eventId: ts.eventId,
              provider: PROVIDER,
              providerInstanceId: adapterOptions.instanceId,
              threadId: input.threadId,
              createdAt: ts.createdAt,
              turnId,
              type: "turn.completed",
              payload: { state: "failed", errorMessage: error.message },
            });
            const ts2 = yield* makeEventStamp;
            yield* emitEvent({
              eventId: ts2.eventId,
              provider: PROVIDER,
              providerInstanceId: adapterOptions.instanceId,
              threadId: input.threadId,
              createdAt: ts2.createdAt,
              type: "session.state.changed",
              payload: { state: "ready" },
            });
          }),
        onSuccess: () =>
          Effect.gen(function* () {
            const ts = yield* makeEventStamp;
            ctx.activeTurnId = undefined;
            ctx.abortController = undefined;
            ctx.session = {
              ...ctx.session,
              status: "ready",
              updatedAt: ts.createdAt,
              activeTurnId: undefined,
            };
            yield* emitEvent({
              eventId: ts.eventId,
              provider: PROVIDER,
              providerInstanceId: adapterOptions.instanceId,
              threadId: input.threadId,
              createdAt: ts.createdAt,
              turnId,
              itemId,
              type: "item.completed",
              payload: { itemType: "assistant_message", status: "completed" },
            });
            const ts2 = yield* makeEventStamp;
            yield* emitEvent({
              eventId: ts2.eventId,
              provider: PROVIDER,
              providerInstanceId: adapterOptions.instanceId,
              threadId: input.threadId,
              createdAt: ts2.createdAt,
              turnId,
              type: "turn.completed",
              payload: { state: "completed" },
            });
            const ts3 = yield* makeEventStamp;
            yield* emitEvent({
              eventId: ts3.eventId,
              provider: PROVIDER,
              providerInstanceId: adapterOptions.instanceId,
              threadId: input.threadId,
              createdAt: ts3.createdAt,
              type: "session.state.changed",
              payload: { state: "ready" },
            });
          }),
      }),
    );

    return { threadId: input.threadId, turnId };
  });

  const interruptTurn: T3ChatAdapterShape["interruptTurn"] = Effect.fn("interruptTurn")(function* (
    threadId: ThreadId,
  ) {
    const ctx = yield* requireSession(threadId);
    if (ctx.abortController) {
      ctx.abortController.abort();
      ctx.abortController = undefined;
    }
    if (ctx.activeTurnId) {
      const stamp = yield* makeEventStamp;
      yield* emitEvent({
        eventId: stamp.eventId,
        provider: PROVIDER,
        providerInstanceId: adapterOptions.instanceId,
        threadId,
        createdAt: stamp.createdAt,
        turnId: ctx.activeTurnId,
        type: "turn.completed",
        payload: { state: "interrupted" },
      });
      ctx.activeTurnId = undefined;
      ctx.session = {
        ...ctx.session,
        status: "ready",
        updatedAt: stamp.createdAt,
        activeTurnId: undefined,
      };
      const s2 = yield* makeEventStamp;
      yield* emitEvent({
        eventId: s2.eventId,
        provider: PROVIDER,
        providerInstanceId: adapterOptions.instanceId,
        threadId,
        createdAt: s2.createdAt,
        type: "session.state.changed",
        payload: { state: "ready" },
      });
    }
  });

  const stopSession: T3ChatAdapterShape["stopSession"] = Effect.fn("stopSession")(function* (
    threadId: ThreadId,
  ) {
    const ctx = sessions.get(threadId);
    if (!ctx) return;
    if (ctx.abortController) ctx.abortController.abort();
    sessions.delete(threadId);
    const stamp = yield* makeEventStamp;
    yield* emitEvent({
      eventId: stamp.eventId,
      provider: PROVIDER,
      providerInstanceId: adapterOptions.instanceId,
      threadId,
      createdAt: stamp.createdAt,
      type: "session.exited",
      payload: { exitKind: "graceful" },
    });
  });

  const stopAll: T3ChatAdapterShape["stopAll"] = Effect.fn("stopAll")(function* () {
    for (const threadId of [...sessions.keys()]) {
      yield* stopSession(threadId as ThreadId);
    }
  });

  const readThread: T3ChatAdapterShape["readThread"] = Effect.fn("readThread")(function* (
    threadId: ThreadId,
  ) {
    const ctx = yield* requireSession(threadId);
    return {
      threadId,
      turns: ctx.turns.map((t) => ({
        id: t.turnId,
        items: [
          { role: "user" as const, content: t.userMessage },
          { role: "assistant" as const, content: t.assistantMessage },
        ],
      })),
    };
  });

  const rollbackThread: T3ChatAdapterShape["rollbackThread"] = Effect.fn("rollbackThread")(
    function* (threadId: ThreadId, numTurns: number) {
      const ctx = yield* requireSession(threadId);
      const removed = ctx.turns.splice(-numTurns);
      for (const turn of removed) {
        const userIdx = ctx.messages.findIndex(
          (m: T3ChatMessage) => m.role === "user" && m.content === turn.userMessage,
        );
        if (userIdx !== -1) ctx.messages.splice(userIdx);
      }
      return {
        threadId,
        turns: ctx.turns.map((t) => ({
          id: t.turnId,
          items: [
            { role: "user" as const, content: t.userMessage },
            { role: "assistant" as const, content: t.assistantMessage },
          ],
        })),
      };
    },
  );

  return {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "in-session" as const },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest: (_threadId, _requestId, _decision) => Effect.void,
    respondToUserInput: (_threadId, _requestId, _answers) => Effect.void,
    stopSession,
    stopAll,
    listSessions: () => Effect.succeed([...sessions.values()].map((ctx) => ctx.session)),
    hasSession: (threadId) => Effect.succeed(sessions.has(threadId)),
    readThread,
    rollbackThread,
    get streamEvents() {
      return Stream.fromQueue(eventQueue);
    },
  } satisfies T3ChatAdapterShape;
});

const readSSEStream = (
  body: ReadableStream<Uint8Array>,
  abortSignal: AbortSignal,
  threadId: ThreadId,
  turnId: TurnId,
  itemId: RuntimeItemId,
  instanceId: ProviderInstanceId,
  emitEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>,
  makeEventStamp: Effect.Effect<{ eventId: EventId; createdAt: string }>,
): Effect.Effect<string, ProviderAdapterRequestError> =>
  Effect.gen(function* () {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";
    let accumulated = "";

    const readLoop: Effect.Effect<void, ProviderAdapterRequestError> = Effect.gen(function* () {
      while (true) {
        const result = yield* Effect.tryPromise({
          try: () => reader.read(),
          catch: (error) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "sendTurn.stream",
              detail:
                error instanceof Error && error.name === "AbortError"
                  ? "Request aborted"
                  : String(error),
            }),
        });

        if (result.done) break;

        sseBuffer += decoder.decode(result.value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") return;

          const parsed = tryParseJson(data);
          if (!parsed) continue;

          const delta = extractDelta(parsed);
          if (delta) {
            accumulated += delta;
            const stamp = yield* makeEventStamp;
            yield* emitEvent({
              eventId: stamp.eventId,
              provider: PROVIDER,
              providerInstanceId: instanceId,
              threadId,
              createdAt: stamp.createdAt,
              turnId,
              itemId,
              type: "content.delta",
              payload: { streamKind: "assistant_text", delta },
            });
          }
        }
      }
    });

    yield* readLoop.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (!abortSignal.aborted) {
            void reader.cancel();
          }
        }),
      ),
    );

    return accumulated;
  });
