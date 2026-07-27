import {
  ORCHESTRATION_WS_METHODS,
  type EnvironmentId,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamItem,
  type ServerConfig,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { EnvironmentRegistry } from "../connection/registry.ts";
import { connectionProjectionPhase } from "../connection/model.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import * as ConnectionWakeups from "../connection/wakeups.ts";
import { safeErrorLogAttributes } from "../errors/safeLog.ts";
import { EnvironmentCacheStore } from "../platform/persistence.ts";
import { subscribeDynamic } from "../rpc/client.ts";
import { ShellSnapshotLoader } from "./shellSnapshotHttp.ts";
import { applyShellStreamEvent } from "./shellReducer.ts";
import { makeCooperativeYield } from "./cooperativeYield.ts";
import type { EnvironmentCatalogState } from "./connections.ts";
import { followStreamInEnvironment } from "./runtime.ts";

export type EnvironmentShellStatus = "empty" | "cached" | "synchronizing" | "live";

export interface EnvironmentShellState {
  readonly snapshot: Option.Option<OrchestrationShellSnapshot>;
  readonly status: EnvironmentShellStatus;
  readonly error: Option.Option<string>;
}

const EMPTY_SHELL_STATE: EnvironmentShellState = {
  snapshot: Option.none(),
  status: "empty",
  error: Option.none(),
};

function shellStatusForSnapshot(
  snapshot: Option.Option<OrchestrationShellSnapshot>,
): EnvironmentShellStatus {
  return Option.isSome(snapshot) ? "cached" : "empty";
}

const SHELL_SYNCHRONIZATION_ERROR_MESSAGE = "Could not synchronize environment data.";

// The shell cache exists to warm the UI on the next launch; nothing reads it
// while the app is running. Persisting on every change therefore bought nothing
// and cost a great deal: encoding the whole thread list allocates a
// multi-megabyte string, and on mobile that allocation rate drove the garbage
// collector to consume ~74% of the JS thread, which is what made buttons hang
// on a slow connection (a burst of small events each triggered a full rewrite).
//
// So: collapse bursts, cap how often a busy list can write at all, and rely on
// the finalizer below to flush the latest state when the environment closes.
const SHELL_PERSIST_SETTLE = "5 seconds";
const SHELL_PERSIST_MIN_INTERVAL = "60 seconds";
const SHELL_PERSIST_FLUSH_TIMEOUT = "2 seconds";

export const makeEnvironmentShellState = Effect.fn("EnvironmentShellState.make")(function* () {
  const supervisor = yield* EnvironmentSupervisor;
  const cache = yield* EnvironmentCacheStore;
  const snapshotLoader = yield* ShellSnapshotLoader;
  const wakeups = yield* Effect.serviceOption(ConnectionWakeups.ConnectionWakeups);
  const environmentId = supervisor.target.environmentId;
  const cachedSnapshot = yield* cache.loadShell(environmentId).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Could not load cached environment shell.").pipe(
        Effect.annotateLogs({
          environmentId,
          ...safeErrorLogAttributes(error),
        }),
        Effect.as(Option.none<OrchestrationShellSnapshot>()),
      ),
    ),
  );
  const state = yield* SubscriptionRef.make<EnvironmentShellState>({
    snapshot: cachedSnapshot,
    status: shellStatusForSnapshot(cachedSnapshot),
    error: Option.none(),
  });
  const awaitingCompletion = yield* Ref.make(false);
  // Distinguishes "we have a snapshot the server can resume from" (synced in
  // this process) from "we restored a possibly-stale one from disk".
  const synchronizedThisSession = yield* Ref.make(false);
  // Returning to the foreground is not the same as a transport reconnect: the
  // socket was likely dead for an unbounded stretch, so resume-by-sequence may
  // not cover the gap and the authoritative snapshot must be refetched.
  const forceAuthoritativeRefresh = yield* Ref.make(false);
  const persistence = yield* Queue.sliding<OrchestrationShellSnapshot>(1);

  // Tracks what actually reached the cache so the finalizer can skip a write
  // when the throttled stream already persisted the current state.
  const persistedSequence = yield* Ref.make<number | null>(null);

  const persist = Effect.fn("EnvironmentShellState.persist")(function* (
    snapshot: OrchestrationShellSnapshot,
  ) {
    yield* cache.saveShell(environmentId, snapshot).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not persist environment shell cache.").pipe(
          Effect.annotateLogs({
            environmentId,
            ...safeErrorLogAttributes(error),
          }),
        ),
      ),
    );
    yield* Ref.set(persistedSequence, snapshot.snapshotSequence);
  });

  yield* Stream.fromQueue(persistence).pipe(
    Stream.debounce(SHELL_PERSIST_SETTLE),
    // "enforce" drops writes that arrive inside the window rather than queueing
    // them. Dropping is correct here: the queue is sliding(1), so the next write
    // carries the newest state anyway, and the finalizer flushes whatever the
    // throttle discarded.
    Stream.throttle({
      cost: () => 1,
      units: 1,
      duration: SHELL_PERSIST_MIN_INTERVAL,
      strategy: "enforce",
    }),
    Stream.runForEach(persist),
    Effect.forkScoped,
  );

  yield* Effect.addFinalizer(() =>
    Effect.all([SubscriptionRef.get(state), Ref.get(persistedSequence)]).pipe(
      Effect.flatMap(([current, persisted]) =>
        Option.match(current.snapshot, {
          onNone: () => Effect.void,
          onSome: (snapshot) =>
            persisted === snapshot.snapshotSequence ? Effect.void : persist(snapshot),
        }),
      ),
      // A wedged cache write must not hold the environment open. Losing the
      // final flush only costs a cold list on next launch.
      Effect.timeoutOption(SHELL_PERSIST_FLUSH_TIMEOUT),
      Effect.asVoid,
    ),
  );

  const setDisconnected = Ref.set(awaitingCompletion, false).pipe(
    Effect.andThen(
      SubscriptionRef.update(state, (current) => ({
        ...current,
        status: shellStatusForSnapshot(current.snapshot),
      })),
    ),
  );
  const setSynchronizing = SubscriptionRef.update(state, (current) => ({
    ...current,
    status: "synchronizing" as const,
    error: Option.none(),
  }));
  const setReady = SubscriptionRef.update(state, (current) =>
    current.status === "live"
      ? current
      : {
          ...current,
          status: "synchronizing" as const,
          error: Option.none(),
        },
  );
  const setStreamError = (error: unknown) =>
    Ref.set(awaitingCompletion, false).pipe(
      Effect.andThen(Effect.logWarning("Could not synchronize the environment shell.")),
      Effect.annotateLogs({
        environmentId,
        ...safeErrorLogAttributes(error),
      }),
      Effect.andThen(
        SubscriptionRef.update(state, (current) => ({
          ...current,
          status: shellStatusForSnapshot(current.snapshot),
          error: Option.some(SHELL_SYNCHRONIZATION_ERROR_MESSAGE),
        })),
      ),
    );

  // Gives the host a window to dispatch touches during a long sync burst.
  const cooperativeYield = makeCooperativeYield();

  const applyItem = Effect.fn("EnvironmentShellState.applyItem")(function* (
    item: OrchestrationShellStreamItem,
  ) {
    if (item.kind === "synchronized") {
      yield* Ref.set(awaitingCompletion, false);
      yield* Ref.set(synchronizedThisSession, true);
      yield* SubscriptionRef.update(state, (current) =>
        Option.isSome(current.snapshot)
          ? { ...current, status: "live" as const, error: Option.none() }
          : current,
      );
      return;
    }

    const current = yield* SubscriptionRef.get(state);
    const nextSnapshot =
      item.kind === "snapshot"
        ? item.snapshot
        : Option.match(current.snapshot, {
            onNone: () => null,
            onSome: (snapshot) =>
              item.sequence > snapshot.snapshotSequence
                ? applyShellStreamEvent(snapshot, item)
                : snapshot,
          });
    if (nextSnapshot === null) {
      return;
    }

    const waiting = yield* Ref.get(awaitingCompletion);
    yield* SubscriptionRef.set(state, {
      snapshot: Option.some(nextSnapshot),
      status: waiting ? "synchronizing" : "live",
      error: Option.none(),
    });
    yield* Queue.offer(persistence, nextSnapshot);
  });

  const foregroundResubscriptions = Option.match(wakeups, {
    onNone: () => Stream.never,
    onSome: (service) =>
      service.changes.pipe(
        Stream.filter((reason) => reason === "application-active"),
        Stream.tap(() => Ref.set(forceAuthoritativeRefresh, true)),
      ),
  });

  yield* setSynchronizing;
  yield* Effect.forkScoped(
    subscribeDynamic(
      ORCHESTRATION_WS_METHODS.subscribeShell,
      Effect.fn("EnvironmentShellState.makeSubscribeInput")(function* (session) {
        const supportsCompletionMarker = yield* session.initialConfig.pipe(
          Effect.map((config) => config.shellResumeCompletionMarker === true),
          Effect.orElseSucceed(() => false),
        );
        yield* Ref.set(awaitingCompletion, supportsCompletionMarker);
        yield* setSynchronizing;

        // Once this process has synchronized, the in-memory snapshot is known
        // good and the server can resume from its sequence — so a reconnect
        // must not re-download the whole thread list. It used to, on every
        // reconnect: several megabytes fetched, decoded and re-applied, which
        // allocated hard enough to hand the JS thread to the garbage collector
        // for tens of seconds. That is the freeze on an unstable connection.
        //
        // A snapshot restored from disk does NOT qualify: it can be arbitrarily
        // stale, possibly beyond what the server can resume from, so a cold
        // start still fetches the authoritative snapshot.
        const current = yield* SubscriptionRef.get(state);
        const forced = yield* Ref.getAndSet(forceAuthoritativeRefresh, false);
        const resumable =
          !forced && (yield* Ref.get(synchronizedThisSession))
            ? Option.getOrUndefined(current.snapshot)
            : undefined;
        if (resumable !== undefined) {
          return {
            afterSequence: resumable.snapshotSequence,
            ...(supportsCompletionMarker ? { requestCompletionMarker: true as const } : {}),
          };
        }

        const prepared = yield* SubscriptionRef.get(supervisor.prepared).pipe(
          Effect.flatMap(
            Option.match({
              onSome: Effect.succeed,
              onNone: () =>
                SubscriptionRef.changes(supervisor.prepared).pipe(
                  Stream.filter(Option.isSome),
                  Stream.map((value) => value.value),
                  Stream.runHead,
                  Effect.map(Option.getOrThrow),
                ),
            }),
          ),
        );
        const httpSnapshot = yield* snapshotLoader.load(prepared);
        if (Option.isSome(httpSnapshot)) {
          yield* applyItem({ kind: "snapshot", snapshot: httpSnapshot.value });
          yield* Ref.set(synchronizedThisSession, true);
          return {
            afterSequence: httpSnapshot.value.snapshotSequence,
            ...(supportsCompletionMarker ? { requestCompletionMarker: true as const } : {}),
          };
        }

        return supportsCompletionMarker ? { requestCompletionMarker: true as const } : {};
      }),
      {
        onExpectedFailure: (cause) => setStreamError(Cause.squash(cause)),
        retryExpectedFailureAfter: "250 millis",
        resubscribe: foregroundResubscriptions,
      },
    ).pipe(Stream.runForEach((item) => applyItem(item).pipe(Effect.andThen(cooperativeYield)))),
  );
  yield* SubscriptionRef.changes(supervisor.state).pipe(
    Stream.runForEach((connectionState) => {
      switch (connectionProjectionPhase(connectionState)) {
        case "synchronizing":
          return setSynchronizing;
        case "disconnected":
          return setDisconnected;
        case "ready":
          return setReady;
      }
    }),
    Effect.forkScoped,
  );

  return state;
});

export function shellStateChanges(environmentId: EnvironmentId) {
  return followStreamInEnvironment(
    environmentId,
    Stream.unwrap(makeEnvironmentShellState().pipe(Effect.map(SubscriptionRef.changes))),
  );
}

export interface EnvironmentShellSummary {
  readonly hasSnapshot: boolean;
  readonly hasSynchronizingShell: boolean;
  readonly hasCachedShell: boolean;
  readonly hasLiveShell: boolean;
  readonly firstError: string | null;
  readonly latestSnapshotUpdatedAt: string | null;
}

const EMPTY_ENVIRONMENT_SHELL_SUMMARY: EnvironmentShellSummary = Object.freeze({
  hasSnapshot: false,
  hasSynchronizingShell: false,
  hasCachedShell: false,
  hasLiveShell: false,
  firstError: null,
  latestSnapshotUpdatedAt: null,
});

const EMPTY_SERVER_CONFIGS: ReadonlyMap<EnvironmentId, ServerConfig> = new Map();

function shellSummariesEqual(
  left: EnvironmentShellSummary,
  right: EnvironmentShellSummary,
): boolean {
  return (
    left.hasSnapshot === right.hasSnapshot &&
    left.hasSynchronizingShell === right.hasSynchronizingShell &&
    left.hasCachedShell === right.hasCachedShell &&
    left.hasLiveShell === right.hasLiveShell &&
    left.firstError === right.firstError &&
    left.latestSnapshotUpdatedAt === right.latestSnapshotUpdatedAt
  );
}

function mapsEqual<K, V>(left: ReadonlyMap<K, V>, right: ReadonlyMap<K, V>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [key, value] of left) {
    if (right.get(key) !== value) {
      return false;
    }
  }
  return true;
}

export function createEnvironmentShellSummaryAtom(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly shellStateValueAtom: (environmentId: EnvironmentId) => Atom.Atom<EnvironmentShellState>;
}) {
  let previousSummary = EMPTY_ENVIRONMENT_SHELL_SUMMARY;
  return Atom.make((get) => {
    let hasSnapshot = false;
    let hasSynchronizingShell = false;
    let hasCachedShell = false;
    let hasLiveShell = false;
    let firstError: string | null = null;
    let latestSnapshotUpdatedAt: string | null = null;

    for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
      const state = get(input.shellStateValueAtom(environmentId));
      hasSynchronizingShell ||= state.status === "synchronizing";
      hasCachedShell ||= state.status === "cached";
      hasLiveShell ||= state.status === "live";
      if (firstError === null) {
        firstError = Option.getOrNull(state.error);
      }
      if (Option.isNone(state.snapshot)) {
        continue;
      }
      hasSnapshot = true;
      const updatedAt = state.snapshot.value.updatedAt;
      if (latestSnapshotUpdatedAt === null || updatedAt > latestSnapshotUpdatedAt) {
        latestSnapshotUpdatedAt = updatedAt;
      }
    }

    const next: EnvironmentShellSummary = {
      hasSnapshot,
      hasSynchronizingShell,
      hasCachedShell,
      hasLiveShell,
      firstError,
      latestSnapshotUpdatedAt,
    };
    if (shellSummariesEqual(previousSummary, next)) {
      return previousSummary;
    }
    previousSummary = next;
    return previousSummary;
  }).pipe(Atom.withLabel("environment-shell-summary"));
}

export function createEnvironmentServerConfigsAtom(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly serverConfigValueAtom: (environmentId: EnvironmentId) => Atom.Atom<ServerConfig | null>;
}) {
  let previousServerConfigs = EMPTY_SERVER_CONFIGS;
  return Atom.make((get) => {
    const next = new Map<EnvironmentId, ServerConfig>();
    for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
      const config = get(input.serverConfigValueAtom(environmentId));
      if (config !== null) {
        next.set(environmentId, config);
      }
    }
    if (mapsEqual(previousServerConfigs, next)) {
      return previousServerConfigs;
    }
    previousServerConfigs = next;
    return previousServerConfigs;
  }).pipe(Atom.withLabel("environment-server-configs"));
}

export function createEnvironmentShellAtoms<R, E>(
  runtime: Atom.AtomRuntime<
    EnvironmentRegistry | EnvironmentCacheStore | ShellSnapshotLoader | R,
    E
  >,
) {
  const stateAtom = Atom.family((environmentId: EnvironmentId) =>
    runtime.atom(shellStateChanges(environmentId), {
      initialValue: EMPTY_SHELL_STATE,
    }),
  );

  const stateValueAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) =>
      Option.getOrElse(AsyncResult.value(get(stateAtom(environmentId))), () => EMPTY_SHELL_STATE),
    ).pipe(Atom.withLabel(`environment-shell-state-value:${environmentId}`)),
  );

  return {
    stateAtom,
    stateValueAtom,
  };
}

export * from "./models.ts";
export * from "./shellCommands.ts";
export * from "./shellReducer.ts";
export * from "./shellSnapshotHttp.ts";
export * from "./snapshots.ts";
