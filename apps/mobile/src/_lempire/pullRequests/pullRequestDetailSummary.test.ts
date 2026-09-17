import type { PullRequestCheck } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { summarizeChecks } from "./pullRequestDetailSummary";

const check = (status: PullRequestCheck["status"]) =>
  ({ name: status, status, description: null, url: null }) as PullRequestCheck;

describe("summarizeChecks", () => {
  it("says nothing was reported when the host reported nothing", () => {
    expect(summarizeChecks([])).toEqual({ state: "none", label: "No checks" });
  });

  it("leads with failures, counted against the whole run", () => {
    expect(summarizeChecks([check("failure"), check("success"), check("pending")])).toEqual({
      state: "failing",
      label: "1 of 3 failing",
    });
  });

  it("counts a check awaiting a maintainer as failing, not passing", () => {
    expect(summarizeChecks([check("action-required"), check("success")])).toEqual({
      state: "failing",
      label: "1 of 2 failing",
    });
  });

  it("reports what is still running when nothing has failed", () => {
    expect(summarizeChecks([check("pending"), check("pending"), check("success")])).toEqual({
      state: "pending",
      label: "2 of 3 running",
    });
  });

  it("says all passed only when every check succeeded", () => {
    expect(summarizeChecks([check("success"), check("success")])).toEqual({
      state: "passing",
      label: "All checks passed",
    });
    expect(summarizeChecks([check("success")])).toEqual({
      state: "passing",
      label: "1 check passed",
    });
    // Skipped and neutral runs are neither failures nor passes.
    expect(summarizeChecks([check("success"), check("skipped"), check("neutral")])).toEqual({
      state: "passing",
      label: "1 of 3 passing",
    });
  });
});
