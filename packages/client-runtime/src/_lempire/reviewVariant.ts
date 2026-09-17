// [FORK] lempire: the agent-review prompt and its one preference.
//
// The prompt hands the PR to the `test-and-review` skill, which fetches the PR
// itself through `gh`; nothing else needs to travel in the message.
import * as Schema from "effect/Schema";

export type ReviewVariant = "review" | "review-with-tests";

// `label` names the choice (a segmented control on web, an action sheet on the
// phone); `description` is the subtitle shown while that choice is selected.
export const REVIEW_VARIANTS: ReadonlyArray<{
  value: ReviewVariant;
  label: string;
  description: string;
}> = [
  {
    value: "review-with-tests",
    label: "With tests",
    description: "Code review plus a test run, published as one report.",
  },
  {
    value: "review",
    label: "Review only",
    description: "Code review without the test step.",
  },
];

export const DEFAULT_REVIEW_VARIANT: ReviewVariant = "review-with-tests";

export const REVIEW_VARIANT_STORAGE_KEY = "t3code:pr-review-variant";

export const reviewVariantSchema: Schema.Codec<ReviewVariant> = Schema.Literals([
  "review",
  "review-with-tests",
]);

export function buildReviewPrompt(prNumber: number, variant: ReviewVariant): string {
  const prompt = `$test-and-review ${prNumber}`;
  return variant === "review-with-tests" ? prompt : `${prompt} --review-only`;
}
