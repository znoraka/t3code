import { describe, expect, it } from "vitest";

import {
  assignEnvironmentAccentColors,
  ENVIRONMENT_ACCENT_PALETTE,
  environmentAccentColor,
  environmentAccentGradientId,
  environmentAccentStopOffset,
  environmentAccentTextColor,
  mixHexColors,
} from "./environmentColor.ts";

/** Hue angle of a `#rrggbb` color — mirrors the module's internal helper. */
function hueOfHex(color: string): number {
  const [red, green, blue] = [1, 3, 5].map(
    (offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255,
  ) as [number, number, number];
  const max = Math.max(red, green, blue);
  const chroma = max - Math.min(red, green, blue);
  if (chroma === 0) return 0;
  const hue =
    max === red
      ? ((green - blue) / chroma) % 6
      : max === green
        ? (blue - red) / chroma + 2
        : (red - green) / chroma + 4;
  return (((hue * 60) % 360) + 360) % 360;
}

/** Shortest distance between two hue angles, 0..180. */
function hueGap(left: number, right: number): number {
  const delta = Math.abs(left - right) % 360;
  return delta > 180 ? 360 - delta : delta;
}

/** Server-issued environment ids — one per machine, as clients see them. */
const MACHINE_IDS = [
  "6f1c9b6e-2a1d-4f3b-9c8e-1a2b3c4d5e6f", // this mac
  "b2c3d4e5-6f70-4812-93a4-b5c6d7e8f901", // vps
  "c3d4e5f6-7081-4923-a4b5-c6d7e8f90123", // laptop-server-home
  "d4e5f607-8192-4a34-b5c6-d7e8f9012345", // laptop-server-node
  "e5f60718-92a3-4b45-c6d7-e8f901234567", // desktop
];

describe("environmentAccentColor", () => {
  it("is stable for the same machine", () => {
    expect(environmentAccentColor(MACHINE_IDS[0]!)).toBe(environmentAccentColor(MACHINE_IDS[0]!));
  });

  it("always returns a palette color", () => {
    for (const id of [...MACHINE_IDS, "", "local:wsl", "🎨"]) {
      expect(ENVIRONMENT_ACCENT_PALETTE).toContain(environmentAccentColor(id));
    }
  });

  it("spreads ids across the whole palette", () => {
    const colors = new Set(
      Array.from({ length: 400 }, (_, index) => environmentAccentColor(`env-${index}`)),
    );
    expect(colors.size).toBe(ENVIRONMENT_ACCENT_PALETTE.length);
  });
});

describe("assignEnvironmentAccentColors", () => {
  it("gives every machine a distinct color", () => {
    const assigned = assignEnvironmentAccentColors(MACHINE_IDS);
    expect(new Set(assigned.values()).size).toBe(MACHINE_IDS.length);
  });

  it("gives every project on one machine the same color", () => {
    // The whole point: color identifies the machine, not the project. Callers
    // pass one id per project, so a mac with three projects appears three times.
    const mac = MACHINE_IDS[0]!;
    const vps = MACHINE_IDS[1]!;
    const assigned = assignEnvironmentAccentColors([mac, mac, mac, vps]);

    expect(assigned.size).toBe(2);
    expect(assigned.get(mac)).not.toBe(assigned.get(vps));
  });

  it("keeps machine colors far apart on the color wheel", () => {
    // Distinct palette slots are not enough — picking slots by hash alone put
    // four machines on cyan/teal/emerald/lime, which read as one color. Assert
    // the property that actually matters: the hues are separated.
    for (const machineCount of [2, 3, 4, 5]) {
      const ids = MACHINE_IDS.slice(0, machineCount);
      const colors = [...assignEnvironmentAccentColors(ids).values()];
      const hues = colors.map(hueOfHex);

      let closest = 360;
      for (let i = 0; i < hues.length; i += 1) {
        for (let j = i + 1; j < hues.length; j += 1) {
          closest = Math.min(closest, hueGap(hues[i]!, hues[j]!));
        }
      }

      // Two machines should sit near-opposite; even five stay clearly apart.
      const minimumSeparation = machineCount <= 4 ? 60 : 40;
      expect(closest).toBeGreaterThanOrEqual(minimumSeparation);
    }
  });

  it("keeps colors distinct up to the palette size", () => {
    const ids = Array.from({ length: ENVIRONMENT_ACCENT_PALETTE.length }, (_, i) => `env-${i}`);
    const assigned = assignEnvironmentAccentColors(ids);
    expect(new Set(assigned.values()).size).toBe(ENVIRONMENT_ACCENT_PALETTE.length);
  });

  it("still assigns every id once the palette is exhausted", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `env-${i}`);
    const assigned = assignEnvironmentAccentColors(ids);
    expect(assigned.size).toBe(40);
    for (const id of ids) {
      expect(ENVIRONMENT_ACCENT_PALETTE).toContain(assigned.get(id));
    }
  });

  it("does not depend on display order", () => {
    // Re-sorting the sidebar must never reshuffle colors.
    const forward = assignEnvironmentAccentColors(MACHINE_IDS);
    const reversed = assignEnvironmentAccentColors(MACHINE_IDS.toReversed());
    for (const id of MACHINE_IDS) {
      expect(reversed.get(id)).toBe(forward.get(id));
    }
  });

  it("handles an empty sidebar", () => {
    expect(assignEnvironmentAccentColors([]).size).toBe(0);
  });
});

describe("mixHexColors", () => {
  it("returns the endpoints at the extremes", () => {
    expect(mixHexColors("#8b5cf6", "#ffffff", 0)).toBe("#8b5cf6");
    expect(mixHexColors("#8b5cf6", "#ffffff", 1)).toBe("#ffffff");
  });

  it("blends halfway", () => {
    expect(mixHexColors("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("expands shorthand hex", () => {
    expect(mixHexColors("#000", "#fff", 0.5)).toBe("#808080");
  });

  it("clamps out-of-range weights", () => {
    expect(mixHexColors("#000000", "#ffffff", -2)).toBe("#000000");
    expect(mixHexColors("#000000", "#ffffff", 5)).toBe("#ffffff");
  });

  it("falls back to the base color when either input is not hex", () => {
    // Mobile passes a theme variable, which is hex today but not guaranteed to be.
    expect(mixHexColors("#8b5cf6", "oklch(0.5 0.2 264)", 0.25)).toBe("#8b5cf6");
    expect(mixHexColors("rgb(1,2,3)", "#ffffff", 0.25)).toBe("rgb(1,2,3)");
  });
});

describe("environmentAccentTextColor", () => {
  it("pulls the accent toward the theme foreground in both directions", () => {
    const accent = "#8b5cf6";
    const onDark = environmentAccentTextColor(accent, "#f5f5f5");
    const onLight = environmentAccentTextColor(accent, "#262626");

    expect(onDark).not.toBe(onLight);
    // Readability is the point: lighter than the accent on dark, darker on light.
    const redChannel = (hex: string) => Number.parseInt(hex.slice(1, 3), 16);
    expect(redChannel(onDark)).toBeGreaterThan(redChannel(accent));
    expect(redChannel(onLight)).toBeLessThan(redChannel(accent));
  });
});

describe("environmentAccentStopOffset", () => {
  it("keeps a single-machine row on the original treatment", () => {
    expect(environmentAccentStopOffset(0, 1)).toBe(0);
  });

  it("spreads a two-machine row across the blend span", () => {
    expect(environmentAccentStopOffset(0, 2)).toBe(0);
    expect(environmentAccentStopOffset(1, 2)).toBe(55);
  });

  it("spaces three machines evenly", () => {
    expect(environmentAccentStopOffset(0, 3)).toBe(0);
    expect(environmentAccentStopOffset(1, 3)).toBeCloseTo(27.5);
    expect(environmentAccentStopOffset(2, 3)).toBe(55);
  });

  it("never emits a stop past the fade point", () => {
    for (let count = 1; count <= 8; count += 1) {
      for (let index = 0; index < count; index += 1) {
        expect(environmentAccentStopOffset(index, count)).toBeLessThan(85);
      }
    }
  });
});

describe("environmentAccentGradientId", () => {
  it("strips characters that are invalid in an SVG id", () => {
    const id = environmentAccentGradientId("env-1:/Users/noe/Downloads");
    expect(id).toMatch(/^env-accent-[a-z0-9]+$/);
  });

  it("is stable per key and distinct across keys", () => {
    expect(environmentAccentGradientId("a")).toBe(environmentAccentGradientId("a"));
    expect(environmentAccentGradientId("a")).not.toBe(environmentAccentGradientId("b"));
  });
});
