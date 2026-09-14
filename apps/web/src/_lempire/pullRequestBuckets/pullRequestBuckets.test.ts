import type { PullRequestListEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { PullRequestGroup } from "~/components/pullRequest/pullRequestList.logic";

import {
  bucketPullRequestGroups,
  bucketedListEntry,
  pullRequestSelectionKey,
  SETTLED_INITIAL_COUNT,
  sliceSettledPullRequests,
} from "./pullRequestBuckets";

const entry = (number: number, updatedAt: string) =>
  ({ number, updatedAt }) as unknown as PullRequestListEntry;

const group = (
  key: PullRequestGroup["key"],
  label: string,
  ...entries: PullRequestListEntry[]
): PullRequestGroup => ({ key, label, entries });

describe("bucketPullRequestGroups", () => {
  it("puts review requests first without a heading, then mine, then the rest", () => {
    const grouped = bucketPullRequestGroups(
      [
        group("authored", "Authored", entry(1, "2026-09-01T00:00:00Z")),
        group("others", "Others", entry(2, "2026-09-01T00:00:00Z")),
        group("reviewRequested", "Review requested", entry(3, "2026-09-01T00:00:00Z")),
      ],
      true,
    );
    expect(grouped.map((item) => [item.key, item.label])).toEqual([
      ["reviewRequested", ""],
      ["authored", "Your pull requests"],
      ["others", "Waiting on others"],
    ]);
  });

  it("drops buckets that have nothing in them", () => {
    const grouped = bucketPullRequestGroups(
      [group("others", "Others", entry(2, "2026-09-01T00:00:00Z"))],
      true,
    );
    expect(grouped.map((item) => item.key)).toEqual(["others"]);
  });

  it("leaves a flat list alone", () => {
    const flat = [group("others", "", entry(2, "2026-09-01T00:00:00Z"))];
    expect(bucketPullRequestGroups(flat, false)).toBe(flat);
  });
});

describe("sliceSettledPullRequests", () => {
  const settled = Array.from({ length: SETTLED_INITIAL_COUNT + 3 }, (_, index) =>
    entry(index + 1, `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
  );

  it("collapses to the newest few and counts the rest", () => {
    const { visible, hiddenCount } = sliceSettledPullRequests(settled, false);
    expect(visible.map((item) => item.number)).toEqual([8, 7, 6, 5, 4]);
    expect(hiddenCount).toBe(3);
  });

  it("shows everything once expanded", () => {
    const { visible, hiddenCount } = sliceSettledPullRequests(settled, true);
    expect(visible).toHaveLength(settled.length);
    expect(hiddenCount).toBe(0);
  });
});

describe("pullRequestSelectionKey", () => {
  it("matches a selection to its row regardless of host casing", () => {
    const row = pullRequestSelectionKey({
      environmentId: "env-1",
      host: "GitHub.com",
      repository: "l3mpire/lempire",
      number: 12758,
    });
    const selection = pullRequestSelectionKey({
      environmentId: "env-1",
      host: "github.com",
      repository: "l3mpire/lempire",
      number: 12758,
    });
    expect(row).toBe(selection);
  });
});

describe("bucketedListEntry", () => {
  it("forgets a remembered tab, scope and facet filters but keeps the host", () => {
    expect(
      bucketedListEntry({
        involvement: "authored",
        state: "merged",
        environmentId: "env-1" as never,
        projectId: "project-1" as never,
        host: "github.com",
        author: "znoraka",
        sort: "newest",
      }),
    ).toEqual({ involvement: "all", state: "open", host: "github.com" });
  });

  it("opens on the bucketed default with nothing remembered", () => {
    expect(bucketedListEntry({ involvement: "all", state: "open" })).toEqual({
      involvement: "all",
      state: "open",
    });
  });
});
