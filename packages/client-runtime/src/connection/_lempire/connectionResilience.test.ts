// [FORK] lempire: tests for the mobile connection resilience tuning.
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import { ConnectionTransientError, type ConnectionAttemptError } from "../model.ts";
import {
  disableMobileConnectionResilienceForTesting,
  enableMobileConnectionResilience,
  heartbeatMonitor,
  retryDelaysOverride,
  wakeProbe,
} from "./connectionResilience.ts";

const transientFailure = Effect.fail(
  new ConnectionTransientError({ reason: "timeout", detail: "probe failed" }),
);

describe("connectionResilience", () => {
  describe("wakeProbe", () => {
    it.effect("keeps upstream single-shot behavior while disabled", () =>
      Effect.gen(function* () {
        disableMobileConnectionResilienceForTesting();
        const fiber = yield* wakeProbe(Effect.never, "Test").pipe(Effect.forkChild);
        yield* TestClock.adjust("3 seconds");
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit)).toBe(true);
      }),
    );

    it.effect("retries transient failures until an attempt succeeds", () =>
      Effect.gen(function* () {
        enableMobileConnectionResilience();
        const calls = yield* Ref.make(0);
        const probe: Effect.Effect<void, ConnectionAttemptError> = Ref.updateAndGet(
          calls,
          (count) => count + 1,
        ).pipe(Effect.flatMap((attempt) => (attempt < 3 ? transientFailure : Effect.void)));
        yield* wakeProbe(probe, "Test");
        expect(yield* Ref.get(calls)).toBe(3);
      }),
    );

    it.effect("gives a hanging probe several timed attempts before failing", () =>
      Effect.gen(function* () {
        enableMobileConnectionResilience();
        const fiber = yield* wakeProbe(Effect.never, "Test").pipe(Effect.forkChild);
        yield* TestClock.adjust("11 seconds");
        expect(fiber.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust("1 seconds");
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit)).toBe(true);
      }),
    );
  });

  describe("heartbeatMonitor", () => {
    it.effect("probes a healthy session on the interval without failing", () =>
      Effect.gen(function* () {
        enableMobileConnectionResilience();
        const calls = yield* Ref.make(0);
        const fiber = yield* heartbeatMonitor(
          Ref.update(calls, (count) => count + 1),
          "Test",
        ).pipe(Effect.forkChild);
        yield* TestClock.adjust("61 seconds");
        expect(yield* Ref.get(calls)).toBe(4);
        expect(fiber.pollUnsafe()).toBeUndefined();
        yield* Fiber.interrupt(fiber);
      }),
    );

    it.effect("fails the lease after consecutive missed probes", () =>
      Effect.gen(function* () {
        enableMobileConnectionResilience();
        const fiber = yield* heartbeatMonitor(Effect.never, "Test").pipe(Effect.forkChild);
        // Miss 1 lands at 15s + 5s timeout, miss 2 at 40s.
        yield* TestClock.adjust("40 seconds");
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit)).toBe(true);
      }),
    );

    it.effect("a recovered probe resets the miss counter", () =>
      Effect.gen(function* () {
        enableMobileConnectionResilience();
        const calls = yield* Ref.make(0);
        // Odd probes miss, even probes succeed: never two consecutive misses.
        const probe: Effect.Effect<void, ConnectionAttemptError> = Ref.updateAndGet(
          calls,
          (count) => count + 1,
        ).pipe(Effect.flatMap((attempt) => (attempt % 2 === 1 ? transientFailure : Effect.void)));
        const fiber = yield* heartbeatMonitor(probe, "Test").pipe(Effect.forkChild);
        yield* TestClock.adjust("2 minutes");
        expect(yield* Ref.get(calls)).toBeGreaterThan(3);
        expect(fiber.pollUnsafe()).toBeUndefined();
        yield* Fiber.interrupt(fiber);
      }),
    );
  });

  it.effect("retry delays start at 1s only when enabled", () =>
    Effect.gen(function* () {
      disableMobileConnectionResilienceForTesting();
      expect(retryDelaysOverride()).toBeNull();
      enableMobileConnectionResilience();
      expect(retryDelaysOverride()?.[0]).toBe(1_000);
    }),
  );
});
