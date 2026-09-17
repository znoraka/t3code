import type { PullRequestListEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  authorAccentHex,
  buildPullRequestSections,
  relativeTime,
  SETTLED_INITIAL_COUNT,
  sliceSettled,
} from "./pullRequestSections.ts";

const entry = (number: number, updatedAt: string, host = "github.com") =>
  ({ number, updatedAt, host, repository: "acme/web" }) as unknown as PullRequestListEntry;

describe("buildPullRequestSections", () => {
  it("splits review requests, own work, other involvement and merges, newest first", () => {
    const sections = buildPullRequestSections({
      reviewRequested: [entry(1, "2026-09-01T00:00:00Z"), entry(2, "2026-09-03T00:00:00Z")],
      involved: [
        entry(1, "2026-09-01T00:00:00Z"),
        entry(3, "2026-09-02T00:00:00Z"),
        entry(4, "2026-09-04T00:00:00Z"),
      ],
      mine: [entry(5, "2026-09-01T00:00:00Z"), entry(6, "2026-09-05T00:00:00Z")],
      merged: [entry(7, "2026-08-01T00:00:00Z"), entry(8, "2026-08-02T00:00:00Z")],
    });
    expect(sections.needsMe.map((item) => item.number)).toEqual([2, 1]);
    expect(sections.waiting.map((item) => item.number)).toEqual([4, 3]);
    expect(sections.mine.map((item) => item.number)).toEqual([6, 5]);
    expect(sections.settled.map((item) => item.number)).toEqual([8, 7]);
  });

  it("keeps the reader's own work out of the review buckets", () => {
    const sections = buildPullRequestSections({
      reviewRequested: [entry(1, "2026-09-01T00:00:00Z")],
      involved: [entry(1, "2026-09-01T00:00:00Z", "GitHub.com")],
      mine: [entry(1, "2026-09-01T00:00:00Z")],
      merged: [],
    });
    expect(sections.needsMe).toEqual([]);
    expect(sections.waiting).toEqual([]);
    expect(sections.mine).toHaveLength(1);
  });
});

describe("sliceSettled", () => {
  const settled = Array.from({ length: SETTLED_INITIAL_COUNT + 3 }, (_, index) =>
    entry(index + 1, "2026-09-01T00:00:00Z"),
  );

  it("collapses to the first few and counts the rest", () => {
    const { visible, hiddenCount } = sliceSettled(settled, false);
    expect(visible).toHaveLength(SETTLED_INITIAL_COUNT);
    expect(hiddenCount).toBe(3);
  });

  it("shows everything once expanded", () => {
    expect(sliceSettled(settled, true).hiddenCount).toBe(0);
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-09-14T12:00:00Z");

  it("reads as the sidebar's terse ages", () => {
    expect(relativeTime("2026-09-14T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-09-14T11:40:00Z", now)).toBe("20m");
    expect(relativeTime("2026-09-14T09:00:00Z", now)).toBe("3h");
    expect(relativeTime("2026-09-10T12:00:00Z", now)).toBe("4d");
    expect(relativeTime("2026-06-14T12:00:00Z", now)).toBe("3mo");
    expect(relativeTime("2024-09-14T12:00:00Z", now)).toBe("2y");
  });

  it("is empty for nothing or garbage", () => {
    expect(relativeTime("", now)).toBe("");
    expect(relativeTime("nope", now)).toBe("");
  });
});

describe("authorAccentHex", () => {
  it("is a stable hex color per author", () => {
    expect(authorAccentHex("theo")).toMatch(/^#[0-9a-f]{6}$/);
    expect(authorAccentHex("theo")).toBe(authorAccentHex("theo"));
    expect(authorAccentHex("theo")).not.toBe(authorAccentHex("julius"));
  });

  it("stays at the mid lightness the web row uses, so it reads in both themes", () => {
    for (const login of ["theo", "julius", "znoraka", "", "a-very-long-github-handle"]) {
      const [red, green, blue] = [1, 3, 5].map((offset) =>
        Number.parseInt(authorAccentHex(login).slice(offset, offset + 2), 16),
      ) as [number, number, number];
      // hsl lightness 55% puts the channel mid-point at 140 of 255.
      expect((Math.max(red, green, blue) + Math.min(red, green, blue)) / 2).toBeCloseTo(140, -1);
    }
  });
});
