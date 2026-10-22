// [FORK] lempire: the "Review with agent" rows in upstream's PR actions menu.
import {
  REVIEW_VARIANTS,
  type ReviewVariant,
} from "@t3tools/client-runtime/_lempire/review-variant";
import { BotIcon, ClipboardCopyIcon } from "lucide-react";

import { MenuItem } from "../../components/ui/menu";
import { toastManager } from "../../components/ui/toast";
import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";

export function AgentReviewMenuItems(props: {
  opening: boolean;
  disabled: boolean;
  reviewVariant: ReviewVariant;
  onReviewVariantChange: (variant: ReviewVariant) => void;
  onStart: () => void;
  copyPrompt: (variant: ReviewVariant) => Promise<boolean>;
}) {
  const { reviewVariant, onReviewVariantChange } = props;
  const activeReviewVariant =
    REVIEW_VARIANTS.find((variant) => variant.value === reviewVariant) ?? REVIEW_VARIANTS[0]!;
  return (
    <>
      {/* The mode pill lives inside the action row. Clicks on it stop before the
          item's handler so the menu stays open and nothing starts; Left/Right on
          the focused row switch mode for keyboards. */}
      <MenuItem
        disabled={props.disabled}
        onClick={props.onStart}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const index = REVIEW_VARIANTS.findIndex((v) => v.value === reviewVariant);
          const step = event.key === "ArrowRight" ? 1 : -1;
          const next =
            REVIEW_VARIANTS[(index + step + REVIEW_VARIANTS.length) % REVIEW_VARIANTS.length];
          if (next) onReviewVariantChange(next.value);
        }}
      >
        <BotIcon className="mt-0.5 size-3.5 shrink-0 self-start" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span>{props.opening ? "Opening..." : "Review with agent"}</span>
          <span className="text-xs text-muted-foreground">{activeReviewVariant.description}</span>
        </span>
        <ToggleGroup
          size="segmented"
          variant="segmented"
          value={[reviewVariant]}
          onValueChange={(next) => {
            const chosen = REVIEW_VARIANTS.find((v) => v.value === next[0]);
            if (chosen) onReviewVariantChange(chosen.value);
          }}
          onClick={(event) => event.stopPropagation()}
          className="shrink-0 self-center"
          aria-label="Review mode"
        >
          {REVIEW_VARIANTS.map((variant) => (
            <Toggle key={variant.value} value={variant.value} tabIndex={-1}>
              {variant.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </MenuItem>
      <MenuItem
        onClick={() => {
          void props.copyPrompt(reviewVariant).then((copied) => {
            if (copied) toastManager.add({ title: "Review prompt copied", type: "success" });
          });
        }}
      >
        <ClipboardCopyIcon className="size-3.5" />
        Copy review prompt
      </MenuItem>
    </>
  );
}
