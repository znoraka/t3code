// [FORK] lempire: the review reports plandrop holds for a pull request.
//
// /test-and-review publishes its verdict as a data-only `meta.json` artifact and
// plandrop indexes it by pull request, so the report for a PR can be found
// without a link to it anywhere in this environment: the review may have run on
// another machine, in an archived thread, or before the thread was linked.
// Looking it up needs the host's plandrop token, which is why it crosses the
// wire as a request rather than a client-side fetch.
import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "../baseSchemas.ts";

/** How mergeable the review found the change: green, amber, red. */
export const PlandropVerdictState = Schema.Literals(["ok", "warn", "crit"]);
export type PlandropVerdictState = typeof PlandropVerdictState.Type;

/** One contributing run's finding counts — a review, a QA pass. */
export const PlandropReportSource = Schema.Struct({
  name: TrimmedNonEmptyString,
  crit: NonNegativeInt,
  warn: NonNegativeInt,
  good: NonNegativeInt,
});
export type PlandropReportSource = typeof PlandropReportSource.Type;

export const PlandropReport = Schema.Struct({
  url: TrimmedNonEmptyString,
  title: Schema.optional(Schema.String),
  verdict: Schema.optional(
    Schema.Struct({
      state: PlandropVerdictState,
      label: Schema.String,
      note: Schema.optional(Schema.String),
    }),
  ),
  sources: Schema.Array(PlandropReportSource),
  /**
   * The head commit the review read. Exact staleness: a report whose sha is no
   * longer the pull request's head describes code that has since moved. Absent
   * on reports published before the uploader recorded it.
   */
  headSha: Schema.optional(TrimmedNonEmptyString),
  /** When the run finished, falling back to when the artifact was published. */
  generatedAt: TrimmedNonEmptyString,
});
export type PlandropReport = typeof PlandropReport.Type;

export const PlandropReportsInput = Schema.Struct({
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
});
export type PlandropReportsInput = typeof PlandropReportsInput.Type;

/**
 * `configured: false` means this host has no plandrop credential, which is not a
 * failure: the card stays quiet instead of showing an error the user cannot act
 * on. Reports are newest first.
 */
export const PlandropReportsResult = Schema.Struct({
  configured: Schema.Boolean,
  reports: Schema.Array(PlandropReport),
});
export type PlandropReportsResult = typeof PlandropReportsResult.Type;

export class PlandropUnavailableError extends Schema.TaggedError<PlandropUnavailableError>()(
  "PlandropUnavailableError",
  {
    reason: Schema.Literals(["unreachable", "rejected", "malformed"]),
    detail: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "rejected":
        return "Plandrop rejected this host's credential. Re-run the plandrop installer to refresh it.";
      case "malformed":
        return "Plandrop answered with a report index this version cannot read.";
      case "unreachable":
        return "Could not reach plandrop to look up reviews for this pull request.";
    }
  }
}
