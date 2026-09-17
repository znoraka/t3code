// [FORK] lempire: the "Review with agent" action on the phone.
//
// Same handoff as web: open a draft in the pull request's project with the
// review prompt staged, and nothing checked out — the review skill reads the PR
// through `gh`. Expressed in the phone's own draft machinery: a new-task draft
// is created, filled, and opened by id, which the new-task sheet already
// supports.
import {
  buildReviewPrompt,
  type ReviewVariant,
} from "@t3tools/client-runtime/_lempire/review-variant";
import { useNavigation } from "@react-navigation/native";
import type { EnvironmentId, ProjectId, ThreadLinkedPullRequest } from "@t3tools/contracts";
import { useCallback } from "react";

import { createNewTaskDraft, setComposerDraftText } from "../../state/use-composer-drafts";
import { rememberPendingReviewLink } from "./pendingReviewLinks";

export function useStartAgentReview(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly link: ThreadLinkedPullRequest;
}) {
  const navigation = useNavigation();
  const { environmentId, projectId, link } = input;

  return useCallback(
    (variant: ReviewVariant) => {
      const draftKey = createNewTaskDraft({ environmentId, projectId });
      setComposerDraftText(draftKey, buildReviewPrompt(link.number, variant));
      // Claimed with the thread id when this draft is sent, then written onto
      // the thread, so the review shows up under the pull request it read. A
      // link needs the host's URL to match against, which only the loaded
      // detail carries — without it the review still runs, unlinked.
      if (link.url.length > 0) rememberPendingReviewLink(draftKey, link);
      navigation.navigate("NewTaskSheet", {
        screen: "NewTaskDraft",
        params: {
          draftId: draftKey,
          environmentId: String(environmentId),
          projectId: String(projectId),
        },
      });
    },
    [environmentId, link, navigation, projectId],
  );
}
