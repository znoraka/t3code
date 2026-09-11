import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const rule = createOxlintRuleHarness("t3code/no-array-to-sorted");

describe("t3code/no-array-to-sorted", () => {
  rule.valid(
    "allows sorting a copy",
    `
      export const sorted = (items: ReadonlyArray<string>) => [...items].sort();
    `,
  );

  rule.valid(
    "allows other ES2023 methods Hermes implements",
    `
      export const last = (items: ReadonlyArray<string>) => items.findLast(Boolean);
      export const reversed = (items: ReadonlyArray<string>) => items.toReversed();
    `,
  );

  rule.invalid(
    "reports toSorted calls",
    `
      export const sorted = (items: ReadonlyArray<string>) => items.toSorted();
    `,
    (output) => {
      assert.match(output, /not implemented by Hermes/);
    },
  );

  rule.invalid(
    "reports chained toSorted calls with a comparator",
    `
      export const sorted = (items: ReadonlyArray<number>) =>
        items.filter(Boolean).toSorted((a, b) => a - b);
    `,
  );
});
