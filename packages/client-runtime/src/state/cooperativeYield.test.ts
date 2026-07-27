import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { makeCooperativeYield } from "./cooperativeYield.ts";

describe("makeCooperativeYield", () => {
  it.effect("does not hand off while the current slice is still short", () =>
    Effect.gen(function* () {
      let clockMs = 0;
      const handOffs = yield* Ref.make(0);
      const cooperativeYield = makeCooperativeYield({
        sliceMs: 50,
        now: () => clockMs,
        handOff: Ref.update(handOffs, (count) => count + 1),
      });

      clockMs = 10;
      yield* cooperativeYield;
      clockMs = 40;
      yield* cooperativeYield;

      expect(yield* Ref.get(handOffs)).toBe(0);
    }),
  );

  it.effect("hands off once the slice is exceeded", () =>
    Effect.gen(function* () {
      let clockMs = 0;
      const handOffs = yield* Ref.make(0);
      const cooperativeYield = makeCooperativeYield({
        sliceMs: 50,
        now: () => clockMs,
        handOff: Ref.update(handOffs, (count) => count + 1),
      });

      clockMs = 80;
      yield* cooperativeYield;

      expect(yield* Ref.get(handOffs)).toBe(1);
    }),
  );

  it.effect("starts a fresh slice after handing off", () =>
    Effect.gen(function* () {
      let clockMs = 0;
      const handOffs = yield* Ref.make(0);
      const cooperativeYield = makeCooperativeYield({
        sliceMs: 50,
        now: () => clockMs,
        handOff: Ref.update(handOffs, (count) => count + 1),
      });

      clockMs = 80;
      yield* cooperativeYield;
      expect(yield* Ref.get(handOffs)).toBe(1);

      // Budget replenished: short work afterwards costs nothing.
      clockMs = 100;
      yield* cooperativeYield;
      expect(yield* Ref.get(handOffs)).toBe(1);

      // Another long stretch pays again.
      clockMs = 200;
      yield* cooperativeYield;
      expect(yield* Ref.get(handOffs)).toBe(2);
    }),
  );

  it.effect("hands off repeatedly across a sustained burst", () =>
    Effect.gen(function* () {
      // A sync burst is many small units of work back to back; the point is that
      // the host gets a window regularly rather than once at the end.
      let clockMs = 0;
      const handOffs = yield* Ref.make(0);
      const cooperativeYield = makeCooperativeYield({
        sliceMs: 50,
        now: () => clockMs,
        handOff: Ref.update(handOffs, (count) => count + 1),
      });

      for (let unit = 0; unit < 100; unit += 1) {
        clockMs += 10;
        yield* cooperativeYield;
      }

      // 1000ms of work at a 50ms slice: a handoff roughly every slice, not one.
      expect(yield* Ref.get(handOffs)).toBe(20);
    }),
  );
});
