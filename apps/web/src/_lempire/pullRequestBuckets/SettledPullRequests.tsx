import { GitMergeIcon, PlusIcon } from "lucide-react";
import { memo, useState } from "react";

import type { PullRequestRowTarget } from "~/components/pullRequest/PullRequestRow";
import type { EnvironmentPullRequestEntry } from "~/components/pullRequest/pullRequestList.logic";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { pullRequestSelectionKey, sliceSettledPullRequests } from "./pullRequestBuckets";

/** A bucket heading drawn as a rule, the way the fork's sidebar separates thread sections. */
export function PullRequestSectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 pb-1 pt-4 text-[11px] text-muted-foreground/80">
      <span className="shrink-0">{label}</span>
      <span className="h-px flex-1 bg-border/70" aria-hidden="true" />
    </div>
  );
}

const SettledRow = memo(function SettledRow({
  entry,
  selected,
  onSelect,
}: {
  entry: EnvironmentPullRequestEntry;
  selected: boolean;
  onSelect: (entry: PullRequestRowTarget) => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(entry)}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
      )}
    >
      <GitMergeIcon
        className="size-3.5 shrink-0 text-purple-500 dark:text-purple-400"
        aria-hidden="true"
      />
      <span className="min-w-0 truncate">
        #{entry.number} · {entry.title}
      </span>
      <time className="ml-auto shrink-0 text-[11px] text-muted-foreground/70">
        {formatRelativeTimeLabel(entry.updatedAt)}
      </time>
    </button>
  );
});

/**
 * Recently merged work, collapsed under the open buckets so the list ends with what is done
 * rather than burying it in a separate Merged view.
 */
export function SettledPullRequests({
  entries,
  selectedKey,
  onSelect,
}: {
  entries: ReadonlyArray<EnvironmentPullRequestEntry>;
  selectedKey: string | null;
  onSelect: (entry: PullRequestRowTarget) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (entries.length === 0) return null;
  const { visible, hiddenCount } = sliceSettledPullRequests(entries, expanded);
  return (
    <div>
      <PullRequestSectionDivider label="Settled" />
      <div className="space-y-0.5">
        {visible.map((entry) => {
          const key = pullRequestSelectionKey(entry);
          return (
            <SettledRow
              key={key}
              entry={entry}
              selected={key === selectedKey}
              onSelect={onSelect}
            />
          );
        })}
      </div>
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-muted-foreground"
        >
          <PlusIcon className="size-3.5" aria-hidden="true" />
          Show {hiddenCount} more
        </button>
      ) : null}
    </div>
  );
}
