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
