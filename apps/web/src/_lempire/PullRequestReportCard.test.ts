import { describe, expect, it } from "vite-plus/test";

import { isReviewStale, reviewStartedAt } from "./PullRequestReportCard";

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
