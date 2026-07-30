// [FORK] Shared definition of the agent-review variant preference so the
// overview verdict banner and the review sidebar stay on the same setting.
import { BotIcon, FlaskConicalIcon } from "lucide-react";
import * as Schema from "effect/Schema";

import type { PullRequestReviewPromptVariant } from "./PullRequestReviewView";

export const REVIEW_VARIANTS: {
  value: PullRequestReviewPromptVariant;
  faceLabel: string;
  menuLabel: string;
  Icon: typeof BotIcon;
}[] = [
  { value: "review", faceLabel: "Review", menuLabel: "Review", Icon: BotIcon },
  {
    value: "review-with-tests",
    faceLabel: "Review + /lem-test-pr",
    menuLabel: "Review with /lem-test-pr",
    Icon: FlaskConicalIcon,
  },
];

export const REVIEW_VARIANT_STORAGE_KEY = "t3code:pr-review-variant";

export const reviewVariantSchema: Schema.Codec<PullRequestReviewPromptVariant> = Schema.Literals([
  "review",
  "review-with-tests",
]);
