// [FORK] lempire: the Pull Requests screen, pushed from the Home header.
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useMemo, useRef, useState } from "react";

import { buildPullRequestFeed, type PullRequestFeedEntry } from "./pullRequestFeed";
import { PullRequestsScreen } from "./PullRequestsScreen";
import { usePullRequestFeed } from "./usePullRequestFeed";

/** Matches the listing atoms' stale window: a focus inside it reuses what it has. */
const FEED_REFRESH_INTERVAL_MS = 60_000;

export function PullRequestsRouteScreen() {
  const navigation = useNavigation();
  const [settledExpanded, setSettledExpanded] = useState(false);
  const { sources, error, isPending, environmentCount, refresh } = usePullRequestFeed();

  const { items } = useMemo(
    () => buildPullRequestFeed({ ...sources, settledExpanded }),
    [sources, settledExpanded],
  );

  // Coming back to the list should not show a stale verdict of what needs you —
  // but the screen stays mounted behind a pull request, and a refresh is four
  // host reads per environment, so a tap back and forth must not re-read
  // everything. Hold the listings for as long as they are considered fresh.
  const lastRefreshedAtRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastRefreshedAtRef.current < FEED_REFRESH_INTERVAL_MS) return;
      lastRefreshedAtRef.current = now;
      refresh();
    }, [refresh]),
  );

  const refreshNow = useCallback(() => {
    lastRefreshedAtRef.current = Date.now();
    refresh();
  }, [refresh]);

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
