// [FORK] lempire: the agent-review prompt and its one preference.
//
// The prompt hands the PR to the `test-and-review` skill, which fetches the PR
// itself through `gh`; nothing else needs to travel in the message.
import { BotIcon, FlaskConicalIcon } from "lucide-react";
import * as Schema from "effect/Schema";

export type ReviewVariant = "review" | "review-with-tests";

export const REVIEW_VARIANTS: ReadonlyArray<{
  value: ReviewVariant;
  label: string;
  description: string;
  Icon: typeof BotIcon;
}> = [
  {
    value: "review-with-tests",
    label: "Review and test",
    description: "Code review plus a /lem-test-pr run, published as one report.",
    Icon: FlaskConicalIcon,
  },
  {
    value: "review",
    label: "Review only",
    description: "Code review without the test step.",
    Icon: BotIcon,
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
