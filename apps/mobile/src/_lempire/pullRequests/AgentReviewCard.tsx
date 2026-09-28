// [FORK] lempire: the agent-review card, on the phone.
//
// The native twin of the web card: verdict ribbon, crit/warn/good tiles, and a
// stale ribbon when the branch moved past the commit the review read. Both read
// the same report from plandrop's per-pull-request index and share the staleness
// decision (`resolveReviewOfRecord`), so the two surfaces cannot disagree about
// whether a verdict still holds. Reviews other people shared sit in the same
// card, one tab per reviewer with yours selected first.
import {
  reviewCardHeading,
  type ReviewTab,
} from "@t3tools/client-runtime/_lempire/review-of-record";
import type { PlandropReport } from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";

// `warn` is "mergeable with reserves" — amber, not a red alarm. Only `crit`
// (not mergeable) gets the red band and the ✗.
const RIBBON_STYLES = {
  ok: "bg-adaptive-emerald-500-a12-a16",
  warn: "bg-adaptive-amber-500-a12-a16",
  crit: "bg-adaptive-rose-500-a12-a16",
} as const;

const RIBBON_TEXT_STYLES = {
  ok: "text-adaptive-emerald-700-300",
  warn: "text-adaptive-amber-700-300",
  crit: "text-adaptive-rose-700-300",
} as const;

const RIBBON_MARKS = { ok: "✓", warn: "⚠", crit: "✗" } as const;

const TAB_DOT_STYLES = {
  ok: "bg-adaptive-emerald-600-400",
  warn: "bg-adaptive-amber-700-400",
  crit: "bg-adaptive-rose-600-400",
} as const;

const TILE_STYLES = {
  crit: "border-adaptive-rose-500-a12-a16 bg-adaptive-rose-500-a12-a16",
  warn: "border-adaptive-amber-200-900-a60 bg-adaptive-amber-500-a12-a16",
  good: "border-adaptive-emerald-500-a12-a16 bg-adaptive-emerald-500-a12-a16",
} as const;

const TILE_TEXT_STYLES = {
  crit: "text-adaptive-rose-700-300",
  warn: "text-adaptive-amber-700-300",
  good: "text-adaptive-emerald-700-300",
} as const;

// A count of zero carries no severity, so it drops to plain muted chrome: the
// colored tiles are exactly the ones holding a number.
const EMPTY_TILE_STYLE = "border-border bg-subtle";
const EMPTY_TILE_TEXT_STYLE = "text-foreground-tertiary";

const TILE_LABELS = { crit: "Crit", warn: "Warn", good: "Good" } as const;

function ReportTiles({ sources }: { sources: PlandropReport["sources"] }) {
  return (
    <View className="flex-row flex-wrap gap-1.5 p-3">
      {sources.flatMap((source) =>
        (
          [
            ["crit", source.crit],
            ["warn", source.warn],
            ["good", source.good],
          ] as const
        ).map(([kind, count]) => (
          <View
            className={`min-w-[30%] grow basis-0 items-center rounded-xl border px-2 py-1.5 ${count > 0 ? TILE_STYLES[kind] : EMPTY_TILE_STYLE}`}
            key={`${source.name}-${kind}`}
          >
            <Text
              className={`text-lg font-t3-bold tabular-nums ${count > 0 ? TILE_TEXT_STYLES[kind] : EMPTY_TILE_TEXT_STYLE}`}
            >
              {count}
            </Text>
            <Text
              className={`text-2xs font-t3-medium uppercase tracking-[0.5px] ${count > 0 ? TILE_TEXT_STYLES[kind] : EMPTY_TILE_TEXT_STYLE}`}
              numberOfLines={1}
            >
              {source.name} · {TILE_LABELS[kind]}
            </Text>
          </View>
        )),
      )}
    </View>
  );
}

export function AgentReviewCard(props: {
  /** Yours first when there is one, then each reviewer who shared theirs. */
  readonly tabs: ReadonlyArray<ReviewTab>;
  /** Relative age of a timestamp, e.g. "2h ago". */
  readonly formatAge: (value: string | null) => string | null;
  readonly onOpen: (url: string) => void;
}) {
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  // A reviewer whose tab went away (a refresh dropped them) falls back to the first.
  const selected = props.tabs.find((tab) => tab.review.report.url === selectedUrl) ?? props.tabs[0];
  if (selected === undefined) return null;

  const { report } = selected.review;
  const heading = reviewCardHeading(props.tabs, selected);
  const generatedAgo = props.formatAge(report.generatedAt);
  const stalePushedAgo = props.formatAge(selected.review.stalePushedAt);
  const isStale = selected.review.stalePushedAt !== null;
  const verdict = report.verdict;
  const open = () => props.onOpen(report.url);

  return (
    <View
      className={`overflow-hidden rounded-[18px] border ${isStale ? "border-adaptive-amber-200-900-a60" : "border-border"}`}
    >
      <Pressable
        accessibilityLabel={`Open ${selected.mine ? "your review" : `${selected.label}'s review`}${isStale ? ", outdated" : ""}`}
        accessibilityRole="button"
        className="flex-row items-center gap-1.5 px-3 py-2 active:opacity-70"
        onPress={open}
      >
        <SymbolView
          name="doc.text"
          size={11}
          tintColorClassName="accent-icon-subtle"
          type="monochrome"
        />
        <Text className="shrink text-xs font-t3-medium text-foreground-muted" numberOfLines={1}>
          {heading}
        </Text>
        {generatedAgo ? (
          <Text className="text-xs text-foreground-tertiary">· {generatedAgo}</Text>
        ) : null}
        {isStale ? (
          <View className="rounded-full border border-adaptive-amber-200-900-a60 bg-adaptive-amber-500-a12-a16 px-1.5 py-0.5">
            <Text className="text-2xs font-t3-bold uppercase tracking-[0.5px] text-adaptive-amber-700-300">
              Stale
            </Text>
          </View>
        ) : null}
        <View className="ml-auto flex-row items-center gap-1">
          <SymbolView
            name="arrow.up.right"
            size={10}
            tintColorClassName="accent-icon-subtle"
            type="monochrome"
          />
        </View>
      </Pressable>

      {props.tabs.length > 1 ? (
        <View accessibilityRole="tablist" className="flex-row flex-wrap gap-1.5 px-3 pb-2">
          {props.tabs.map((tab) => {
            const isSelected = tab === selected;
            const state = tab.review.report.verdict?.state;
            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: isSelected }}
                className={`flex-row items-center gap-1.5 rounded-full border px-2.5 py-1 active:opacity-70 ${isSelected ? "border-border bg-subtle" : "border-border"}`}
                key={tab.review.report.url}
                onPress={() => setSelectedUrl(tab.review.report.url)}
              >
                {state ? (
                  <View className={`h-1.5 w-1.5 rounded-full ${TAB_DOT_STYLES[state]}`} />
                ) : null}
                <Text
                  className={`text-xs ${isSelected ? "font-t3-medium text-foreground" : "text-foreground-muted"}`}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Pressable accessibilityRole="button" className="active:opacity-70" onPress={open}>
        {/* Say it in words too — the badge alone doesn't explain why the numbers
            below can't be trusted. */}
        {isStale ? (
          <View className="flex-row items-start gap-1.5 border-t border-adaptive-amber-200-900-a60 bg-adaptive-amber-500-a12-a16 px-3 py-2">
            <SymbolView
              name="exclamationmark.triangle"
              size={11}
              tintColorClassName="accent-adaptive-amber-700-300"
              type="monochrome"
            />
            <Text className="min-w-0 flex-1 text-xs leading-snug text-adaptive-amber-700-300">
              New code was pushed {stalePushedAgo ?? "since"}, after this review read the branch —
              it may not cover the current state. Re-run it to be sure.
            </Text>
          </View>
        ) : null}

        {/* A stale verdict shouldn't shout as loudly as a current one. */}
        <View style={isStale ? { opacity: 0.6 } : undefined}>
          {verdict && verdict.label.length > 0 ? (
            <View className={`px-3 py-1.5 ${RIBBON_STYLES[verdict.state]}`}>
              <Text
                className={`text-xs font-t3-bold uppercase tracking-[1px] ${RIBBON_TEXT_STYLES[verdict.state]}`}
              >
                {RIBBON_MARKS[verdict.state]} {verdict.label}
              </Text>
            </View>
          ) : null}
          {report.sources.length > 0 ? <ReportTiles sources={report.sources} /> : null}
        </View>
      </Pressable>
    </View>
  );
}
