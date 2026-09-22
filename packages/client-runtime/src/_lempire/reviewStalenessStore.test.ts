import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  recordReviewStaleness,
  resetReviewStaleness,
  reviewStalenessSnapshot,
  subscribeReviewStaleness,
} from "./reviewStalenessStore.ts";

const answer = { reportUrl: "https://plans.test/r/1/", updatedAt: "2026-07-30T13:00:00Z" };

describe("reviewStalenessStore", () => {
  beforeEach(() => {
    resetReviewStaleness();
  });

  it("publishes a new snapshot so a subscriber re-reads", () => {
    let notified = 0;
    const unsubscribe = subscribeReviewStaleness(() => {
      notified += 1;
    });
    const before = reviewStalenessSnapshot();
    recordReviewStaleness("repo#1", { ...answer, stale: false });
    expect(notified).toBe(1);
    expect(reviewStalenessSnapshot()).not.toBe(before);
    expect(reviewStalenessSnapshot().get("repo#1")?.stale).toBe(false);
    unsubscribe();
  });

  it("stays quiet when the same answer is recorded again", () => {
    recordReviewStaleness("repo#1", { ...answer, stale: false });
    let notified = 0;
    const unsubscribe = subscribeReviewStaleness(() => {
      notified += 1;
    });
    const held = reviewStalenessSnapshot();
    recordReviewStaleness("repo#1", { ...answer, stale: false });
    expect(notified).toBe(0);
    expect(reviewStalenessSnapshot()).toBe(held);
    // A later read of the same pull request does replace it.
    recordReviewStaleness("repo#1", { ...answer, updatedAt: "2026-07-30T14:00:00Z", stale: true });
    expect(notified).toBe(1);
    expect(reviewStalenessSnapshot().get("repo#1")?.stale).toBe(true);
    unsubscribe();
  });

  it("forgets the least recently answered rows rather than growing without bound", () => {
    for (let number = 1; number <= 205; number += 1) {
      recordReviewStaleness(`repo#${number}`, { ...answer, stale: false });
    }
    const snapshot = reviewStalenessSnapshot();
    expect(snapshot.size).toBe(200);
    expect(snapshot.has("repo#5")).toBe(false);
    expect(snapshot.has("repo#6")).toBe(true);
    expect(snapshot.has("repo#205")).toBe(true);
  });
});
