import { describe, expect, it } from "vite-plus/test";

import { isReviewStale } from "./PullRequestReportCard";

describe("isReviewStale", () => {
  const reviewedAt = "2026-07-30T12:00:00Z";

  it("is stale when a commit lands after the review", () => {
    expect(isReviewStale("2026-07-30T12:30:00Z", reviewedAt)).toBe(true);
  });

  it("is fresh when the newest commit predates the review", () => {
    expect(isReviewStale("2026-07-30T11:30:00Z", reviewedAt)).toBe(false);
  });

  it("treats a sub-minute gap as clock skew, not a push", () => {
    expect(isReviewStale("2026-07-30T12:00:30Z", reviewedAt)).toBe(false);
  });

  it("is fresh when the commit date is missing or unparseable", () => {
    expect(isReviewStale(null, reviewedAt)).toBe(false);
    expect(isReviewStale("", reviewedAt)).toBe(false);
    expect(isReviewStale("not-a-date", reviewedAt)).toBe(false);
    expect(isReviewStale("2026-07-30T12:30:00Z", "not-a-date")).toBe(false);
  });
});
