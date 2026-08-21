// [FORK] lempire: connection resilience tuning for mobile.
//
// Diagnosed 2026-08-21 with a side-by-side websocket benchmark (public path vs
// Tailscale path): the network holds an actively-pinged websocket open
// indefinitely, yet the app "always disconnects". Three causes, all fixed here:
//
// 1. No keepalive. Upstream never probes an established session, so an idle
//    socket dies silently (VPN/NAT middleboxes reap idle flows; mobile OSes
//    kill sockets without delivering a close event) and the death is only
//    discovered on the next user action. `heartbeatMonitor` probes the live
//    session on an interval and fails the lease after consecutive misses so
//    the supervisor reconnects instead of presenting a zombie connection.
// 2. Single-shot 3s wake probe. After a short background, one probe with a 3s
//    timeout decides whether the connection lives. A healthy VPN path can
//    exceed 3s right after device wake (RTT spikes past 1s were measured in
//    steady state), so good connections get torn down and the user watches a
//    pointless reconnect cycle. `wakeProbe` retries transient failures with a
//    per-attempt timeout before declaring death.
// 3. The first reconnect waited 3s. `retryDelaysOverride` starts the retry
//    ladder at 1s instead.
//
// Everything is inert until `enableMobileConnectionResilience()` runs (the
// mobile platform layer calls it at module load). Upstream supervisor tests
// therefore exercise unchanged upstream behavior.

import * as Effect from "effect/Effect";

import { ConnectionTransientError, type ConnectionAttemptError } from "../model.ts";

// 5s, not just dead-socket detection: on iOS the Tailscale tunnel itself
// wedges when flows go idle (measured: a 2s-ping websocket held for 7+
// minutes while 15s-heartbeat app connections died mid-use). Constant
// foreground traffic keeps the tunnel alive; the cost is one tiny RPC per
// connected environment per interval, only while the app is foregrounded.
const HEARTBEAT_INTERVAL = "5 seconds";
const HEARTBEAT_PROBE_TIMEOUT = "5 seconds";
const HEARTBEAT_MAX_MISSES = 2;

const WAKE_PROBE_ATTEMPT_TIMEOUT = "4 seconds";
const WAKE_PROBE_ATTEMPTS = 3;

const UPSTREAM_MOBILE_WAKE_PROBE_TIMEOUT = "3 seconds";

const FORK_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;

let resilienceEnabled = false;

/** Opt in to the tuned behavior. The mobile platform layer calls this once. */
export function enableMobileConnectionResilience(): void {
  resilienceEnabled = true;
}

/** The flag is module-global; tests use this to restore upstream behavior. */
export function disableMobileConnectionResilienceForTesting(): void {
  resilienceEnabled = false;
}

/** Shorter reconnect delays when enabled; null falls back to upstream's ladder. */
export function retryDelaysOverride(): readonly number[] | null {
  return resilienceEnabled ? FORK_RETRY_DELAYS_MS : null;
}

function probeTimeoutError(label: string): ConnectionTransientError {
  return new ConnectionTransientError({
    reason: "timeout",
    detail: `${label} did not respond to a connection health check.`,
  });
}

/**
 * The probe run on `application-active-probe` wakeups. Upstream behavior (one
 * attempt, 3s timeout) when the tuning is disabled; several timed attempts,
 * retrying transient failures, when enabled.
 */
export function wakeProbe(
  probe: Effect.Effect<void, ConnectionAttemptError>,
  label: string,
): Effect.Effect<void, ConnectionAttemptError> {
  if (!resilienceEnabled) {
    return probe.pipe(
      Effect.timeoutOrElse({
        duration: UPSTREAM_MOBILE_WAKE_PROBE_TIMEOUT,
        orElse: () => Effect.fail(probeTimeoutError(label)),
      }),
    );
  }
  const attempt = probe.pipe(
    Effect.timeoutOrElse({
      duration: WAKE_PROBE_ATTEMPT_TIMEOUT,
      orElse: () => Effect.fail(probeTimeoutError(label)),
    }),
  );
  const go = (remaining: number): Effect.Effect<void, ConnectionAttemptError> =>
    attempt.pipe(
      Effect.catch((error) =>
        remaining > 1 && error._tag === "ConnectionTransientError"
          ? go(remaining - 1)
          : Effect.fail(error),
      ),
    );
  return go(WAKE_PROBE_ATTEMPTS);
}

/**
 * Keepalive for an established session: probes on an interval and fails (so
 * the supervisor reconnects) after `HEARTBEAT_MAX_MISSES` consecutive misses.
 * Never completes otherwise, so it can be raced with the lease monitor. A
 * suspended app freezes the interval timer, so this only runs — and only
 * spends battery — while the app is in the foreground.
 */
export function heartbeatMonitor(
  probe: Effect.Effect<void, ConnectionAttemptError>,
  label: string,
): Effect.Effect<never, ConnectionAttemptError> {
  if (!resilienceEnabled) {
    return Effect.never;
  }
  return Effect.gen(function* () {
    let misses = 0;
    for (;;) {
      yield* Effect.sleep(HEARTBEAT_INTERVAL);
      const outcome = yield* probe.pipe(
        Effect.timeoutOrElse({
          duration: HEARTBEAT_PROBE_TIMEOUT,
          orElse: () => Effect.fail(probeTimeoutError(label)),
        }),
        Effect.map(() => "ok" as const),
        Effect.catch((error) =>
          error._tag === "ConnectionTransientError"
            ? Effect.succeed("miss" as const)
            : Effect.fail(error),
        ),
      );
      if (outcome === "ok") {
        misses = 0;
        continue;
      }
      misses += 1;
      if (misses >= HEARTBEAT_MAX_MISSES) {
        return yield* Effect.fail(
          new ConnectionTransientError({
            reason: "timeout",
            detail: `${label} stopped answering keepalive probes.`,
          }),
        );
      }
    }
  });
}
