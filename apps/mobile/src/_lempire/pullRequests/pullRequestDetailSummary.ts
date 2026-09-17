// [FORK] lempire: what the phone says about a pull request's checks.
//
// The web detail panel has room for a per-check list; the phone shows one line,
// so the rollup has to carry the number that matters — how many are failing, or
// still running, and out of how many.
import type { PullRequestCheck } from "@t3tools/contracts";

export interface ChecksSummary {
  readonly state: "passing" | "failing" | "pending" | "none";
  readonly label: string;
}

export function summarizeChecks(checks: ReadonlyArray<PullRequestCheck>): ChecksSummary {
  if (checks.length === 0) return { state: "none", label: "No checks" };
  const failing = checks.filter(
    (check) => check.status === "failure" || check.status === "action-required",
  ).length;
  if (failing > 0) {
    return { state: "failing", label: `${failing} of ${checks.length} failing` };
  }
  const pending = checks.filter((check) => check.status === "pending").length;
  if (pending > 0) {
    return { state: "pending", label: `${pending} of ${checks.length} running` };
  }
  const passing = checks.filter((check) => check.status === "success").length;
  return passing === checks.length
    ? { state: "passing", label: checks.length === 1 ? "1 check passed" : "All checks passed" }
    : { state: "passing", label: `${passing} of ${checks.length} passing` };
}
