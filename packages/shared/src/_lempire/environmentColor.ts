// [FORK] lempire: per-machine accent colors, a pure function of the environment
// id. Never store them: the connection catalog is per-device and does not sync,
// so web and mobile must each derive the same color from the same id.

/**
 * Mid-tone hues legible on light and dark backgrounds once mixed toward the
 * foreground. Neighbouring hues are interleaved so consecutive hash values
 * look distinct.
 */
export const ENVIRONMENT_ACCENT_PALETTE: readonly string[] = [
  "#8b5cf6",
  "#0891b2",
  "#d97706",
  "#10b981",
  "#f43f5e",
  "#3b82f6",
  "#f97316",
  "#14b8a6",
  "#ec4899",
  "#65a30d",
  "#6366f1",
  "#0ea5e9",
];

/** Fraction of the theme foreground blended into the accent for text. */
export const ENVIRONMENT_ACCENT_TEXT_MIX = 0.25;

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
 * The accent hue an environment *prefers*. Hashing alone duplicates colors often
 * (a 12-color palette collides in ~62% of 5-machine sidebars), so prefer
 * `assignEnvironmentAccentColors`, which starts here and resolves collisions.
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
 * Assign a visually distinct color per id: after the first (hashed) machine, each
 * takes the unused color whose hue is farthest from those taken. Ids are sorted,
 * so re-sorting the sidebar never reshuffles colors; past the palette size,
 * colors repeat.
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
