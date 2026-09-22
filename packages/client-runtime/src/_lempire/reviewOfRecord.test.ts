import type { PlandropReport } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyKnownReviewStaleness,
  buildRowReviewBadges,
  isReviewStale,
  resolveReviewLookup,
  resolveReviewOfRecord,
  reviewBadgeKey,
  reviewStartedAt,
} from "./reviewOfRecord.ts";

const at = (iso: string) => Date.parse(iso);

describe("reviewStartedAt", () => {
  const posted = "2026-07-30T12:00:00Z";

  it("uses the kickoff prompt when it is far enough back", () => {
    expect(reviewStartedAt(posted, "2026-07-30T11:20:00Z")).toBe(at("2026-07-30T11:20:00Z"));
  });

  it("falls back to the 15-minute floor with no kickoff message", () => {
    expect(reviewStartedAt(posted, null)).toBe(at("2026-07-30T11:45:00Z"));
  });

  it("ignores a kickoff too recent to be the real start of a 15-minute review", () => {
    expect(reviewStartedAt(posted, "2026-07-30T11:57:00Z")).toBe(at("2026-07-30T11:45:00Z"));
  });

  it("is NaN when the report timestamp is unparseable", () => {
    expect(reviewStartedAt("not-a-date", null)).toBeNaN();
  });
});

describe("isReviewStale", () => {
  // Report posted at 12:00 after a review that started at 11:40.
  const started = reviewStartedAt("2026-07-30T12:00:00Z", "2026-07-30T11:40:00Z");

  it("is stale when a commit lands after the review started", () => {
    expect(isReviewStale("2026-07-30T11:50:00Z", started)).toBe(true);
  });

  it("is stale for a commit pushed mid-review, before the report was published", () => {
    expect(isReviewStale("2026-07-30T11:59:00Z", started)).toBe(true);
  });

  it("is fresh when the newest commit predates the review", () => {
    expect(isReviewStale("2026-07-30T11:30:00Z", started)).toBe(false);
  });

  it("treats a sub-minute gap as clock skew, not a push", () => {
    expect(isReviewStale("2026-07-30T11:40:30Z", started)).toBe(false);
  });

  it("is fresh when the commit date is missing or unparseable", () => {
    expect(isReviewStale(null, started)).toBe(false);
    expect(isReviewStale("", started)).toBe(false);
    expect(isReviewStale("not-a-date", started)).toBe(false);
    expect(isReviewStale("2026-07-30T11:50:00Z", Number.NaN)).toBe(false);
  });
});

describe("resolveReviewOfRecord", () => {
  const report = (fields: Partial<PlandropReport> = {}): PlandropReport =>
    ({
      url: "https://plans.gawaak.ovh/p/1/2/",
      sources: [],
      generatedAt: "2026-07-30T12:00:00Z",
      ...fields,
    }) as PlandropReport;

  const commit = (oid: string, committedDate: string) => ({ oid, committedDate });

  it("has nothing to say without a report", () => {
    expect(
      resolveReviewOfRecord({
        report: null,
        commits: [commit("a", "2026-07-30T13:00:00Z")],
        activityPending: false,
      }),
    ).toBe(null);
  });

  it("is fresh when the report's sha is still the head commit", () => {
    const subject = report({ headSha: "beef" });
    expect(
      resolveReviewOfRecord({
        report: subject,
        commits: [commit("old", "2026-07-30T10:00:00Z"), commit("beef", "2026-07-30T11:00:00Z")],
        activityPending: false,
      }),
    ).toEqual({ report: subject, stalePushedAt: null, exact: true });
  });

  it("names the push that outdated a review whose sha is no longer the head", () => {
    const subject = report({ headSha: "beef" });
    expect(
      resolveReviewOfRecord({
        report: subject,
        commits: [commit("beef", "2026-07-30T11:00:00Z"), commit("cafe", "2026-07-30T13:00:00Z")],
        activityPending: false,
      }),
    ).toEqual({ report: subject, stalePushedAt: "2026-07-30T13:00:00Z", exact: true });
  });

  it("falls back to the timestamp estimate for a report with no sha", () => {
    const subject = report();
    // 13:00 is well past the review's 11:45 start floor.
    expect(
      resolveReviewOfRecord({
        report: subject,
        commits: [commit("cafe", "2026-07-30T13:00:00Z")],
        activityPending: false,
      }),
    ).toEqual({ report: subject, stalePushedAt: "2026-07-30T13:00:00Z", exact: true });
    // 11:00 predates it, so the review still covers the branch.
    expect(
      resolveReviewOfRecord({
        report: subject,
        commits: [commit("cafe", "2026-07-30T11:00:00Z")],
        activityPending: false,
      }),
    ).toEqual({ report: subject, stalePushedAt: null, exact: true });
  });

  it("claims nothing about staleness while the commits are still loading", () => {
    const subject = report({ headSha: "beef" });
    expect(
      resolveReviewOfRecord({
        report: subject,
        commits: [commit("cafe", "2026-07-30T13:00:00Z")],
        activityPending: true,
      }),
    ).toEqual({ report: subject, stalePushedAt: null, exact: false });
  });

  it("claims nothing about staleness when the host carries no commits", () => {
    const subject = report({ headSha: "beef" });
    expect(resolveReviewOfRecord({ report: subject, commits: [], activityPending: false })).toEqual(
      {
        report: subject,
        stalePushedAt: null,
        exact: false,
      },
    );
  });
});

describe("resolveReviewLookup", () => {
  const report = (fields: Partial<PlandropReport> = {}): PlandropReport =>
    ({
      url: "https://plans.gawaak.ovh/p/1/2/",
      sources: [],
      generatedAt: "2026-07-30T12:00:00Z",
      ...fields,
    }) as PlandropReport;

  const lookup = (input: {
    result?: { configured: boolean; reports: ReadonlyArray<PlandropReport> } | null;
    error?: string | null;
  }) =>
    resolveReviewLookup({
      result: input.result ?? null,
      error: input.error ?? null,
      commits: [],
      activityPending: false,
    });

  it("is still looking before the environment has answered", () => {
    expect(lookup({})).toEqual({ state: "looking" });
  });

  it("does not call a pull request unreviewed when the lookup failed", () => {
    expect(lookup({ error: "Environment env-1 is offline." })).toEqual({
      state: "unavailable",
      reason: "Environment env-1 is offline.",
    });
  });

  it("calls it unreviewed only on an answer with no reports", () => {
    expect(lookup({ result: { configured: true, reports: [] } })).toEqual({ state: "unreviewed" });
  });

  it("stays quiet on a host with no plandrop credential", () => {
    expect(lookup({ result: { configured: false, reports: [] } })).toEqual({
      state: "unconfigured",
    });
  });

  it("carries the newest report as the review of record", () => {
    const newest = report({ generatedAt: "2026-07-30T14:00:00Z" });
    expect(lookup({ result: { configured: true, reports: [newest, report()] } })).toEqual({
      state: "reviewed",
      review: { report: newest, stalePushedAt: null, exact: false },
    });
  });

  it("keeps showing a report it already has when a refresh fails", () => {
    const subject = report();
    expect(
      lookup({ result: { configured: true, reports: [subject] }, error: "Connection lost." }),
    ).toEqual({
      state: "reviewed",
      review: { report: subject, stalePushedAt: null, exact: false },
    });
  });
});

describe("buildRowReviewBadges", () => {
  const found = (number: number, overrides: Partial<PlandropReport> = {}) => ({
    repository: "L3mpire/Lempire",
    number,
    report: {
      url: `https://plans.test/report-${number}/`,
      sources: [],
      generatedAt: "2026-07-30T12:00:00Z",
      verdict: { state: "warn" as const, label: "Mergeable with reserves" },
      ...overrides,
    },
  });
  const row = (number: number, updatedAt: string) => ({
    repository: "l3mpire/lempire",
    number,
    updatedAt,
  });

  it("badges a row with its verdict, and calls it stale when the row moved after the review", () => {
    const badges = buildRowReviewBadges({ configured: true, entries: [found(1), found(2)] }, [
      row(1, "2026-07-30T11:00:00Z"),
      row(2, "2026-07-30T11:50:00Z"),
    ]);
    expect(badges.get(reviewBadgeKey(row(1, "")))).toMatchObject({ state: "warn", stale: false });
    expect(badges.get(reviewBadgeKey(row(2, "")))).toMatchObject({ state: "warn", stale: true });
  });

  it("says nothing about a row the lookup did not answer for, or a verdict it cannot read", () => {
    const badges = buildRowReviewBadges(
      { configured: true, entries: [found(1, { verdict: undefined })] },
      [row(1, "2026-07-30T11:00:00Z"), row(9, "2026-07-30T11:00:00Z")],
    );
    expect(badges.get(reviewBadgeKey(row(1, "")))?.state).toBe(null);
    expect(badges.has(reviewBadgeKey(row(9, "")))).toBe(false);
  });

  it("has nothing to show before the lookup answers", () => {
    expect(buildRowReviewBadges(null, [row(1, "2026-07-30T11:00:00Z")]).size).toBe(0);
  });
});

describe("applyKnownReviewStaleness", () => {
  const report: PlandropReport = {
    url: "https://plans.test/report-1/",
    sources: [],
    generatedAt: "2026-07-30T12:00:00Z",
    verdict: { state: "warn", label: "Mergeable with reserves" },
  } as PlandropReport;
  const key = "l3mpire/lempire#1";
  /** The row the bug produces: a comment after the review, read as a possible push. */
  const guessedStale = new Map([
    [key, { state: "warn" as const, stale: true, report, updatedAt: "2026-07-30T13:00:00Z" }],
  ]);
  const answer = (overrides: Record<string, unknown> = {}) =>
    new Map([
      [
        key,
        {
          reportUrl: report.url,
          updatedAt: "2026-07-30T13:00:00Z",
          stale: false,
          ...overrides,
        },
      ],
    ]);

  it("clears a guessed stale badge once the card has answered for that row", () => {
    expect(applyKnownReviewStaleness(guessedStale, answer()).get(key)).toMatchObject({
      state: "warn",
      stale: false,
    });
  });

  it("keeps the badge it was given when the answer agrees with it", () => {
    expect(applyKnownReviewStaleness(guessedStale, answer({ stale: true }))).toBe(guessedStale);
  });

  it("falls back to the estimate once the row moved past what the card read", () => {
    const moved = new Map([
      [key, { state: "warn" as const, stale: true, report, updatedAt: "2026-07-30T14:00:00Z" }],
    ]);
    expect(applyKnownReviewStaleness(moved, answer())).toBe(moved);
  });

  it("still answers for a row the list has not caught up with yet", () => {
    const behind = new Map([
      [key, { state: "warn" as const, stale: true, report, updatedAt: "2026-07-30T12:30:00Z" }],
    ]);
    expect(applyKnownReviewStaleness(behind, answer()).get(key)?.stale).toBe(false);
  });

  it("says nothing about a row whose review of record has since changed", () => {
    expect(
      applyKnownReviewStaleness(
        guessedStale,
        answer({ reportUrl: "https://plans.test/report-2/" }),
      ),
    ).toBe(guessedStale);
  });

  it("leaves the map alone when nothing is known", () => {
    expect(applyKnownReviewStaleness(guessedStale, new Map())).toBe(guessedStale);
  });
});
