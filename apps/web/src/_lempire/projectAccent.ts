// [FORK] lempire: per-machine accent colors in the sidebar. Colors are assigned
// across all machines at once (hashing alone duplicates a color far too often —
// see `assignEnvironmentAccentColors`), so a row cannot derive its own.

import {
  assignEnvironmentAccentColors,
  ENVIRONMENT_ACCENT_TEXT_MIX,
} from "@t3tools/shared/_lempire/environmentColor";
import { useMemo, type CSSProperties } from "react";
import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";

/** Machines a row lives on, sorted so both platforms order the blend alike. */
function rowEnvironmentIds(project: SidebarProjectSnapshot): readonly string[] {
  const memberEnvironmentIds = project.memberProjects.map((member) => member.environmentId);
  const environmentIds =
    memberEnvironmentIds.length > 0 ? memberEnvironmentIds : [project.environmentId];
  return [...new Set(environmentIds)].sort();
}

/** The accents of the machines a project row lives on, in blend order. */
export function projectAccentColors(
  project: SidebarProjectSnapshot,
  accentByEnvironmentId: ReadonlyMap<string, string>,
): readonly string[] {
  return rowEnvironmentIds(project).flatMap((environmentId) => {
    const accent = accentByEnvironmentId.get(environmentId);
    return accent ? [accent] : [];
  });
}

/**
 * Accent color per machine, keyed on environment id. Keyed on the *set* of ids
 * rather than array identity: callers derive the list inline on every render,
 * and a fresh assignment would hand every row a fresh style object.
 */
export function useEnvironmentAccents(
  environmentIds: readonly string[],
): ReadonlyMap<string, string> {
  // Newline-joined so the key round-trips ids containing any URL-ish character.
  const accentKey = [...new Set(environmentIds)].sort().join("\n");
  // oxlint-disable-next-line t3code/no-manual-memo -- the compiler would key on array identity, not the id set
  return useMemo(
    () => assignEnvironmentAccentColors(accentKey === "" ? [] : accentKey.split("\n")),
    [accentKey],
  );
}

/** The project name takes the first machine's color. */
export function projectAccentNameStyle(accentColors: readonly string[]): CSSProperties | undefined {
  const accentColor = accentColors[0];
  if (!accentColor) {
    return undefined;
  }

  const accentPercent = `${Math.round((1 - ENVIRONMENT_ACCENT_TEXT_MIX) * 100)}%`;
  return {
    color: `color-mix(in oklab, ${accentColor} ${accentPercent}, var(--foreground))`,
  };
}
