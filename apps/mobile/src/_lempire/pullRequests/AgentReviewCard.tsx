// [FORK] lempire: the agent-review card, on the phone.
//
// The native twin of the web card: verdict ribbon, crit/warn/good tiles, and a
// stale ribbon when the branch moved past the commit the review read. Both read
// the same report from plandrop's per-pull-request index and share the staleness
// decision (`resolveReviewOfRecord`), so the two surfaces cannot disagree about
// whether a verdict still holds.
import type { PullRequestReview } from "@t3tools/client-runtime/_lempire/review-of-record";
import type { PlandropReport } from "@t3tools/contracts";
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
  readonly review: PullRequestReview;
  /** Relative age of the report, e.g. "2h ago". */
  readonly generatedAgo: string | null;
  /** Relative age of the push that outdated it, or null when it still holds. */
  readonly stalePushedAgo: string | null;
  readonly onOpen: (url: string) => void;
}) {
  const { report } = props.review;
  const isStale = props.review.stalePushedAt !== null;
  const verdict = report.verdict;

  return (
    <Pressable
      accessibilityLabel={`Open the review report for this pull request${isStale ? ", outdated" : ""}`}
      accessibilityRole="button"
      className={`overflow-hidden rounded-[18px] border active:opacity-70 ${isStale ? "border-adaptive-amber-200-900-a60" : "border-border"}`}
      onPress={() => props.onOpen(report.url)}
    >
      <View className="flex-row items-center gap-1.5 px-3 py-2">
        <SymbolView
          name="doc.text"
          size={11}
          tintColorClassName="accent-icon-subtle"
          type="monochrome"
        />
        <Text className="text-xs font-t3-medium text-foreground-muted">Your review of this PR</Text>
        {props.generatedAgo ? (
          <Text className="text-xs text-foreground-tertiary">· {props.generatedAgo}</Text>
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
      </View>

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
            New code was pushed {props.stalePushedAgo ?? "since"}, after this review read the branch
            — it may not cover the current state. Re-run it to be sure.
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
  );
}
