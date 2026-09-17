// [FORK] lempire: re-read a screen's data when the user comes back to it.
//
// The query atoms revalidate on mount (`Atom.swr`), and a screen you left open
// never mounts again: a pull request pushed onto the stack and then left while
// the phone goes in a pocket keeps whatever it read when it opened. That is how
// a review published minutes later stays invisible — the card was showing an
// answer from before it existed and nothing asked again.
//
// Both events matter and only one of them is navigation: returning from the
// background does not re-focus a screen that never lost focus.
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

/**
 * Refreshes when the screen is looked at again and the last read is older than
 * `minIntervalMs` — a tap back and forth must not re-read everything. Returns
 * the refresh to hand to pull-to-refresh, which reads now and restarts the
 * window.
 */
export function useRefreshOnRevisit(refresh: () => void, minIntervalMs: number): () => void {
  const lastRefreshedAtRef = useRef(0);
  const focusedRef = useRef(false);

  // Mount reads through the atoms' own revalidation, so the window starts there
  // rather than at the epoch: the first focus is not a revisit.
  useEffect(() => {
    lastRefreshedAtRef.current = Date.now();
  }, []);

  const refreshIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastRefreshedAtRef.current < minIntervalMs) return;
    lastRefreshedAtRef.current = now;
    refresh();
  }, [minIntervalMs, refresh]);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      refreshIfStale();
      return () => {
        focusedRef.current = false;
      };
    }, [refreshIfStale]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && focusedRef.current) refreshIfStale();
    });
    return () => subscription.remove();
  }, [refreshIfStale]);

  return useCallback(() => {
    lastRefreshedAtRef.current = Date.now();
    refresh();
  }, [refresh]);
}
