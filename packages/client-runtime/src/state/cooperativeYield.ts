import * as Effect from "effect/Effect";

/**
 * Hands the JavaScript thread back to the host part-way through a long run of
 * stream work.
 *
 * A synchronization burst — the initial sync, or a resume after reconnect —
 * applies many stream items back to back. Effect will happily run that whole
 * sequence without returning control, and on React Native the JS thread is also
 * the thread that dispatches touches, so the UI is dead for the duration. A
 * measured burst on mobile blocked it for ~19 seconds.
 *
 * Yielding via a timer rather than a microtask or `setImmediate` is deliberate:
 * React Native flushes immediates at the end of each native→JS batch, *before*
 * returning to native, so they do not let queued touch events through. Only a
 * timer genuinely hands the thread back.
 *
 * Yields are time-sliced rather than per item: a quiet stream pays nothing, and
 * a busy one gives the host a window at least every `sliceMs` of continuous
 * work. This does not make the burst faster — it makes the app responsive while
 * the burst runs, and lets the list paint progressively instead of appearing
 * all at once at the end.
 */

const DEFAULT_SLICE_MS = 50;

interface ClockLike {
  readonly now?: () => number;
}

function monotonicNow(): number {
  const performanceLike = (globalThis as { readonly performance?: ClockLike }).performance;
  const now = performanceLike?.now;
  // Measures a wall-clock slice of uninterrupted host work. Effect's Clock is
  // virtual under test and would report no elapsed time, so the burst would
  // never yield.
  // @effect-diagnostics-next-line globalDate:off - Host wall clock, not Effect time.
  return typeof now === "function" ? now.call(performanceLike) : Date.now();
}

const handOffToHost = Effect.callback<void>((resume) => {
  // The whole point of this module: only a real host timer returns the JS
  // thread to React Native. Effect.sleep resolves on Effect's own scheduler and
  // never lets queued touches through.
  // @effect-diagnostics-next-line globalTimersInEffect:off - Must be a host timer.
  const timer = setTimeout(() => resume(Effect.void), 0);
  return Effect.sync(() => clearTimeout(timer));
});

/**
 * Builds an effect to run after each unit of stream work. It yields only once
 * the current uninterrupted run has exceeded `sliceMs`, so steady-state updates
 * are unaffected.
 *
 * `now` and `handOff` exist so the slicing decision can be tested without fake
 * timers; production callers should take the defaults.
 */
export function makeCooperativeYield(options?: {
  readonly sliceMs?: number;
  readonly now?: () => number;
  readonly handOff?: Effect.Effect<void>;
}): Effect.Effect<void> {
  const sliceMs = options?.sliceMs ?? DEFAULT_SLICE_MS;
  const clockNow = options?.now ?? monotonicNow;
  const handOff = options?.handOff ?? handOffToHost;
  let sliceStartedAt = clockNow();
  return Effect.suspend(() => {
    const now = clockNow();
    if (now - sliceStartedAt < sliceMs) {
      return Effect.void;
    }
    sliceStartedAt = now;
    return handOff.pipe(Effect.andThen(Effect.sync(() => (sliceStartedAt = clockNow()))));
  });
}
