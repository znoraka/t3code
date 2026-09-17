// [FORK] lempire: one pull request on the phone — review it, don't read its code.
//
// Header, the review of record, the action that starts a new one, and the review
// threads. No diff, no conversation, no merge: the phone is for deciding whether
// the agent has looked at this and what it found.
import { resolveReviewOfRecord } from "@t3tools/client-runtime/_lempire/review-of-record";
import { REVIEW_VARIANTS } from "@t3tools/client-runtime/_lempire/review-variant";
import { relativeTime } from "@t3tools/client-runtime/_lempire/pull-request-sections";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { matchesLinkedPullRequestUrl } from "@t3tools/shared/changeRequestUrl";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useCallback, useMemo } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { ControlPillMenu } from "../../components/ControlPill";
import { EmptyState } from "../../components/EmptyState";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useThreadShells } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { AgentReviewCard } from "./AgentReviewCard";
import { plandropReports, pullRequestActivity, pullRequestDetail } from "./atoms";
import { summarizeChecks } from "./pullRequestDetailSummary";
import { useStartAgentReview } from "./useStartAgentReview";

type PullRequestRouteParams = {
  readonly environmentId: string;
  readonly projectId: string;
  readonly repository: string;
  readonly number: string;
  readonly host?: string;
};

const STATE_LABELS = { open: "Open", merged: "Merged", closed: "Closed" } as const;

const CHECKS_TEXT_STYLES = {
  passing: "text-adaptive-emerald-700-300",
  failing: "text-adaptive-rose-700-300",
  pending: "text-adaptive-amber-700-300",
  none: "text-foreground-tertiary",
} as const;

function threadStatus(thread: EnvironmentThreadShell): {
  readonly label: string;
  readonly className: string;
} {
  if (thread.session?.status === "running") {
    return { label: "Running", className: "text-adaptive-sky-600-400" };
  }
  if (thread.session?.status === "error") {
    return { label: "Error", className: "text-adaptive-rose-600-400" };
  }
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) {
    return { label: "Waiting", className: "text-adaptive-amber-700-300" };
  }
  return { label: "Idle", className: "text-foreground-tertiary" };
}

function Pill(props: { readonly label: string; readonly className?: string }) {
  return (
    <View className="rounded-full border border-border bg-subtle px-2 py-0.5">
      <Text
        className={`text-2xs font-t3-medium ${props.className ?? "text-foreground-muted"}`}
        numberOfLines={1}
      >
        {props.label}
      </Text>
    </View>
  );
}

export function PullRequestRouteScreen({ route }: StaticScreenProps<PullRequestRouteParams>) {
  const navigation = useNavigation();
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const projectId = ProjectId.make(route.params.projectId);
  const number = Number(route.params.number);
  const { repository, host } = route.params;

  const reference = useMemo(
    () => ({ projectId, repository, number, ...(host ? { host } : {}) }),
    [host, number, projectId, repository],
  );
  const detailQuery = useEnvironmentQuery(pullRequestDetail({ environmentId, input: reference }));
  const activityQuery = useEnvironmentQuery(
    pullRequestActivity({ environmentId, input: reference }),
  );
  const reportsQuery = useEnvironmentQuery(
    plandropReports({ environmentId, input: { repository, number } }),
  );

  const detail = detailQuery.data;
  const review = useMemo(
    () =>
      resolveReviewOfRecord({
        report: reportsQuery.data?.reports[0] ?? null,
        commits: activityQuery.data?.commits ?? [],
        // Commits ride on the activity half; claim nothing until it lands.
        activityPending: activityQuery.data === null,
      }),
    [activityQuery.data, reportsQuery.data],
  );

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
    link: {
      projectId,
      repository,
      number,
      url: detail?.url ?? "",
    },
  });

  const refresh = useCallback(() => {
    detailQuery.refresh();
    activityQuery.refresh();
    reportsQuery.refresh();
  }, [activityQuery, detailQuery, reportsQuery]);

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

  const checks = detail === null ? null : summarizeChecks(detail.checks);

  return (
    <View className="flex-1 bg-screen">
      <NativeStackScreenOptions options={{ title: `#${number}` }} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 16, paddingTop: 8 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            onRefresh={refresh}
            refreshing={detailQuery.isPending && detail !== null}
            tintColorClassName={String("accent-icon")}
          />
        }
      >
        {detail === null ? (
          detailQuery.error !== null ? (
            <EmptyState
              actionLabel="Try again"
              detail={detailQuery.error}
              onAction={refresh}
              title="Could not load this pull request"
            />
          ) : (
            <View className="items-center py-16">
              <ActivityIndicator colorClassName="accent-icon" />
              <Text className="mt-3 text-sm text-foreground-muted">Loading #{number}...</Text>
            </View>
          )
        ) : (
          <>
            <View className="gap-2">
              <View className="flex-row items-baseline gap-2">
                <Text className="text-base tabular-nums text-foreground-tertiary">#{number}</Text>
                <Text className="min-w-0 flex-1 text-lg font-t3-bold leading-snug text-foreground">
                  {detail.title}
                </Text>
              </View>
              <Text className="text-xs font-t3-medium text-foreground-muted" numberOfLines={1}>
                {detail.author?.login ?? detail.projectTitle}
              </Text>
              <Text className="font-mono text-2xs text-foreground-tertiary" numberOfLines={1}>
                {detail.headBranch} → {detail.baseBranch}
              </Text>
              <View className="flex-row flex-wrap items-center gap-1.5">
                <Pill
                  className={
                    detail.state === "merged"
                      ? "text-adaptive-violet-600-400"
                      : detail.state === "open"
                        ? "text-adaptive-emerald-700-300"
                        : "text-foreground-muted"
                  }
                  label={detail.isDraft ? "Draft" : STATE_LABELS[detail.state]}
                />
                {checks !== null && checks.state !== "none" ? (
                  <Pill className={CHECKS_TEXT_STYLES[checks.state]} label={checks.label} />
                ) : null}
                <Pill label={`+${detail.additions} −${detail.deletions}`} />
                <Pill label={detail.projectTitle} />
              </View>
            </View>

            {review !== null ? (
              <View className="mt-4">
                <AgentReviewCard
                  generatedAgo={relativeAge(review.report.generatedAt)}
                  onOpen={(url) => void tryOpenExternalUrl(url, "pull-request")}
                  review={review}
                  stalePushedAgo={relativeAge(review.stalePushedAt)}
                />
              </View>
            ) : reportsQuery.data?.configured === false ? null : (
              <Text className="mt-4 text-xs text-foreground-tertiary">
                {reportsQuery.isPending
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
                <SymbolView
                  name="brain"
                  size={13}
                  tintColorClassName="accent-icon"
                  type="monochrome"
                />
                <Text className="text-sm font-t3-bold text-foreground">Review with agent</Text>
              </Pressable>
            </ControlPillMenu>
            <Text className="mt-2 text-2xs leading-snug text-foreground-tertiary">
              Opens a draft in {detail.projectTitle} with the review prompt staged. Nothing is
              checked out.
            </Text>

            {reviewThreads.length > 0 ? (
              <View className="mt-5 gap-1">
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

            <Pressable
              accessibilityRole="button"
              className="mt-5 flex-row items-center gap-1.5 px-1 active:opacity-70"
              onPress={() => void tryOpenExternalUrl(detail.url, "pull-request")}
            >
              <Text className="text-xs font-t3-medium text-foreground-muted">
                Open on {hostLabel(detail.url)}
              </Text>
              <SymbolView
                name="arrow.up.right"
                size={10}
                tintColorClassName="accent-icon-subtle"
                type="monochrome"
              />
            </Pressable>
          </>
        )}
      </ScrollView>
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

function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the host";
  }
}
