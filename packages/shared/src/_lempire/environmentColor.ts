// [FORK] lempire: deterministic per-environment accent colors for the sidebar.
//
// One color per *machine* (environment), not per project: every project on the
// same laptop/VPS shares a hue, so the color answers "where does this run?".
//
// The color is a pure function of the environment id, never stored. That
// matters: the connection catalog is persisted per-device (IndexedDB on web,
// secure storage on mobile) and does NOT sync, so any *stored* color would need
// a sync channel that does not exist. Deriving instead means web and mobile
// independently compute the same color for the same machine, for free — the
// server mints `environmentId` once and every client copies it verbatim, so the
// two platforms already agree on the input.

/**
 * Mid-tone hues that stay legible against both the light and dark app
 * backgrounds. Rendering lightens these toward the foreground in dark mode and
 * darkens them in light mode (see `environmentAccentTextColor`), so the palette
 * is stored at the mid point rather than tuned for one theme.
 *
 * Ordering interleaves neighbouring hues so that adjacent palette indices stay
 * far apart on the color wheel — consecutive hash values look distinct.
 */
export const ENVIRONMENT_ACCENT_PALETTE: readonly string[] = [
  "#8b5cf6", // violet
  "#0891b2", // cyan
  "#d97706", // amber
  "#10b981", // emerald
  "#f43f5e", // rose
  "#3b82f6", // blue
  "#f97316", // orange
  "#14b8a6", // teal
  "#ec4899", // pink
  "#65a30d", // lime
  "#6366f1", // indigo
  "#0ea5e9", // sky
];

/**
 * Fraction of the theme foreground blended into the accent for text. Pulls the
 * hue toward white on dark backgrounds and toward black on light ones, which is
 * what keeps a single palette readable in both themes.
 */
export const ENVIRONMENT_ACCENT_TEXT_MIX = 0.25;

/** Peak opacity of the header wash gradient. */
export const ENVIRONMENT_ACCENT_WASH_OPACITY = 0.16;

/** FNV-1a (32-bit). Stable across platforms and JS engines — no crypto needed. */
function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    // Multiply by the FNV prime (16777619) using shifts to stay in 32-bit range.
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The accent hue an environment *prefers*, as a `#rrggbb` string.
 *
 * Hashing alone cannot keep a sidebar's colors distinct — that is the birthday
 * problem, not bad luck: with a 12-color palette, ~62% of 5-machine sidebars
 * and ~95% of 8-machine ones contain a duplicate, and widening the palette
 * barely moves those odds. Prefer `assignEnvironmentAccentColors`, which starts
 * here and then resolves collisions. Exported for callers that genuinely want a
 * per-id pure function and can tolerate duplicates.
 */
export function environmentAccentColor(environmentId: string): string {
  const palette = ENVIRONMENT_ACCENT_PALETTE;
  return palette[hashKey(environmentId) % palette.length] as string;
}

/** Hue angle (0..360) of a `#rrggbb` color. Grey returns 0. */
function hueOf(color: string): number {
  const channels = parseHexColor(color);
  if (!channels) {
    return 0;
  }

  const [red, green, blue] = channels.map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(red, green, blue);
  const chroma = max - Math.min(red, green, blue);
  if (chroma === 0) {
    return 0;
  }

  let hue: number;
  if (max === red) {
    hue = ((green - blue) / chroma) % 6;
  } else if (max === green) {
    hue = (blue - red) / chroma + 2;
  } else {
    hue = (red - green) / chroma + 4;
  }

  // The red branch can go negative, so normalize into 0..360.
  return (((hue * 60) % 360) + 360) % 360;
}

/** Shortest distance between two hue angles, 0..180. */
function hueDistance(left: number, right: number): number {
  const delta = Math.abs(left - right) % 360;
  return delta > 180 ? 360 - delta : delta;
}

/**
 * Assign a visually distinct accent color to each environment id.
 *
 * Distinct *palette slots* are not the same as distinct *colors*: the palette
 * holds several greens, so picking slots by hash alone routinely lands four
 * machines on cyan/teal/emerald/lime — technically different, perceptually one
 * color, and useless for telling machines apart. So instead of probing to the
 * next free slot, each machine after the first takes the unused color whose hue
 * is farthest from every hue already taken. Two machines land ~180° apart,
 * three ~120°, and so on.
 *
 * The first machine still takes its hashed preference, which keeps the palette
 * anchored to the ids rather than to list position.
 *
 * Assignment runs over the ids *sorted*, not in display order, so re-sorting
 * the sidebar never reshuffles colors. Connecting or removing a machine still
 * can, which is the price of guaranteed distinctness — see the FORK.md notes.
 * Past `ENVIRONMENT_ACCENT_PALETTE.length` machines the palette is exhausted and
 * colors repeat; the group name still disambiguates.
 */
export function assignEnvironmentAccentColors(
  environmentIds: readonly string[],
): ReadonlyMap<string, string> {
  const palette = ENVIRONMENT_ACCENT_PALETTE;
  const paletteHues = palette.map(hueOf);
  const orderedIds = [...new Set(environmentIds)].sort();
  const takenIndices = new Set<number>();
  const assigned = new Map<string, string>();

  for (const environmentId of orderedIds) {
    if (takenIndices.size >= palette.length) {
      // Palette exhausted — fall back to the hashed preference and let colors
      // repeat rather than leaving a machine untinted.
      assigned.set(environmentId, palette[hashKey(environmentId) % palette.length] as string);
      continue;
    }

    let chosenIndex: number;
    if (takenIndices.size === 0) {
      chosenIndex = hashKey(environmentId) % palette.length;
    } else {
      const takenHues = [...takenIndices].map((index) => paletteHues[index] as number);
      let bestScore = -1;
      chosenIndex = 0;
      for (let index = 0; index < palette.length; index += 1) {
        if (takenIndices.has(index)) {
          continue;
        }
        const hue = paletteHues[index] as number;
        const score = Math.min(...takenHues.map((taken) => hueDistance(hue, taken)));
        // Ties break on the lower index, keeping the result deterministic.
        if (score > bestScore) {
          bestScore = score;
          chosenIndex = index;
        }
      }
    }

    takenIndices.add(chosenIndex);
    assigned.set(environmentId, palette[chosenIndex] as string);
  }

  return assigned;
}

function parseHexColor(color: string): readonly [number, number, number] | null {
  const hex = color.trim().replace(/^#/, "");
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : hex;

  if (expanded.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(expanded)) {
    return null;
  }

  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

function toHexChannel(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, "0");
}

/**
 * Blend two `#rrggbb` colors in sRGB.
 *
 * Returns `base` unchanged when either input is not parseable hex — callers on
 * mobile pass a theme variable that is hex today but is not guaranteed to be.
 *
 * @param weight share of `blend` in the result, 0..1.
 */
export function mixHexColors(base: string, blend: string, weight: number): string {
  const baseChannels = parseHexColor(base);
  const blendChannels = parseHexColor(blend);
  if (!baseChannels || !blendChannels) {
    return base;
  }

  const ratio = Math.max(0, Math.min(1, weight));
  const mixed = baseChannels.map(
    (channel, index) => channel * (1 - ratio) + (blendChannels[index] as number) * ratio,
  );

  return `#${mixed.map(toHexChannel).join("")}`;
}

/**
 * An accent color adjusted for use as text against `foregroundColor`.
 *
 * Web does this in CSS via `color-mix` so it tracks the live theme variable;
 * this is the equivalent for React Native, which has no `color-mix`.
 */
export function environmentAccentTextColor(accentColor: string, foregroundColor: string): string {
  return mixHexColors(accentColor, foregroundColor, ENVIRONMENT_ACCENT_TEXT_MIX);
}

/** DOM/SVG-safe id derived from a key (group keys contain `/`, `:` and `.`). */
export function environmentAccentGradientId(key: string): string {
  return `env-accent-${hashKey(key).toString(36)}`;
}

/**
 * Where each color sits along the header wash, as a 0..100 percentage.
 *
 * A row that lives on one machine gets that machine's color at 0% fading out —
 * the single-color case is exactly the original treatment. A row aggregated
 * across machines (the same repo on a laptop and a VPS) blends their colors
 * left to right, so the wash shows the row genuinely spans both rather than
 * silently picking one.
 */
export function environmentAccentStopOffset(index: number, count: number): number {
  const blendSpan = 55;
  return count <= 1 ? 0 : (index / (count - 1)) * blendSpan;
}

/** Where the wash has fully faded out. */
export const ENVIRONMENT_ACCENT_FADE_OFFSET = 85;
