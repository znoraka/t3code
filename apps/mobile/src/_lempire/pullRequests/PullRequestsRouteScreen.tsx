// [FORK] lempire: the Pull Requests screen, pushed from the Home header.
import { useNavigation } from "@react-navigation/native";
import { useCallback, useMemo, useState } from "react";

import { buildPullRequestFeed, type PullRequestFeedEntry } from "./pullRequestFeed";
import { PullRequestsScreen } from "./PullRequestsScreen";
import { useRefreshOnRevisit } from "./useRefreshOnRevisit";
import { usePullRequestFeed } from "./usePullRequestFeed";

/**
 * Matches the listing atoms' stale window. Coming back to the list should not
 * show a stale verdict of what needs you, but a refresh is four host reads per
 * environment, so a tap back and forth must reuse what it has.
 */
const FEED_REFRESH_INTERVAL_MS = 60_000;

export function PullRequestsRouteScreen() {
  const navigation = useNavigation();
  const [settledExpanded, setSettledExpanded] = useState(false);
  const { sources, error, isPending, environmentCount, refresh } = usePullRequestFeed();

  const { items } = useMemo(
    () => buildPullRequestFeed({ ...sources, settledExpanded }),
    [sources, settledExpanded],
  );

  const refreshNow = useRefreshOnRevisit(refresh, FEED_REFRESH_INTERVAL_MS);

  const handleSelect = useCallback(
    (entry: PullRequestFeedEntry) => {
      navigation.navigate("PullRequest", {
        environmentId: String(entry.environmentId),
        projectId: String(entry.projectId),
        repository: entry.repository,
        number: String(entry.number),
        host: entry.host,
      });
    },
    [navigation],
  );

  return (
    <PullRequestsScreen
      environmentCount={environmentCount}
      error={error}
      isPending={isPending}
      items={items}
      onExpandSettled={() => setSettledExpanded(true)}
      onRefresh={refreshNow}
      onSelect={handleSelect}
    />
  );
}
