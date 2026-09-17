import type { PlandropReport } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isReviewStale, resolveReviewOfRecord, reviewStartedAt } from "./reviewOfRecord.ts";

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
    ).toEqual({ report: subject, stalePushedAt: null });
  });

  it("names the push that outdated a review whose sha is no longer the head", () => {
    const subject = report({ headSha: "beef" });
    expect(
      resolveReviewOfRecord({
        report: subject,
        commits: [commit("beef", "2026-07-30T11:00:00Z"), commit("cafe", "2026-07-30T13:00:00Z")],
        activityPending: false,
      }),
    ).toEqual({ report: subject, stalePushedAt: "2026-07-30T13:00:00Z" });
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
    ).toEqual({ report: subject, stalePushedAt: "2026-07-30T13:00:00Z" });
    // 11:00 predates it, so the review still covers the branch.
    expect(
      resolveReviewOfRecord({
        report: subject,
        commits: [commit("cafe", "2026-07-30T11:00:00Z")],
        activityPending: false,
      }),
    ).toEqual({ report: subject, stalePushedAt: null });
  });

  it("claims nothing about staleness while the commits are still loading", () => {
    const subject = report({ headSha: "beef" });
    expect(
      resolveReviewOfRecord({
        report: subject,
        commits: [commit("cafe", "2026-07-30T13:00:00Z")],
        activityPending: true,
      }),
    ).toEqual({ report: subject, stalePushedAt: null });
  });

  it("claims nothing about staleness when the host carries no commits", () => {
    const subject = report({ headSha: "beef" });
    expect(resolveReviewOfRecord({ report: subject, commits: [], activityPending: false })).toEqual(
      {
        report: subject,
        stalePushedAt: null,
      },
    );
  });
});
