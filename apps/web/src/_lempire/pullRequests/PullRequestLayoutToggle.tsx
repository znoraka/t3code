// [FORK] lempire: flips /pull-requests between the fork's triage list and upstream's own page.
// Both read the same route search, so the open pull request survives the switch.

import { ArrowLeftRightIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import { usePrViewStore } from "./prViewStore";

export function PullRequestLayoutToggle({
  size,
  variant,
}: Required<Pick<ComponentProps<typeof Button>, "size" | "variant">>) {
  const layout = usePrViewStore((state) => state.layout);
  const label = layout === "triage" ? "Switch to the original view" : "Switch to the triage view";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size={size}
            variant={variant}
            aria-label={label}
            onClick={() =>
              usePrViewStore.getState().setLayout(layout === "triage" ? "upstream" : "triage")
            }
          >
            <ArrowLeftRightIcon />
          </Button>
        }
      />
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
