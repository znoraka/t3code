// [FORK] lempire: the "Review with agent" action on upstream's PR detail panel.
//
// Opens a draft thread in the PR's project with the review prompt staged in
// the composer, the same shape as upstream's "Ask a question" handoff. Nothing
// is checked out: the review skill reads the PR through `gh`. The PR link is
// remembered for the draft's thread id and applied once the thread exists.
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, PullRequestDetail } from "@t3tools/contracts";
import { useCallback } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { rememberPendingLink } from "./pendingLinks";
import {
  DEFAULT_REVIEW_VARIANT,
  REVIEW_VARIANT_STORAGE_KEY,
  type ReviewVariant,
  buildReviewPrompt,
  reviewVariantSchema,
} from "@t3tools/client-runtime/_lempire/review-variant";

export function useReviewVariant() {
  return useLocalStorage<ReviewVariant, string>(
    REVIEW_VARIANT_STORAGE_KEY,
    DEFAULT_REVIEW_VARIANT,
    reviewVariantSchema,
  );
}

export function useStartAgentReview(input: {
  environmentId: EnvironmentId;
  detail: Pick<PullRequestDetail, "projectId" | "repository" | "number" | "url"> | null;
}) {
  const newThread = useNewThreadHandler();
  const { environmentId, detail } = input;

  const start = useCallback(
    async (variant: ReviewVariant): Promise<boolean> => {
      if (detail === null) return false;
      const opened = await newThread(scopeProjectRef(environmentId, detail.projectId)).then(
        (result) => result,
        () => null,
      );
      if (opened === null) return false;
      useComposerDraftStore
        .getState()
        .setPrompt(opened.draftId, buildReviewPrompt(detail.number, variant));
      rememberPendingLink(opened.threadId, {
        projectId: detail.projectId,
        repository: detail.repository,
        number: detail.number,
        url: detail.url,
      });
      return true;
    },
    [detail, environmentId, newThread],
  );

  const copyPrompt = useCallback(
    async (variant: ReviewVariant): Promise<boolean> => {
      if (detail === null) return false;
      try {
        await navigator.clipboard.writeText(buildReviewPrompt(detail.number, variant));
        return true;
      } catch {
        return false;
      }
    },
    [detail],
  );

  return { start, copyPrompt };
}
