// [FORK] lempire: per-machine accent colors, matching the web sidebar.
//
// One color per environment (machine), so every project on the same laptop/VPS
// shares a hue. Both platforms feed `assignEnvironmentAccentColors` the same
// server-issued environment ids, which is what makes them agree with no syncing.
//
// Assignment runs over the *unfiltered* project list on purpose. The visible
// list is narrowed by the search query and the selected environment, so
// assigning over that would reshuffle colors as you type — and would drop a
// machine's color entirely while filtered to another machine.

import { assignEnvironmentAccentColors } from "@t3tools/shared/_lempire/environmentColor";
import { useMemo } from "react";

/**
 * Accent color per machine, keyed on environment id.
 *
 * Rows resolve their color from `thread.environmentId`, with the same
 * assignment as the web sidebar (which derives it identically).
 *
 * Memoized on the *set* of ids rather than array identity: callers derive the
 * list inline on every render, and re-running assignment would hand every row a
 * fresh color string and defeat the row memo.
 */
export function useEnvironmentAccents(
  environmentIds: readonly string[],
): ReadonlyMap<string, string> {
  // Newline-joined so the key round-trips ids containing any URL-ish character.
  const accentKey = [...new Set(environmentIds)].sort().join("\n");
  return useMemo(
    () => assignEnvironmentAccentColors(accentKey === "" ? [] : accentKey.split("\n")),
    [accentKey],
  );
}
