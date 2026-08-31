// Adoption of an externally started T3 server as the desktop primary.
//
// The stock desktop flow scans upward from 3773 for a *free* port and spawns
// its own bundled server — so a server already running against the same T3
// home (systemd service, `npx t3 start`, a second desktop instance) ends up
// coexisting with a second server on the same SQLite database. This module
// lets the desktop detect that server at startup and connect to it instead:
//
//   1. Discovery finds a candidate origin (the persisted server-runtime.json,
//      falling back to the default port) and confirms it answers with a T3
//      environment descriptor.
//   2. Proof that the candidate serves *our* data directory is obtained by
//      minting a one-time admin pairing token into our own database (via the
//      bundled server CLI: `pair --json --admin --origin ...`) and exchanging
//      it at the candidate origin for a bearer session. A foreign server
//      reads a different database and fails the exchange, so the desktop
//      falls back to spawning as before.
//   3. The pool registers an *adopted* primary instance that never spawns or
//      kills anything: it health-probes the origin and drives the window's
//      onReady/onShutdown callbacks, while DesktopLocalEnvironmentAuth serves
//      the bearer obtained in step 2.
//
// Adoption is skipped in development, when T3CODE_PORT is set, and when
// T3CODE_DESKTOP_NO_ADOPT=1.

import { bootstrapRemoteBearerSession } from "@t3tools/client-runtime/authorization";
import {
  ExecutionEnvironmentDescriptor,
  PairingMintResult,
  PersistedServerRuntimeState,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import type * as DesktopBackendManager from "./DesktopBackendManager.ts";

export const DEFAULT_DESKTOP_BACKEND_PORT = 3773;

const WELL_KNOWN_ENVIRONMENT_PATH = "/.well-known/t3/environment";
const DESCRIPTOR_PROBE_TIMEOUT = Duration.millis(2_500);
const MINT_TIMEOUT = Duration.seconds(20);
// The whole discovery runs during layer init, before the window can open; a
// hung candidate must degrade to the spawn path rather than block startup.
const DISCOVERY_TIMEOUT = Duration.seconds(30);
const HEALTH_PROBE_TIMEOUT = Duration.seconds(1);
const HEALTH_INTERVAL_UP = Duration.seconds(10);
const HEALTH_INTERVAL_DOWN = Duration.seconds(1);
const HEALTH_INTERVAL_IDLE = Duration.seconds(2);

const { logInfo: logAdoptedInfo, logWarning: logAdoptedWarning } =
  DesktopObservability.makeComponentLogger("desktop-adopted-server");

export interface AdoptedServerConnection {
  readonly httpBaseUrl: URL;
  readonly port: number;
  readonly serverLabel: string;
  readonly accessToken: string;
}

export interface AdoptedBackendInstanceSpec {
  readonly id: DesktopBackendManager.BackendInstanceId;
  readonly label: Effect.Effect<string>;
  readonly connection: AdoptedServerConnection;
  readonly onReady?: (httpBaseUrl: URL) => Effect.Effect<void>;
  readonly onShutdown?: () => Effect.Effect<void>;
}

export class DesktopAdoptedServer extends Context.Service<
  DesktopAdoptedServer,
  {
    // The adoption decision for this app run. Cached: the first caller pays
    // for discovery (probe + mint + exchange), every later caller — the
    // pool's primary construction, the app bootstrap's port resolution, the
    // local auth's bearer lookup — observes the same result.
    readonly decide: Effect.Effect<Option.Option<AdoptedServerConnection>>;
    // A `DesktopBackendInstance` for a server this desktop did not start and
    // must never stop. start/stop only gate the health monitor driving the
    // onReady/onShutdown window callbacks; there is no child process, no
    // restart loop, and no preflight. The fabricated start config keeps pool
    // consumers (IPC bootstraps, the renderer primary target) working
    // unchanged — its bootstrap token is empty because auth for an adopted
    // primary flows through the bearer minted at discovery time.
    readonly makeAdoptedBackendInstance: (
      spec: AdoptedBackendInstanceSpec,
    ) => Effect.Effect<DesktopBackendManager.DesktopBackendInstance, never, Scope.Scope>;
  }
>()("@t3tools/desktop/backend/DesktopAdoptedServer") {}

class AdoptedServerMintError extends Schema.TaggedErrorClass<AdoptedServerMintError>()(
  "AdoptedServerMintError",
  { reason: Schema.String },
) {
  override get message(): string {
    return `Failed to mint an adoption credential: ${this.reason}`;
  }
}

const decodeRuntimeState = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PersistedServerRuntimeState),
);
const decodePairingMintResult = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PairingMintResult),
);

// signal 0 delivers nothing; it only reports whether the pid exists. EPERM
// means it exists but belongs to another user, which still counts as alive.
// Same guard as `t3 pair` discovery: a dead server's state file whose port
// was since reused must not be treated as a live candidate.
const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

export const make = Effect.gen(function* () {
  const config = yield* DesktopConfig.DesktopConfig;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const httpClient = yield* HttpClient.HttpClient;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const runtimeStatePath = environment.path.join(environment.stateDir, "server-runtime.json");

  const probeEnvironmentDescriptor = (origin: URL) =>
    Effect.gen(function* () {
      const response = yield* httpClient.execute(
        HttpClientRequest.get(new URL(WELL_KNOWN_ENVIRONMENT_PATH, origin).toString()),
      );
      return yield* HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(ExecutionEnvironmentDescriptor)),
      );
    }).pipe(Effect.timeout(DESCRIPTOR_PROBE_TIMEOUT), Effect.option);

  const readRuntimeStateCandidate = Effect.gen(function* () {
    const raw = yield* fileSystem
      .readFileString(runtimeStatePath)
      .pipe(Effect.map(Option.some), Effect.orElseSucceed(Option.none<string>));
    if (Option.isNone(raw)) {
      return Option.none<URL>();
    }
    const state = yield* decodeRuntimeState(raw.value.trim()).pipe(Effect.option);
    if (Option.isNone(state)) {
      yield* logAdoptedWarning("ignoring unreadable server runtime state", {
        statePath: runtimeStatePath,
      });
      return Option.none<URL>();
    }
    if (!isProcessAlive(state.value.pid)) {
      return Option.none<URL>();
    }
    // A dev server must be reached through its web origin, not the backend
    // origin, and the packaged desktop has no business adopting one.
    if (state.value.devUrl !== undefined) {
      return Option.none<URL>();
    }
    return Option.some(new URL(state.value.origin));
  }).pipe(Effect.orElseSucceed(Option.none<URL>));

  // Mint a one-time administrative pairing token into this desktop's own
  // userdata database by running the bundled server CLI. The credential is
  // only honored by a server that reads the same database, which is exactly
  // the property adoption must prove.
  const mintAdoptionCredential = Effect.fn("desktop.adoptedServer.mint")(function* (origin: URL) {
    const command = ChildProcess.make(
      process.execPath,
      [
        environment.backendEntryPath,
        "pair",
        "--json",
        "--admin",
        "--label",
        "T3 Code Desktop",
        "--origin",
        origin.origin,
        "--base-dir",
        environment.baseDir,
      ],
      {
        cwd: environment.backendCwd,
        env: { ELECTRON_RUN_AS_NODE: "1" },
        extendEnv: true,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        killSignal: "SIGTERM",
        forceKillAfter: Duration.seconds(2),
      },
    );
    const handle = yield* spawner
      .spawn(command)
      .pipe(Effect.mapError((cause) => new AdoptedServerMintError({ reason: String(cause) })));
    const collect = (stream: typeof handle.stdout) =>
      stream.pipe(
        Stream.decodeText(),
        Stream.runFold(
          () => "",
          (acc, chunk) => acc + chunk,
        ),
        Effect.orElseSucceed(() => ""),
      );
    const stdoutFiber = yield* Effect.forkScoped(collect(handle.stdout));
    const stderrFiber = yield* Effect.forkScoped(collect(handle.stderr));
    const exitCode = yield* handle.exitCode.pipe(
      Effect.mapError((cause) => new AdoptedServerMintError({ reason: String(cause) })),
    );
    const stdout = yield* Fiber.join(stdoutFiber);
    const stderr = yield* Fiber.join(stderrFiber);
    if (exitCode !== 0) {
      return yield* new AdoptedServerMintError({
        reason: `pair exited with code ${exitCode}: ${stderr.trim().slice(-500)}`,
      });
    }
    // Log noise (storage migrations, warnings) can precede the JSON line, so
    // take the last line that looks like a JSON object.
    const jsonLine = stdout.split("\n").findLast((line) => line.trim().startsWith("{"));
    if (jsonLine === undefined) {
      return yield* new AdoptedServerMintError({
        reason: `pair produced no JSON output: ${stdout.trim().slice(-500)}`,
      });
    }
    return yield* decodePairingMintResult(jsonLine.trim()).pipe(
      Effect.mapError((cause) => new AdoptedServerMintError({ reason: String(cause) })),
    );
  });

  const tryAdoptCandidate = Effect.fn("desktop.adoptedServer.tryAdoptCandidate")(function* (
    origin: URL,
  ) {
    const descriptor = yield* probeEnvironmentDescriptor(origin);
    if (Option.isNone(descriptor)) {
      return Option.none<AdoptedServerConnection>();
    }
    yield* logAdoptedInfo("found running T3 server; verifying it serves this data directory", {
      origin: origin.origin,
      serverLabel: descriptor.value.label,
    });
    const minted = yield* mintAdoptionCredential(origin).pipe(
      Effect.scoped,
      Effect.timeout(MINT_TIMEOUT),
      Effect.option,
    );
    if (Option.isNone(minted)) {
      yield* logAdoptedWarning("could not mint an adoption credential; will spawn instead", {
        origin: origin.origin,
      });
      return Option.none<AdoptedServerConnection>();
    }
    const session = yield* bootstrapRemoteBearerSession({
      httpBaseUrl: origin.origin,
      credential: minted.value.token,
      clientMetadata: {
        label: "T3 Code Desktop",
        deviceType: "desktop",
      },
    }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.option);
    if (Option.isNone(session)) {
      // The classic cause: a T3 server on the default port that reads a
      // different data directory, so our minted token is unknown to it.
      yield* logAdoptedWarning(
        "running T3 server did not accept a credential from this data directory; will spawn instead",
        { origin: origin.origin },
      );
      return Option.none<AdoptedServerConnection>();
    }
    const port =
      origin.port.length > 0
        ? Number.parseInt(origin.port, 10)
        : origin.protocol === "https:"
          ? 443
          : 80;
    yield* logAdoptedInfo("adopting running T3 server as the desktop primary", {
      origin: origin.origin,
      port,
      serverLabel: descriptor.value.label,
    });
    return Option.some({
      httpBaseUrl: new URL(origin.origin),
      port,
      serverLabel: descriptor.value.label,
      accessToken: session.value.access_token,
    } satisfies AdoptedServerConnection);
  });

  const discover = Effect.gen(function* () {
    if (config.disableAdoptExistingServer) {
      yield* logAdoptedInfo("adoption disabled via T3CODE_DESKTOP_NO_ADOPT");
      return Option.none<AdoptedServerConnection>();
    }
    // Development requires an explicit T3CODE_PORT and always wants its own
    // child; an explicit port in production is treated the same way.
    if (environment.isDevelopment || Option.isSome(environment.configuredBackendPort)) {
      return Option.none<AdoptedServerConnection>();
    }

    const candidates = new Map<string, URL>();
    const persisted = yield* readRuntimeStateCandidate;
    if (Option.isSome(persisted)) {
      candidates.set(persisted.value.origin, persisted.value);
    }
    // Both servers overwrite the same runtime-state file and clear it on
    // shutdown, so the file alone can miss a live server on the default port.
    const defaultOrigin = new URL(`http://127.0.0.1:${DEFAULT_DESKTOP_BACKEND_PORT}`);
    candidates.set(defaultOrigin.origin, defaultOrigin);

    for (const origin of candidates.values()) {
      const adopted = yield* tryAdoptCandidate(origin);
      if (Option.isSome(adopted)) {
        return adopted;
      }
    }
    return Option.none<AdoptedServerConnection>();
  }).pipe(
    Effect.timeout(DISCOVERY_TIMEOUT),
    Effect.catchCause((cause) =>
      logAdoptedWarning("adoption discovery failed; will spawn instead", {
        cause: String(cause),
      }).pipe(Effect.as(Option.none<AdoptedServerConnection>())),
    ),
    Effect.withSpan("desktop.adoptedServer.discover"),
  );

  const decide = yield* Effect.cached(discover);

  const makeAdoptedBackendInstance = Effect.fn("desktop.adoptedServer.makeInstance")(function* (
    spec: AdoptedBackendInstanceSpec,
  ): Effect.fn.Return<DesktopBackendManager.DesktopBackendInstance, never, Scope.Scope> {
    const parentScope = yield* Scope.Scope;
    const { connection } = spec;

    const fabricatedConfig: DesktopBackendManager.DesktopBackendStartConfig = {
      executablePath: process.execPath,
      args: [],
      entryPath: environment.backendEntryPath,
      cwd: environment.backendCwd,
      env: {},
      extendEnv: false,
      bootstrap: {
        mode: "desktop",
        noBrowser: true,
        port: connection.port,
        t3Home: environment.baseDir,
        host: connection.httpBaseUrl.hostname,
        desktopBootstrapToken: "",
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      },
      bootstrapDelivery: "fd3",
      httpBaseUrl: connection.httpBaseUrl,
      captureOutput: false,
      preflightFailure: Option.none(),
    };

    const stateRef = yield* Ref.make({
      desiredRunning: false,
      ready: false,
      monitorStarted: false,
    });

    const probeOnce = Effect.gen(function* () {
      const response = yield* httpClient.execute(
        HttpClientRequest.get(
          new URL(WELL_KNOWN_ENVIRONMENT_PATH, connection.httpBaseUrl).toString(),
        ),
      );
      yield* HttpClientResponse.filterStatusOk(response);
      return true;
    }).pipe(
      Effect.timeout(HEALTH_PROBE_TIMEOUT),
      Effect.orElseSucceed(() => false),
    );

    const tick = Effect.gen(function* () {
      const current = yield* Ref.get(stateRef);
      if (!current.desiredRunning) {
        return "idle" as const;
      }
      const up = yield* probeOnce;
      if (up && !current.ready) {
        yield* Ref.update(stateRef, (latest) => ({ ...latest, ready: true }));
        yield* spec.onReady?.(connection.httpBaseUrl) ?? Effect.void;
      } else if (!up && current.ready) {
        yield* logAdoptedWarning("adopted server stopped answering; waiting for it to return", {
          origin: connection.httpBaseUrl.origin,
        });
        yield* Ref.update(stateRef, (latest) => ({ ...latest, ready: false }));
        yield* spec.onShutdown?.() ?? Effect.void;
      }
      return up ? ("up" as const) : ("down" as const);
    });

    const monitor = Effect.forever(
      tick.pipe(
        Effect.flatMap((status) =>
          Effect.sleep(
            status === "up"
              ? HEALTH_INTERVAL_UP
              : status === "down"
                ? HEALTH_INTERVAL_DOWN
                : HEALTH_INTERVAL_IDLE,
          ),
        ),
        Effect.catchCause((cause) =>
          logAdoptedWarning("adopted server monitor tick failed", { cause: String(cause) }),
        ),
      ),
    );

    const start: Effect.Effect<void> = Effect.gen(function* () {
      const alreadyStarted = yield* Ref.modify(stateRef, (latest) => [
        latest.monitorStarted,
        { ...latest, desiredRunning: true, monitorStarted: true },
      ]);
      if (!alreadyStarted) {
        yield* Effect.forkIn(monitor, parentScope);
      }
    }).pipe(
      Effect.withSpan("desktop.adoptedBackendInstance.start", { attributes: { id: spec.id } }),
    );

    const stop = Effect.fn("desktop.adoptedBackendInstance.stop")(function* () {
      const wasReady = yield* Ref.modify(stateRef, (latest) => [
        latest.ready,
        { ...latest, desiredRunning: false, ready: false },
      ]);
      if (wasReady) {
        yield* (spec.onShutdown?.() ?? Effect.void).pipe(Effect.ignore);
      }
    });

    const snapshot = Ref.get(stateRef).pipe(
      Effect.map(
        (current): DesktopBackendManager.DesktopBackendSnapshot => ({
          desiredRunning: current.desiredRunning,
          ready: current.ready,
          activePid: Option.none(),
          restartAttempt: 0,
          restartScheduled: false,
        }),
      ),
    );

    const waitForReady = (timeout: Duration.Duration): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        const current = yield* Ref.get(stateRef);
        if (!current.desiredRunning) return { done: true, ready: false };
        return current.ready ? { done: true, ready: true } : { done: false, ready: false };
      }).pipe(
        Effect.repeat({
          until: (status) => status.done,
          schedule: Schedule.spaced(Duration.millis(100)),
        }),
        Effect.map((status) => status.ready),
        Effect.timeoutOption(timeout),
        Effect.map(Option.getOrElse(() => false)),
      );

    yield* Effect.addFinalizer(() => stop());

    return {
      id: spec.id,
      label: spec.label,
      start,
      stop: () => stop(),
      currentConfig: Effect.succeed(Option.some(fabricatedConfig)),
      snapshot,
      waitForReady,
    } satisfies DesktopBackendManager.DesktopBackendInstance;
  });

  return DesktopAdoptedServer.of({ decide, makeAdoptedBackendInstance });
});

export const layer = Layer.effect(DesktopAdoptedServer, make);

// Test layer: no adoption, and a factory that fails loudly if a test
// accidentally reaches the adopted-instance path.
export const layerTest = (
  decision: Option.Option<AdoptedServerConnection> = Option.none(),
): Layer.Layer<DesktopAdoptedServer> =>
  Layer.succeed(
    DesktopAdoptedServer,
    DesktopAdoptedServer.of({
      decide: Effect.succeed(decision),
      makeAdoptedBackendInstance: () =>
        Effect.die("DesktopAdoptedServer.layerTest does not support makeAdoptedBackendInstance"),
    }),
  );
