import { describe, expect, it } from "vite-plus/test";

import { extractReports, isReviewStale, reviewStartedAt } from "./AgentReviewCard";

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

describe("extractReports", () => {
  const message = (text: string, role: string, createdAt: string) => ({ text, role, createdAt });
  const plan = "https://plans.gawaak.ovh/p/aaa/plan1";
  const report = "https://plans.gawaak.ovh/p/aaa/report1";

  it("returns every plandrop URL in the thread, newest first", () => {
    const found = extractReports([
      message("review this", "user", "2026-07-30T10:00:00Z"),
      message(`report: ${report}`, "assistant", "2026-07-30T11:00:00Z"),
      message("now plan the fix", "user", "2026-07-30T12:00:00Z"),
      message(`plan: ${plan}/`, "assistant", "2026-07-30T13:00:00Z"),
    ]);
    expect(found.map((entry) => entry.url)).toEqual([plan, report]);
  });

  it("keeps each URL's own timestamps so a losing candidate cannot skew staleness", () => {
    const found = extractReports([
      message("review this", "user", "2026-07-30T10:00:00Z"),
      message(`report: ${report}`, "assistant", "2026-07-30T11:00:00Z"),
      message("now plan the fix", "user", "2026-07-30T12:00:00Z"),
      message(`plan: ${plan}`, "assistant", "2026-07-30T13:00:00Z"),
    ]);
    expect(found[1]).toEqual({
      url: report,
      postedAt: "2026-07-30T11:00:00Z",
      kickoffAt: "2026-07-30T10:00:00Z",
    });
  });

  it("orders the trailing URL of a message first", () => {
    const found = extractReports([
      message(`draft ${plan} final ${report}`, "assistant", "2026-07-30T11:00:00Z"),
    ]);
    expect(found.map((entry) => entry.url)).toEqual([report, plan]);
  });

  it("finds nothing in a thread without a plandrop URL", () => {
    expect(extractReports([message("no link here", "assistant", "2026-07-30T11:00:00Z")])).toEqual(
      [],
    );
  });
});
