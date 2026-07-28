// [FORK] lempire: per-machine accent colors, matching the web sidebar.
//
// One color per environment (machine), so every project on the same laptop/VPS
// shares a hue. Both platforms feed `assignEnvironmentAccentColors` the same
// server-issued environment ids, which is what makes them agree with no syncing.
//
// Assignment runs over the *unfiltered* project list on purpose. The visible
// group list is narrowed by the search query and the selected environment, so
// assigning over that would reshuffle colors as you type — and would drop a
// machine's color entirely while filtered to another machine.

import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { assignEnvironmentAccentColors } from "@t3tools/shared/_lempire/environmentColor";
import { useMemo } from "react";
import type { HomeThreadGroup } from "../features/home/homeThreadList";

/** Machines a group lives on, sorted so both platforms order the blend alike. */
function groupEnvironmentIds(group: HomeThreadGroup): readonly string[] {
  const memberEnvironmentIds = group.projects.map((project) => project.environmentId as string);
  const environmentIds =
    memberEnvironmentIds.length > 0
      ? memberEnvironmentIds
      : [group.representative.environmentId as string];
  return [...new Set(environmentIds)].sort();
}

/**
 * Accent colors per group key — usually one, or one per machine for a group
 * that aggregates the same repo across machines.
 */
export function useGroupAccentColors(
  projects: readonly EnvironmentProject[],
  groups: readonly HomeThreadGroup[],
): ReadonlyMap<string, readonly string[]> {
  // Serialized so the memo keys on content rather than array identity: both
  // inputs are frequently rebuilt, and ids can contain any separator character.
  const environmentIdsToken = JSON.stringify(projects.map((project) => project.environmentId));
  const groupsToken = JSON.stringify(
    groups.map((group) => [group.key, groupEnvironmentIds(group)]),
  );

  return useMemo(() => {
    const accentByEnvironmentId = assignEnvironmentAccentColors(
      JSON.parse(environmentIdsToken) as string[],
    );
    const groupEntries = JSON.parse(groupsToken) as [string, string[]][];

    return new Map(
      groupEntries.map(([groupKey, environmentIds]) => [
        groupKey,
        environmentIds.flatMap((environmentId) => {
          const accent = accentByEnvironmentId.get(environmentId);
          return accent ? [accent] : [];
        }),
      ]),
    );
  }, [environmentIdsToken, groupsToken]);
}

/**
 * Accent color per machine, keyed on environment id.
 *
 * Thread list v2 lists threads flat instead of nesting them under project group
 * headers, so there is no group key to look up — a row resolves its color from
 * `thread.environmentId`. Same assignment as `useGroupAccentColors` over the
 * same set of machines, so a machine reads the same color in either list, and
 * the same color as the web sidebar (which derives it identically).
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
