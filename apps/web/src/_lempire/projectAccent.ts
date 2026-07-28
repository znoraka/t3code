// [FORK] lempire: per-machine accent colors in the sidebar.
//
// One color per environment (machine), so every project on the same laptop/VPS
// shares a hue. Colors are assigned across all machines at once (hashing alone
// duplicates a color far too often — see `assignEnvironmentAccentColors`), so a
// row cannot derive its own. Rather than wrap the list in a context provider —
// which would re-indent ~80 lines of hot upstream JSX and conflict on every
// rebase — the accents ride along on the project snapshot as an extra field,
// which the existing `sortedProjects` prop path already carries to the row.

import {
  assignEnvironmentAccentColors,
  ENVIRONMENT_ACCENT_FADE_OFFSET,
  ENVIRONMENT_ACCENT_TEXT_MIX,
  ENVIRONMENT_ACCENT_WASH_OPACITY,
  environmentAccentStopOffset,
} from "@t3tools/shared/_lempire/environmentColor";
import { useMemo, type CSSProperties } from "react";
import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";

/**
 * An upstream project snapshot plus the accents of the machines it lives on.
 *
 * Usually one color. A row that aggregates the same repo across machines (the
 * `N projects` groups) carries one color per machine, blended by the wash.
 */
export type WithProjectAccent<T> = T & { readonly accentColors: readonly string[] };

/** Machines a row lives on, sorted so both platforms order the blend alike. */
function rowEnvironmentIds(project: SidebarProjectSnapshot): readonly string[] {
  const memberEnvironmentIds = project.memberProjects.map((member) => member.environmentId);
  const environmentIds =
    memberEnvironmentIds.length > 0 ? memberEnvironmentIds : [project.environmentId];
  return [...new Set(environmentIds)].sort();
}

/**
 * Attach each row's machine accent colors.
 *
 * Assignment spans every machine in the list, not just the ones on a given row,
 * so a machine keeps one color across every row it appears in. Memoized on the
 * incoming array so row identity stays stable and the memoized
 * `SidebarProjectItem` does not re-render on every parent render.
 */
export function useProjectAccents(
  projects: readonly SidebarProjectSnapshot[],
): readonly WithProjectAccent<SidebarProjectSnapshot>[] {
  return useMemo(() => {
    const accentByEnvironmentId = assignEnvironmentAccentColors(
      projects.flatMap((project) => rowEnvironmentIds(project)),
    );

    return projects.map((project) => ({
      ...project,
      accentColors: projectAccentColors(project, accentByEnvironmentId),
    }));
  }, [projects]);
}

/**
 * The accents of the machines a project row lives on, in blend order.
 *
 * For callers that already hold an assignment (Sidebar V2 assigns once for the
 * whole thread list and reuses it for the project scope menu) rather than
 * deriving one per project list.
 */
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
 * Accent color per machine, keyed on environment id.
 *
 * Sidebar V2 lists threads flat instead of nesting them under project headers,
 * so there is no project snapshot to hang `accentColors` off — a row resolves
 * its color from `thread.environmentId`. Same assignment as `useProjectAccents`
 * over the same set of machines, so a machine reads the same color in either
 * sidebar.
 *
 * Memoized on the *set* of ids rather than array identity: callers derive the
 * list inline on every render, and re-running assignment would hand every row a
 * fresh style object.
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

/**
 * Inline styles for the accent wash on a project header.
 *
 * `color-mix` against `--foreground` (rather than a baked hex) is what lets one
 * palette work in both themes: the accent is pulled toward white on dark and
 * toward black on light, tracking the live theme variable with no JS.
 */
export function projectAccentHeaderStyle(
  accentColors: readonly string[],
): CSSProperties | undefined {
  if (accentColors.length === 0) {
    return undefined;
  }

  const washPercent = `${Math.round(ENVIRONMENT_ACCENT_WASH_OPACITY * 100)}%`;
  const stops = accentColors.map(
    (accentColor, index) =>
      `color-mix(in oklab, ${accentColor} ${washPercent}, transparent) ${environmentAccentStopOffset(index, accentColors.length)}%`,
  );

  return {
    backgroundImage: `linear-gradient(90deg, ${stops.join(", ")}, transparent ${ENVIRONMENT_ACCENT_FADE_OFFSET}%)`,
  };
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
