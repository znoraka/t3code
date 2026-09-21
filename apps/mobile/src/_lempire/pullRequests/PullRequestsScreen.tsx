// [FORK] lempire: the pull-request feed, rendered.
//
// Same anatomy as the web triage column — three-line cards bucketed by what
// they need from you, a collapsed tail of what has settled — in the phone's own
// grouped-card idiom. Author colors come from the shared hue so the same person
// reads the same color on both surfaces.
import {
  AUTHOR_ACCENT_FOREGROUND_MIX,
  authorAccentHex,
  relativeTime,
} from "@t3tools/client-runtime/_lempire/pull-request-sections";
import {
  reviewBadgeKey,
  type ReviewRowBadge,
} from "@t3tools/client-runtime/_lempire/review-of-record";
import type { PullRequestListEntry } from "@t3tools/contracts";
import { mixHexColors } from "@t3tools/shared/_lempire/environmentColor";
import { LegendList } from "@legendapp/list/react-native";
import { memo, useCallback, useMemo } from "react";
import { ActivityIndicator, Pressable, RefreshControl, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { EmptyState } from "../../components/EmptyState";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import type { PullRequestFeedEntry, PullRequestFeedItem } from "./pullRequestFeed";

/** Three lines of text plus padding; LegendList only needs the ballpark. */
const ROW_ESTIMATE = 78;

/** The mark on a row waiting for you, the same accent the web list uses. */
const NEEDS_ME_COLOR = "#d98a70";

function ChecksGlyph({ state }: { state: PullRequestListEntry["checksState"] }) {
  if (state === undefined) return null;
  if (state === "failing") {
    return (
      <SymbolView
        accessibilityLabel="Checks failing"
        name="xmark"
        size={11}
        tintColorClassName="accent-adaptive-rose-600-400"
        type="monochrome"
      />
    );
  }
  if (state === "pending") {
    return (
      <SymbolView
        accessibilityLabel="Checks pending"
        name="clock"
        size={11}
        tintColorClassName="accent-adaptive-amber-700-300"
        type="monochrome"
      />
    );
  }
  return (
    <SymbolView
      accessibilityLabel="All checks passing"
      name="checkmark"
      size={11}
      tintColorClassName="accent-adaptive-emerald-600-400"
      type="monochrome"
    />
  );
}

// The verdict, not the finding counts: at row scale the question is whether a
// review exists and whether it was happy. A stale one keeps its colour and loses
// its weight, so "reviewed, then touched" reads weaker without a second glyph.
const REVIEW_BADGE_TINTS = {
  ok: "accent-adaptive-emerald-600-400",
  warn: "accent-adaptive-amber-700-300",
  crit: "accent-adaptive-rose-600-400",
} as const;

function ReviewGlyph({ badge }: { badge: ReviewRowBadge | undefined }) {
  if (badge === undefined) return null;
  const label = badge.state === null ? "Reviewed" : `Reviewed: ${badge.state}`;
  return (
    <View style={badge.stale ? { opacity: 0.5 } : undefined}>
      <SymbolView
        accessibilityLabel={badge.stale ? `${label}, updated since the review` : label}
        name="doc.text"
        size={11}
        tintColorClassName={
          badge.state === null ? "accent-icon-subtle" : REVIEW_BADGE_TINTS[badge.state]
        }
        type="monochrome"
      />
    </View>
  );
}

function groupRadius(isFirst: boolean, isLast: boolean) {
  return {
    borderTopLeftRadius: isFirst ? 18 : 0,
    borderTopRightRadius: isFirst ? 18 : 0,
    borderBottomLeftRadius: isLast ? 18 : 0,
    borderBottomRightRadius: isLast ? 18 : 0,
  };
}

const PullRequestCard = memo(function PullRequestCard(props: {
  readonly entry: PullRequestFeedEntry;
  readonly needsMe: boolean;
  readonly reviewBadge: ReviewRowBadge | undefined;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly onSelect: (entry: PullRequestFeedEntry) => void;
}) {
  const { entry, onSelect } = props;
  const foregroundColor = useUniwindTheme()["--color-foreground"];
  const login = entry.author?.login ?? "";
  const authorColor =
    login.length === 0
      ? undefined
      : mixHexColors(authorAccentHex(login), String(foregroundColor), AUTHOR_ACCENT_FOREGROUND_MIX);
  const handlePress = useCallback(() => onSelect(entry), [entry, onSelect]);

  return (
    <Pressable
      accessibilityLabel={`#${entry.number} ${entry.title}`}
      accessibilityRole="button"
      className={`bg-card px-4 py-3 active:opacity-70 ${props.isLast ? "" : "border-b border-separator"}`}
      onPress={handlePress}
      style={groupRadius(props.isFirst, props.isLast)}
    >
      <View className="flex-row items-center gap-2">
        <Text
          className="min-w-0 flex-1 text-xs font-t3-bold"
          numberOfLines={1}
          style={authorColor ? { color: authorColor } : undefined}
        >
          {login.length > 0 ? login : entry.projectTitle}
        </Text>
        <Text className="text-2xs tabular-nums text-foreground-tertiary">
          {relativeTime(entry.updatedAt)}
        </Text>
      </View>

      {/* The number sits outside the truncation so it survives a long title:
          it is how a pull request is named out loud. */}
      <View className="mt-0.5 flex-row items-baseline gap-1.5">
        <Text className="text-sm tabular-nums text-foreground-tertiary">#{entry.number}</Text>
        <Text className="min-w-0 flex-1 text-sm font-t3-medium leading-snug text-foreground">
          {entry.title}
        </Text>
      </View>

      <View className="mt-1 flex-row items-center gap-2">
        <Text className="min-w-0 flex-1 font-mono text-2xs text-foreground-tertiary">
          {entry.headBranch}
        </Text>
        {entry.isDraft ? <Text className="text-2xs text-foreground-tertiary">Draft</Text> : null}
        <ReviewGlyph badge={props.reviewBadge} />
        <ChecksGlyph state={entry.checksState} />
        {props.needsMe ? (
          <View
            accessibilityLabel="Needs your review"
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: NEEDS_ME_COLOR }}
          />
        ) : entry.reviewDecision === "approved" ? (
          <SymbolView
            accessibilityLabel="Approved"
            name="checkmark.circle"
            size={11}
            tintColorClassName="accent-adaptive-sky-600-400"
            type="monochrome"
          />
        ) : null}
      </View>
    </Pressable>
  );
});

const SettledCard = memo(function SettledCard(props: {
  readonly entry: PullRequestFeedEntry;
  readonly onSelect: (entry: PullRequestFeedEntry) => void;
}) {
  const { entry, onSelect } = props;
  const handlePress = useCallback(() => onSelect(entry), [entry, onSelect]);
  return (
    <Pressable
      accessibilityLabel={`#${entry.number} ${entry.title}, merged`}
      accessibilityRole="button"
      className="flex-row items-center gap-2 px-4 py-2 active:opacity-70"
      onPress={handlePress}
    >
      <SymbolView
        name="point.topleft.down.curvedto.point.bottomright.up"
        size={11}
        tintColorClassName="accent-adaptive-violet-600-400"
        type="monochrome"
      />
      <Text className="min-w-0 flex-1 text-xs text-foreground-muted" numberOfLines={1}>
        #{entry.number} · {entry.title}
      </Text>
      <Text className="text-2xs tabular-nums text-foreground-tertiary">
        {relativeTime(entry.updatedAt)}
      </Text>
    </Pressable>
  );
});

function SectionHeader({ label }: { label: string }) {
  return (
    <View className="flex-row items-center gap-2.5 px-1 pb-1.5 pt-5">
      <Text className="text-2xs font-t3-medium uppercase tracking-[0.5px] text-foreground-tertiary">
        {label}
      </Text>
      <View className="h-px flex-1 bg-separator" />
    </View>
  );
}

function RefreshNotice({ message }: { message: string }) {
  return (
    <View className="mb-2 flex-row items-start gap-2 rounded-[18px] border border-warning-border bg-warning px-3 py-2">
      <SymbolView
        name="exclamationmark.triangle"
        size={12}
        tintColorClassName="accent-warning-foreground"
        type="monochrome"
      />
      <View className="min-w-0 flex-1">
        <Text className="text-xs font-t3-medium leading-snug text-warning-foreground">
          Couldn’t refresh. Showing the last results.
        </Text>
        <Text className="mt-0.5 text-2xs leading-snug text-warning-foreground">{message}</Text>
      </View>
    </View>
  );
}

export function PullRequestsScreen(props: {
  readonly items: ReadonlyArray<PullRequestFeedItem>;
  /** Review badges by `reviewBadgeKey`, for the open rows that have a review. */
  readonly reviewBadges: ReadonlyMap<string, ReviewRowBadge>;
  readonly error: string | null;
  readonly isPending: boolean;
  /** Environments whose server can list pull requests at all. */
  readonly environmentCount: number;
  readonly onExpandSettled: () => void;
  readonly onRefresh: () => void;
  readonly onSelect: (entry: PullRequestFeedEntry) => void;
}) {
  const { onExpandSettled, onSelect, reviewBadges } = props;
  const isInitialLoad = props.isPending && props.items.length === 0 && props.error === null;

  const renderItem = useCallback(
    ({ item }: { item: PullRequestFeedItem }) => {
      switch (item.kind) {
        case "header":
          return <SectionHeader label={item.label} />;
        case "row":
          return (
            <PullRequestCard
              entry={item.entry}
              isFirst={item.isFirst}
              isLast={item.isLast}
              needsMe={item.needsMe}
              onSelect={onSelect}
              reviewBadge={reviewBadges.get(reviewBadgeKey(item.entry))}
            />
          );
        case "settled":
          return <SettledCard entry={item.entry} onSelect={onSelect} />;
        case "more":
          return (
            <Pressable
              accessibilityRole="button"
              className="flex-row items-center gap-2 px-4 py-2 active:opacity-70"
              onPress={onExpandSettled}
            >
              <SymbolView
                name="plus"
                size={11}
                tintColorClassName="accent-icon-subtle"
                type="monochrome"
              />
              <Text className="text-xs text-foreground-tertiary">Show {item.hiddenCount} more</Text>
            </Pressable>
          );
      }
    },
    [onExpandSettled, onSelect, reviewBadges],
  );

  const listEmptyComponent = useMemo(() => {
    if (isInitialLoad) {
      return (
        <View className="items-center py-16">
          <ActivityIndicator colorClassName="accent-icon" />
          <Text className="mt-3 text-sm text-foreground-muted">Loading pull requests...</Text>
        </View>
      );
    }
    if (props.environmentCount === 0) {
      return (
        <EmptyState
          detail="Connect an environment whose server can reach your code host, and its pull requests show up here."
          title="No environment lists pull requests"
        />
      );
    }
    return (
      <EmptyState
        detail="Nothing open, and nothing merged recently, across your environments."
        title="No pull requests"
      />
    );
  }, [isInitialLoad, props.environmentCount]);

  return (
    <View className="flex-1 bg-screen">
      <LegendList
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 16, paddingTop: 4 }}
        contentInsetAdjustmentBehavior="automatic"
        data={props.items}
        estimatedItemSize={ROW_ESTIMATE}
        getItemType={(item) => item.kind}
        keyExtractor={(item) => item.key}
        ListEmptyComponent={listEmptyComponent}
        ListHeaderComponent={props.error ? <RefreshNotice message={props.error} /> : null}
        refreshControl={
          <RefreshControl
            onRefresh={props.onRefresh}
            refreshing={props.isPending && !isInitialLoad}
            tintColorClassName={String("accent-icon")}
          />
        }
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
