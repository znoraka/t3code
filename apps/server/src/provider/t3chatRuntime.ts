import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { isWindowsCommandNotFound } from "../processRunner.ts";
import { collectStreamAsString } from "./providerSnapshot.ts";
import * as NetService from "@t3tools/shared/Net";

const DEFAULT_HOSTNAME = "127.0.0.1";
const DEFAULT_T3CHAT_BRIDGE_TIMEOUT_MS = 5_000;
const T3CHAT_BRIDGE_READY_PREFIX = "t3chat-bridge listening on";

export interface T3ChatBridgeProcess {
  readonly url: string;
  readonly exitCode: Effect.Effect<number, never>;
}

export interface T3ChatBridgeConnection {
  readonly url: string;
  readonly exitCode: Effect.Effect<number, never> | null;
  readonly external: boolean;
}

export interface T3ChatCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

const T3CHAT_BRIDGE_ERROR_TAG = "T3ChatBridgeError";

export class T3ChatBridgeError extends Data.TaggedError(T3CHAT_BRIDGE_ERROR_TAG)<{
  readonly operation: string;
  readonly detail: string;
  readonly cause?: unknown;
}> {}

export interface T3ChatRuntimeShape {
  readonly runT3ChatBridgeVersionCheck: (input: {
    readonly binaryPath: string;
    readonly environment?: NodeJS.ProcessEnv;
  }) => Effect.Effect<string, T3ChatBridgeError>;
  readonly connectToT3ChatBridge: (input: {
    readonly binaryPath: string;
    readonly serverUrl?: string | null;
    readonly wosSession?: string;
    readonly convexSessionId?: string;
    readonly environment?: NodeJS.ProcessEnv;
    readonly port?: number;
    readonly hostname?: string;
    readonly timeoutMs?: number;
  }) => Effect.Effect<T3ChatBridgeConnection, T3ChatBridgeError, Scope.Scope>;
}

function t3ChatBridgeErrorDetail(cause: unknown): string {
  if (cause instanceof T3ChatBridgeError) return cause.detail;
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message.trim();
  return String(cause);
}

function parseBridgeServerURL(output: string): string | null {
  for (const line of output.split("\n")) {
    if (!line.startsWith(T3CHAT_BRIDGE_READY_PREFIX)) {
      continue;
    }
    const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
    return match?.[1] ?? null;
  }
  return null;
}

function parseBridgeVersion(output: string): string | null {
  const match = output.match(/\b(\d+\.\d+\.\d+)\b/);
  return match?.[1] ?? null;
}

const makeT3ChatRuntime = Effect.gen(function* () {
  const netService = yield* NetService.NetService;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const runT3ChatBridgeCommand = (input: {
    readonly binaryPath: string;
    readonly args: ReadonlyArray<string>;
    readonly environment?: NodeJS.ProcessEnv;
  }) =>
    Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make(input.binaryPath, [...input.args], {
          env: input.environment ?? process.env,
          shell: process.platform === "win32",
        }),
      );

      const [stdout, stderr, code] = yield* Effect.all(
        [collectStreamAsString(child.stdout), collectStreamAsString(child.stderr), child.exitCode],
        { concurrency: "unbounded" },
      );
      const exitCode = Number(code);
      if (isWindowsCommandNotFound(exitCode, stderr)) {
        return yield* new T3ChatBridgeError({
          operation: "runT3ChatBridgeCommand",
          detail: `spawn ${input.binaryPath} ENOENT`,
        });
      }

      return {
        stdout,
        stderr,
        code: exitCode,
      } satisfies T3ChatCommandResult;
    }).pipe(
      Effect.scoped,
      Effect.mapError(
        (cause) =>
          new T3ChatBridgeError({
            operation: "runT3ChatBridgeCommand",
            detail: `Failed to execute '${input.binaryPath} ${input.args.join(" ")}': ${t3ChatBridgeErrorDetail(cause)}`,
            cause,
          }),
      ),
    );

  const startT3ChatBridgeProcess = Effect.fn("startT3ChatBridgeProcess")(function* (input: {
    readonly binaryPath: string;
    readonly wosSession?: string;
    readonly convexSessionId?: string;
    readonly environment?: NodeJS.ProcessEnv;
    readonly port?: number;
    readonly hostname?: string;
    readonly timeoutMs?: number;
  }) {
    const runtimeScope = yield* Scope.Scope;
    const hostname = input.hostname ?? DEFAULT_HOSTNAME;
    const port =
      input.port ??
      (yield* netService.findAvailablePort(0).pipe(
        Effect.mapError(
          (cause) =>
            new T3ChatBridgeError({
              operation: "startT3ChatBridgeProcess",
              detail: `Failed to find available port: ${t3ChatBridgeErrorDetail(cause)}`,
              cause,
            }),
        ),
      ));
    const timeoutMs = input.timeoutMs ?? DEFAULT_T3CHAT_BRIDGE_TIMEOUT_MS;

    const args = ["--listen-host", hostname, "--port", String(port)];
    if (input.wosSession) {
      args.push("--wos-session", input.wosSession);
    }
    if (input.convexSessionId) {
      args.push("--convex-session-id", input.convexSessionId);
    }

    const child = yield* spawner
      .spawn(
        ChildProcess.make(input.binaryPath, args, {
          detached: process.platform !== "win32",
          shell: process.platform === "win32",
          env: input.environment ?? process.env,
        }),
      )
      .pipe(
        Effect.provideService(Scope.Scope, runtimeScope),
        Effect.mapError(
          (cause) =>
            new T3ChatBridgeError({
              operation: "startT3ChatBridgeProcess",
              detail: `Failed to spawn T3 Chat bridge process: ${t3ChatBridgeErrorDetail(cause)}`,
              cause,
            }),
        ),
      );

    const killProcessGroup = (signal: NodeJS.Signals) =>
      process.platform === "win32"
        ? child.kill({ killSignal: signal, forceKillAfter: "1 second" }).pipe(Effect.asVoid)
        : Effect.sync(() => {
            try {
              process.kill(-Number(child.pid), signal);
            } catch {
              // Best-effort cleanup.
            }
          });

    yield* Scope.addFinalizer(
      runtimeScope,
      killProcessGroup("SIGTERM").pipe(
        Effect.andThen(Effect.sleep("1 second")),
        Effect.andThen(killProcessGroup("SIGKILL")),
        Effect.ignore,
      ),
    );

    const stdoutRef = yield* Ref.make("");
    const stderrRef = yield* Ref.make("");
    const readyDeferred = yield* Deferred.make<string, T3ChatBridgeError>();

    const stdoutFiber = yield* child.stdout.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) =>
        Ref.updateAndGet(stdoutRef, (stdout) => `${stdout}${chunk}`).pipe(
          Effect.flatMap((stdout) => {
            const url = parseBridgeServerURL(stdout);
            return url ? Deferred.succeed(readyDeferred, url).pipe(Effect.ignore) : Effect.void;
          }),
        ),
      ),
      Effect.ignore,
      Effect.forkIn(runtimeScope),
    );

    const stderrFiber = yield* child.stderr.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) => Ref.update(stderrRef, (stderr) => `${stderr}${chunk}`)),
      Effect.ignore,
      Effect.forkIn(runtimeScope),
    );

    const exitFiber = yield* child.exitCode.pipe(
      Effect.flatMap((code) =>
        Effect.gen(function* () {
          const stdout = yield* Ref.get(stdoutRef);
          const stderr = yield* Ref.get(stderrRef);
          const exitCode = Number(code);
          yield* Deferred.fail(
            readyDeferred,
            new T3ChatBridgeError({
              operation: "startT3ChatBridgeProcess",
              detail: [
                `T3 Chat bridge exited before startup completed (code: ${String(exitCode)}).`,
                stdout.trim() ? `stdout:\n${stdout.trim()}` : null,
                stderr.trim() ? `stderr:\n${stderr.trim()}` : null,
              ]
                .filter(Boolean)
                .join("\n\n"),
              cause: { exitCode, stdout, stderr },
            }),
          ).pipe(Effect.ignore);
        }),
      ),
      Effect.ignore,
      Effect.forkIn(runtimeScope),
    );

    const readyExit = yield* Effect.exit(
      Deferred.await(readyDeferred).pipe(Effect.timeoutOption(timeoutMs)),
    );

    yield* Fiber.interrupt(stdoutFiber).pipe(Effect.ignore);
    yield* Fiber.interrupt(stderrFiber).pipe(Effect.ignore);

    if (Exit.isFailure(readyExit)) {
      yield* Fiber.interrupt(exitFiber).pipe(Effect.ignore);
      const squashed = Cause.squash(readyExit.cause);
      return yield* new T3ChatBridgeError({
        operation: "startT3ChatBridgeProcess",
        detail: `Failed while waiting for T3 Chat bridge startup: ${t3ChatBridgeErrorDetail(squashed)}`,
        cause: squashed,
      });
    }

    const readyOption = readyExit.value;
    if (Option.isNone(readyOption)) {
      yield* Fiber.interrupt(exitFiber).pipe(Effect.ignore);
      return yield* new T3ChatBridgeError({
        operation: "startT3ChatBridgeProcess",
        detail: `Timed out waiting for T3 Chat bridge start after ${timeoutMs}ms.`,
      });
    }

    return {
      url: readyOption.value,
      exitCode: child.exitCode.pipe(
        Effect.map(Number),
        Effect.orElseSucceed(() => 0),
      ),
    } satisfies T3ChatBridgeProcess;
  });

  const connectToT3ChatBridge: T3ChatRuntimeShape["connectToT3ChatBridge"] = (input) => {
    const serverURL = input.serverUrl?.trim();
    if (serverURL) {
      return Effect.succeed({
        url: serverURL,
        exitCode: null,
        external: true,
      });
    }

    return startT3ChatBridgeProcess(input).pipe(
      Effect.map((bridge) => ({
        url: bridge.url,
        exitCode: bridge.exitCode,
        external: false,
      })),
    );
  };

  const runT3ChatBridgeVersionCheck: T3ChatRuntimeShape["runT3ChatBridgeVersionCheck"] = (input) =>
    runT3ChatBridgeCommand({
      binaryPath: input.binaryPath,
      args: ["--version"],
      ...(input.environment !== undefined ? { environment: input.environment } : {}),
    }).pipe(
      Effect.flatMap((result) => {
        if (result.code !== 0) {
          return Effect.fail(
            new T3ChatBridgeError({
              operation: "runT3ChatBridgeVersionCheck",
              detail:
                result.stderr.trim() ||
                result.stdout.trim() ||
                `Version check exited with code ${result.code}.`,
            }),
          );
        }

        const version = parseBridgeVersion(result.stdout);
        if (!version) {
          return Effect.fail(
            new T3ChatBridgeError({
              operation: "runT3ChatBridgeVersionCheck",
              detail: "Could not parse T3 Chat bridge version output.",
              cause: result.stdout,
            }),
          );
        }

        return Effect.succeed(version);
      }),
    );

  return {
    connectToT3ChatBridge,
    runT3ChatBridgeVersionCheck,
  } satisfies T3ChatRuntimeShape;
});

export class T3ChatRuntime extends Context.Service<T3ChatRuntime, T3ChatRuntimeShape>()(
  "t3/provider/T3ChatRuntime",
) {}

export const T3ChatRuntimeLive = Layer.effect(T3ChatRuntime, makeT3ChatRuntime).pipe(
  Layer.provide(NetService.layer),
);
