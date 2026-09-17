import { EnvironmentId, ProjectId, type PullRequestListEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildPullRequestFeed, mergeFeedBucket } from "./pullRequestFeed";

const environment = (value: string) => EnvironmentId.make(value);

const entry = (number: number, updatedAt: string, overrides: Partial<PullRequestListEntry> = {}) =>
  ({
    number,
    updatedAt,
    host: "github.com",
    repository: "acme/web",
    projectId: "project-a",
    title: `pull request ${number}`,
    ...overrides,
  }) as unknown as PullRequestListEntry;

const source = (environmentId: string, entries: ReadonlyArray<PullRequestListEntry>) => ({
  environmentId: environment(environmentId),
  entries,
});

describe("mergeFeedBucket", () => {
  it("stamps each row with the environment that answered for it", () => {
    const merged = mergeFeedBucket([
      source("env-a", [entry(1, "2026-09-01T00:00:00Z")]),
      source("env-b", [entry(2, "2026-09-02T00:00:00Z", { repository: "acme/api" })]),
    ]);
    expect(merged.map((row) => [row.number, String(row.environmentId)])).toEqual([
      [1, "env-a"],
      [2, "env-b"],
    ]);
  });

  it("keeps one row when a repository is checked out as two projects", () => {
    const merged = mergeFeedBucket([
      source("env-a", [
        entry(7, "2026-09-01T00:00:00Z", { projectId: ProjectId.make("project-a") }),
        entry(7, "2026-09-01T00:00:00Z", { projectId: ProjectId.make("project-b") }),
      ]),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.projectId).toBe("project-a");
  });

  it("keeps one row when two environments answer for the same pull request", () => {
    const merged = mergeFeedBucket([
      source("env-a", [entry(7, "2026-09-01T00:00:00Z")]),
      source("env-b", [entry(7, "2026-09-01T00:00:00Z")]),
    ]);
    expect(merged).toHaveLength(1);
    expect(String(merged[0]?.environmentId)).toBe("env-a");
  });

  it("tells apart the same number in different repositories and hosts", () => {
    const merged = mergeFeedBucket([
      source("env-a", [
        entry(7, "2026-09-01T00:00:00Z"),
        entry(7, "2026-09-01T00:00:00Z", { repository: "acme/api" }),
        entry(7, "2026-09-01T00:00:00Z", { host: "github.acme.dev" }),
      ]),
    ]);
    expect(merged).toHaveLength(3);
  });
});

describe("buildPullRequestFeed", () => {
  const feed = (settledExpanded = false) =>
    buildPullRequestFeed({
      reviewRequested: [source("env-a", [entry(1, "2026-09-05T00:00:00Z")])],
      involved: [source("env-a", [entry(2, "2026-09-04T00:00:00Z")])],
      mine: [source("env-a", [entry(3, "2026-09-03T00:00:00Z"), entry(4, "2026-09-06T00:00:00Z")])],
      merged: [
        source(
          "env-a",
          Array.from({ length: 7 }, (_, index) =>
            entry(10 + index, `2026-08-0${index + 1}T00:00:00Z`),
          ),
        ),
      ],
      settledExpanded,
    });

  it("opens with the rows that need the reader, headerless", () => {
    const { items } = feed();
    expect(items[0]).toMatchObject({ kind: "row", needsMe: true });
    expect(items[0]).toMatchObject({ entry: { number: 1 } });
  });

  it("labels the other buckets and orders them yours, then waiting, then settled", () => {
    const { items } = feed();
    expect(items.filter((item) => item.kind === "header").map((item) => item.label)).toEqual([
      "Your pull requests",
      "Waiting on others",
      "Settled",
    ]);
  });

  it("marks only the review-requested rows", () => {
    const { items } = feed();
    const needsMe = items.flatMap((item) =>
      item.kind === "row" && item.needsMe ? [item.entry.number] : [],
    );
    expect(needsMe).toEqual([1]);
  });

  it("keeps the settled tail collapsed until asked, then drops the more row", () => {
    const collapsed = feed();
    expect(collapsed.items.filter((item) => item.kind === "settled")).toHaveLength(5);
    expect(collapsed.items.at(-1)).toMatchObject({ kind: "more", hiddenCount: 2 });

    const expanded = feed(true);
    expect(expanded.items.filter((item) => item.kind === "settled")).toHaveLength(7);
    expect(expanded.items.some((item) => item.kind === "more")).toBe(false);
  });

  it("carries first/last flags so a group can round its own corners", () => {
    const { items } = feed();
    const mine = items.flatMap((item) =>
      item.kind === "row" && !item.needsMe ? [[item.isFirst, item.isLast]] : [],
    );
    expect(mine).toEqual([
      [true, false],
      [false, true],
      [true, true],
    ]);
  });

  it("is empty when no environment has anything to show", () => {
    const empty = buildPullRequestFeed({
      reviewRequested: [],
      involved: [],
      mine: [],
      merged: [],
      settledExpanded: false,
    });
    expect(empty.items).toEqual([]);
    expect(empty.isEmpty).toBe(true);
  });
});
