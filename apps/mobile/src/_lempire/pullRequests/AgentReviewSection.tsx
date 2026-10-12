// [FORK] lempire: the agent-review layer on top of upstream's pull-request detail.
//
// The review of record, the action that starts a new one, and the threads that
// reviewed this pull request. Rendered at the top of the overview tab; upstream's
// screen owns everything else (header, diff, conversation, merge).
import {
  resolveReviewLookup,
  reviewBadgeKey,
  type ReviewLookup,
} from "@t3tools/client-runtime/_lempire/review-of-record";
import { recordReviewStaleness } from "@t3tools/client-runtime/_lempire/review-staleness-store";
import { REVIEW_VARIANTS } from "@t3tools/client-runtime/_lempire/review-variant";
import { relativeTime } from "@t3tools/client-runtime/_lempire/pull-request-sections";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { matchesLinkedPullRequestUrl } from "@t3tools/shared/changeRequestUrl";
import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { ControlPillMenu } from "../../components/ControlPill";
import {
  pullRequestTarget,
  type PullRequestParams,
} from "../../features/pull-requests/usePullRequestDiff";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useThreadShells } from "../../state/entities";
import { composerPullRequests } from "../../state/pull-requests";
import { useEnvironmentQuery } from "../../state/query";
import { AgentReviewCard } from "./AgentReviewCard";
import { plandropReports } from "./atoms";
import { useRefreshOnRevisit } from "./useRefreshOnRevisit";
import { useStartAgentReview } from "./useStartAgentReview";

/**
 * A pull request left open while the phone is in a pocket is the normal way to
 * read one, and the review of record is exactly the field that changes while
 * you are away.
 */
const REPORTS_REFRESH_INTERVAL_MS = 60_000;

function threadStatus(thread: EnvironmentThreadShell): {
  readonly label: string;
  readonly className: string;
} {
  if (threadRuntimeIsActive(thread.runtime)) {
    return { label: "Running", className: "text-adaptive-sky-600-400" };
  }
  if (thread.runtime?.status === "failed") {
    return { label: "Error", className: "text-adaptive-rose-600-400" };
  }
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) {
    return { label: "Waiting", className: "text-adaptive-amber-700-300" };
  }
  return { label: "Idle", className: "text-foreground-tertiary" };
}

export function AgentReviewSection({ params }: { readonly params: PullRequestParams }) {
  const navigation = useNavigation();
  const environmentId = EnvironmentId.make(params.environmentId);
  const projectId = ProjectId.make(params.projectId);
  const { repository, number } = params;

  // The same atoms upstream's screen reads, so these share its requests.
  const target = useMemo(() => pullRequestTarget(params), [params]);
  const detail = useEnvironmentQuery(composerPullRequests.detail(target)).data;
  const activity = useEnvironmentQuery(composerPullRequests.activity(target)).data;
  const reportsQuery = useEnvironmentQuery(
    plandropReports({ environmentId, input: { repository, number } }),
  );

  const reviewLookup = useMemo(
    () =>
      resolveReviewLookup({
        result: reportsQuery.data,
        error: reportsQuery.error,
        commits: activity?.commits ?? [],
        // Commits ride on the activity half; claim nothing until it lands.
        activityPending: activity === null,
      }),
    [activity, reportsQuery.data, reportsQuery.error],
  );
  useAnswerRowBadge(reviewLookup, repository, number, detail?.updatedAt ?? null);

  const allThreads = useThreadShells();
  const reviewThreads = useMemo(() => {
    if (detail === null) return [];
    const linkedToThisPullRequest = allThreads.filter((thread) => {
      if (thread.environmentId !== environmentId || thread.archivedAt !== null) return false;
      const linked = thread.linkedPullRequest ?? thread.branchPullRequest;
      return linked != null && matchesLinkedPullRequestUrl(linked, detail.url);
    });
    // Copy-then-sort: Hermes has no `toSorted`.
    return [...linkedToThisPullRequest].sort((left, right) =>
      (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt),
    );
  }, [allThreads, detail, environmentId]);

  const startReview = useStartAgentReview({
    environmentId,
    projectId,
    link: { projectId, repository, number, url: detail?.url ?? "" },
  });

  const refreshReports = reportsQuery.refresh;
  const refreshNow = useRefreshOnRevisit(refreshReports, REPORTS_REFRESH_INTERVAL_MS);

  const reviewActions = useMemo(
    () =>
      REVIEW_VARIANTS.map((variant) => ({
        id: variant.value,
        title: variant.label,
        subtitle: variant.description,
      })),
    [],
  );
  const handleReviewAction = useCallback(
    (event: { readonly nativeEvent: { readonly event: string } }) => {
      const variant = REVIEW_VARIANTS.find(
        (candidate) => candidate.value === event.nativeEvent.event,
      );
      if (variant) startReview(variant.value);
    },
    [startReview],
  );

  if (detail === null) return null;

  return (
    <View className="mb-4">
      {/* Only an answer that actually arrived can say a pull request is
          unreviewed; a lookup that failed says so, and offers to retry. */}
      {reviewLookup.state === "reviewed" ? (
        <AgentReviewCard
          generatedAgo={relativeAge(reviewLookup.review.report.generatedAt)}
          onOpen={(url) => void tryOpenExternalUrl(url, "pull-request")}
          review={reviewLookup.review}
          stalePushedAgo={relativeAge(reviewLookup.review.stalePushedAt)}
        />
      ) : reviewLookup.state === "unavailable" ? (
        <Pressable
          accessibilityLabel="Look for a review of this pull request again"
          accessibilityRole="button"
          className="flex-row items-start gap-1.5 active:opacity-70"
          onPress={refreshNow}
        >
          <SymbolView
            name="exclamationmark.triangle"
            size={11}
            tintColorClassName="accent-adaptive-amber-700-300"
            type="monochrome"
          />
          <Text className="min-w-0 flex-1 text-xs leading-snug text-adaptive-amber-700-300">
            Could not check whether this pull request has been reviewed. Tap to try again.
          </Text>
        </Pressable>
      ) : reviewLookup.state === "unconfigured" ? null : (
        <Text className="text-xs text-foreground-tertiary">
          {reviewLookup.state === "looking"
            ? "Looking for a review of this pull request..."
            : "No agent review has been published for this pull request yet."}
        </Text>
      )}

      <ControlPillMenu
        actions={reviewActions}
        onPressAction={handleReviewAction}
        title="Review with agent"
      >
        <Pressable
          accessibilityLabel="Review with agent"
          accessibilityRole="button"
          className="mt-4 flex-row items-center justify-center gap-2 rounded-[18px] border border-border bg-card py-3 active:opacity-70"
        >
          <SymbolView name="brain" size={13} tintColorClassName="accent-icon" type="monochrome" />
          <Text className="text-sm font-t3-bold text-foreground">Review with agent</Text>
        </Pressable>
      </ControlPillMenu>

      {reviewThreads.length > 0 ? (
        <View className="mt-4 gap-1">
          <View className="flex-row items-center gap-2.5 pb-1">
            <Text className="text-2xs font-t3-medium uppercase tracking-[0.5px] text-foreground-tertiary">
              Review threads
            </Text>
            <View className="h-px flex-1 bg-separator" />
          </View>
          {reviewThreads.map((thread) => {
            const status = threadStatus(thread);
            return (
              <Pressable
                accessibilityRole="button"
                className="flex-row items-center gap-2 rounded-xl px-1 py-2 active:opacity-70"
                key={thread.id}
                onPress={() =>
                  navigation.navigate("Thread", {
                    environmentId: String(thread.environmentId),
                    threadId: String(thread.id),
                  })
                }
              >
                <SymbolView
                  name="text.bubble"
                  size={12}
                  tintColorClassName="accent-icon-subtle"
                  type="monochrome"
                />
                <Text
                  className="min-w-0 flex-1 text-xs font-t3-medium text-foreground"
                  numberOfLines={1}
                >
                  {thread.title}
                </Text>
                <Text className={`text-2xs font-t3-medium ${status.className}`}>
                  {status.label}
                </Text>
                <Text className="text-2xs tabular-nums text-foreground-tertiary">
                  {relativeTime(thread.updatedAt ?? thread.createdAt)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** "2h ago" rather than the list's terse "2h": this line is read as a sentence. */
function relativeAge(value: string | null | undefined): string | null {
  if (!value) return null;
  const age = relativeTime(value);
  if (age.length === 0) return null;
  return age === "just now" ? age : `${age} ago`;
}

/**
 * Hands the feed the answer this screen just worked out. A row only has
 * `updatedAt` to go on and has to read the review's own comment as possible new
 * code; this screen has the commits and knows, so what it knows goes back to the
 * row that was guessing.
 */
function useAnswerRowBadge(
  lookup: ReviewLookup,
  repository: string,
  number: number,
  updatedAt: string | null,
): void {
  useEffect(() => {
    if (updatedAt === null || lookup.state !== "reviewed" || !lookup.review.exact) return;
    recordReviewStaleness(reviewBadgeKey({ repository, number }), {
      reportUrl: lookup.review.report.url,
      updatedAt,
      stale: lookup.review.stalePushedAt !== null,
    });
  }, [lookup, repository, number, updatedAt]);
}
